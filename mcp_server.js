import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import { startReverseClient } from "./kokoro-reverse-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const processorPath = path.join(__dirname, "processor.py");

// Path Translation: container paths ↔ host paths
const CONTAINER_DATA_PREFIX = "/app/data";
const MP3_HOST_PREFIX = process.env.MP3_HOST_PREFIX || "~/.tts";

function containerToHostPath(containerPath) {
  if (!containerPath) return containerPath;
  if (containerPath.startsWith(CONTAINER_DATA_PREFIX)) {
    return MP3_HOST_PREFIX + containerPath.slice(CONTAINER_DATA_PREFIX.length);
  }
  return containerPath;
}

function hostToContainerPath(hostPath) {
  if (!hostPath) return hostPath;
  if (hostPath.startsWith(MP3_HOST_PREFIX)) {
    return CONTAINER_DATA_PREFIX + hostPath.slice(MP3_HOST_PREFIX.length);
  }
  return hostPath;
}

// State Management
const state = {
  status: "initializing",
  current_text: "",
  current_voice: "af_heart",
  default_voice: "af_heart",
  history: [],
  // Job tracking for MP3 combine and progress notifications
  jobs: new Map(),
  // Playback control state
  playback: { paused: false, currentJobId: null, currentIndex: 0 }
};

// Spawn the Python processor GLOBALLY
// -u: Unbuffered stdout/stderr
const python = spawn("python", ["-u", processorPath], { cwd: __dirname });

// Handle Python output
python.stdout.on("data", (data) => {
  const lines = data.toString().split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handlePythonMessage(msg);
    } catch (e) {
      console.log(`[Python Log]: ${line}`);
    }
  }
});

python.stderr.on("data", (data) => {
  console.error(`[Python Error]: ${data}`);
});

python.on("close", (code) => {
  console.error(`Python process exited with code ${code}`);
  process.exit(code);
});

function handlePythonMessage(msg) {
  if (msg.type === "status") {
    if (msg.state === "ready") {
      state.status = "idle";
    } else {
      state.status = msg.state;
    }

    if (msg.state === "processing") {
      state.current_text = msg.text || state.current_text;
    } else {
      state.current_text = "";
    }
    broadcast({ type: "status", data: getPublicState() });
  } else if (msg.type === "progress") {
    // Progress from Python: { type: "progress", jobId, percent, phase, detail }
    const job = state.jobs.get(msg.jobId);
    if (job) {
      job.percent = msg.percent || 0;
      job.phase = msg.phase || job.phase;
      job.detail = msg.detail || "";
    }
    broadcast({ type: "progress", jobId: msg.jobId, percent: msg.percent, phase: msg.phase, detail: msg.detail });
  } else if (msg.type === "mp3_complete") {
    // Single MP3 part completed — update combine job if applicable
    const job = state.jobs.get(msg.jobId);
    if (job && job.type === "combine") {
      job.completedParts = (job.completedParts || 0) + 1;
      job.percent = Math.round((job.completedParts / job.totalParts) * 100);
      broadcast({ type: "progress", jobId: msg.jobId, percent: job.percent, phase: "generating", detail: `Part ${job.completedParts}/${job.totalParts}` });
      // Check if all parts done — trigger combine
      if (job.completedParts >= job.totalParts) {
        combineMp3Parts(job);
      }
    }
  } else if (msg.type === "error") {
    console.error("Python Error:", msg.message);
    broadcast({ type: "error", message: msg.message });
  }
}

function getPublicState() {
  const jobs = [];
  for (const [id, job] of state.jobs) {
    jobs.push({ id, type: job.type, status: job.status, percent: job.percent, phase: job.phase, outputPath: containerToHostPath(job.outputPath) });
  }
  return {
    status: state.status,
    current_text: state.current_text,
    current_voice: state.current_voice,
    default_voice: state.default_voice,
    playback: state.playback,
    activeJobs: jobs
  };
}

async function combineMp3Parts(job) {
  job.phase = "combining";
  job.status = "combining";
  broadcast({ type: "progress", jobId: job.id, percent: 95, phase: "combining", detail: "Concatenating parts" });

  // Send combine command to Python
  const combinePayload = {
    type: "combine_mp3",
    jobId: job.id,
    partPaths: job.partPaths,
    outputPath: job.outputPath,
    cleanupParts: job.cleanupParts !== false
  };
  python.stdin.write(JSON.stringify(combinePayload) + "\n");
}

function addToHistory(item) {
  state.history.unshift(item);
  if (state.history.length > 50) state.history.pop();
  broadcast({ type: "history", data: state.history });
}

// Tool handler extracted for reuse across server instances
const speakToolParams = {
  text: z.string().describe("The text to convert to speech"),
  voice: z.string().optional().describe("The voice to use (default: af_heart). Options: af_heart, af_bella, af_nicole, af_sarah, af_sky, am_adam, am_michael, bf_emma, bf_isabella, bm_george, bm_lewis"),
  speed: z.number().optional().describe("Speed of speech (default: 1.0)"),
  mp3: z.boolean().optional().describe("If true, output to MP3 file instead of speaker (default: false)"),
  mp3_path: z.string().optional().describe("Path for the MP3 file (required if mp3 is true)"),
  mp3announce: z.boolean().optional().describe("If true, announce MP3 file creation via speaker (default: false)"),
};

async function speakToolHandler({ text, voice, speed, mp3, mp3_path, mp3announce }) {
  const selectedVoice = voice || state.default_voice;
  const selectedSpeed = speed || 1.0;
  const id = uuidv4();

  // Translate host path to container path if needed
  let resolvedMp3Path = mp3_path ? hostToContainerPath(mp3_path) : null;
  if (mp3 && !resolvedMp3Path) {
    const mp3Dir = "/app/data/mp3";
    fs.mkdirSync(mp3Dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    resolvedMp3Path = path.join(mp3Dir, `tts-${timestamp}.mp3`);
  }

  const payload = { id, text, voice: selectedVoice, speed: selectedSpeed, mp3: mp3 || false, mp3_path: resolvedMp3Path, mp3announce: mp3announce || false };
  addToHistory({ ...payload, timestamp: new Date().toISOString() });

  console.log(`[MCP] Received speak request: ${text.substring(0, 50)}...`);
  try {
    python.stdin.write(JSON.stringify(payload) + "\n");
    console.log("[MCP] Request written to Python stdin");
    // Return host-visible path to caller
    const hostPath = containerToHostPath(resolvedMp3Path);
    const resultText = mp3 ? `MP3 will be saved to ${hostPath}` : "Request sent to processor";
    return { content: [{ type: "text", text: resultText }] };
  } catch (error) {
    console.error(`[MCP] Error writing to Python: ${error.message}`);
    return { content: [{ type: "text", text: `Error sending request: ${error.message}` }], isError: true };
  }
}

function sendControl(command, params = {}) {
  const msg = { type: "control", command, ...params };
  python.stdin.write(JSON.stringify(msg) + "\n");
}

function createMcpServer() {
  const server = new McpServer({ name: "tts-kokoro-processor-mcp", version: "2.0.0" });
  server.tool("speak", speakToolParams, speakToolHandler);

  // ── MP3 Combine Tool ──
  server.tool("speak_mp3_combined", {
    text: z.string().describe("The full text to convert to a combined MP3. Long texts are automatically split into sections."),
    voice: z.string().optional().describe("Voice ID (default: current default voice)"),
    speed: z.number().optional().describe("Speed of speech (default: 1.0)"),
    mp3_path: z.string().optional().describe("Output path for the final combined MP3 (host path, auto-generated if omitted)"),
    max_chars_per_section: z.number().optional().describe("Maximum characters per section before splitting (default: 5000)"),
    cleanup_parts: z.boolean().optional().describe("Remove individual part files after combining (default: true)"),
  }, async ({ text, voice, speed, mp3_path, max_chars_per_section, cleanup_parts }) => {
    const maxChars = max_chars_per_section || 5000;
    const sections = splitTextIntoSections(text, maxChars);
    const jobId = uuidv4();
    const selectedVoice = voice || state.default_voice;
    const selectedSpeed = speed || 1.0;

    // Resolve output path
    let containerOutputPath = mp3_path ? hostToContainerPath(mp3_path) : null;
    if (!containerOutputPath) {
      const mp3Dir = "/app/data/mp3";
      fs.mkdirSync(mp3Dir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      containerOutputPath = path.join(mp3Dir, `tts-combined-${timestamp}.mp3`);
    }

    // Generate part paths
    const baseName = containerOutputPath.replace(/\.mp3$/i, "");
    const partPaths = sections.map((_, i) => `${baseName}-part-${String(i + 1).padStart(3, "0")}.mp3`);

    // Register job
    const job = {
      id: jobId,
      type: "combine",
      status: "generating",
      totalParts: sections.length,
      completedParts: 0,
      percent: 0,
      phase: "generating",
      partPaths,
      outputPath: containerOutputPath,
      cleanupParts: cleanup_parts !== false,
      createdAt: new Date().toISOString()
    };
    state.jobs.set(jobId, job);

    // Queue each section as a separate MP3 generation
    for (let i = 0; i < sections.length; i++) {
      const partPayload = {
        id: uuidv4(),
        jobId,
        text: sections[i],
        voice: selectedVoice,
        speed: selectedSpeed,
        mp3: true,
        mp3_path: partPaths[i],
        mp3announce: false
      };
      addToHistory({ ...partPayload, timestamp: new Date().toISOString() });
      python.stdin.write(JSON.stringify(partPayload) + "\n");
    }

    const hostOutputPath = containerToHostPath(containerOutputPath);
    return {
      content: [{
        type: "text",
        text: `MP3 combine job started (${jobId}). ${sections.length} section(s) queued. Output: ${hostOutputPath}. Use get_job_status to track progress.`
      }]
    };
  });

  // ── Job Status Tool ──
  server.tool("get_job_status", {
    job_id: z.string().optional().describe("Job ID to check (omit for all active jobs)"),
  }, async ({ job_id }) => {
    if (job_id) {
      const job = state.jobs.get(job_id);
      if (!job) return { content: [{ type: "text", text: `Job "${job_id}" not found.` }] };
      return { content: [{ type: "text", text: JSON.stringify({ ...job, outputPath: containerToHostPath(job.outputPath) }, null, 2) }] };
    }
    const all = [];
    for (const [id, job] of state.jobs) {
      all.push({ id, type: job.type, status: job.status, percent: job.percent, phase: job.phase, outputPath: containerToHostPath(job.outputPath) });
    }
    return { content: [{ type: "text", text: all.length ? JSON.stringify(all, null, 2) : "No active jobs." }] };
  });

  // ── Notification / Progress Tool ──
  server.tool("get_notifications", {}, async () => {
    const status = state.status;
    const jobs = [];
    for (const [id, job] of state.jobs) {
      jobs.push({ id, type: job.type, status: job.status, percent: job.percent, phase: job.phase });
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          processorStatus: status,
          playback: state.playback,
          activeJobs: jobs,
          defaultVoice: state.default_voice
        }, null, 2)
      }]
    };
  });

  // ── Playback Controls ──
  server.tool("pause", {}, async () => {
    sendControl("pause");
    state.playback.paused = true;
    broadcast({ type: "status", data: getPublicState() });
    return { content: [{ type: "text", text: "Playback paused." }] };
  });

  server.tool("resume", {}, async () => {
    sendControl("resume");
    state.playback.paused = false;
    broadcast({ type: "status", data: getPublicState() });
    return { content: [{ type: "text", text: "Playback resumed." }] };
  });

  server.tool("stop", {}, async () => {
    sendControl("stop");
    state.playback.paused = false;
    state.playback.currentJobId = null;
    broadcast({ type: "status", data: getPublicState() });
    return { content: [{ type: "text", text: "Playback stopped and queue cleared." }] };
  });

  server.tool("restart", {}, async () => {
    sendControl("restart");
    state.playback.paused = false;
    broadcast({ type: "status", data: getPublicState() });
    return { content: [{ type: "text", text: "Restarting current item from beginning." }] };
  });

  server.tool("next", {}, async () => {
    sendControl("next");
    return { content: [{ type: "text", text: "Skipped to next item." }] };
  });

  server.tool("previous", {}, async () => {
    sendControl("previous");
    return { content: [{ type: "text", text: "Rewound to previous item." }] };
  });

  server.tool("start_at", {
    index: z.number().describe("The sentence index to start playback from (0-based)"),
  }, async ({ index }) => {
    sendControl("start_at", { index });
    return { content: [{ type: "text", text: `Jumping to sentence index ${index}.` }] };
  });

  return server;
}

// Split long text into sections at sentence/paragraph boundaries
function splitTextIntoSections(text, maxChars) {
  if (text.length <= maxChars) return [text];

  const sections = [];
  // First try splitting on paragraph boundaries
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      sections.push(current.trim());
      current = "";
    }
    // If a single paragraph exceeds maxChars, split at sentence boundaries
    if (para.length > maxChars) {
      if (current.length > 0) { sections.push(current.trim()); current = ""; }
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (current.length + sentence.length + 1 > maxChars && current.length > 0) {
          sections.push(current.trim());
          current = "";
        }
        current += (current ? " " : "") + sentence;
      }
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim().length > 0) sections.push(current.trim());
  return sections.length > 0 ? sections : [text];
}

const app = express();
app.use(cors());
// app.use(express.json()); // Removed global JSON parsing to avoid conflict with MCP SDK

const jsonParser = express.json();

// REST API
app.post("/api/speak", jsonParser, (req, res) => {
  const { text, voice, speed, mp3, mp3_path, mp3announce } = req.body;
  if (!text) return res.status(400).json({ error: "Text is required" });

  const id = uuidv4();

  // Translate host path to container path if needed; auto-generate if omitted
  let resolvedMp3Path = mp3_path ? hostToContainerPath(mp3_path) : null;
  if (mp3 && !resolvedMp3Path) {
    const mp3Dir = "/app/data/mp3";
    fs.mkdirSync(mp3Dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    resolvedMp3Path = path.join(mp3Dir, `tts-${timestamp}.mp3`);
  }

  const payload = { id, text, voice: voice || state.default_voice, speed: speed || 1.0, mp3: mp3 || false, mp3_path: resolvedMp3Path, mp3announce: mp3announce || false };

  console.error(`[API] Received speak request: ${text.substring(0, 50)}...`);
  addToHistory({ ...payload, timestamp: new Date().toISOString() });

  try {
    const msg = JSON.stringify(payload) + "\n";
    python.stdin.write(msg, (err) => {
      if (err) {
        console.error(`[API] Write error: ${err.message}`);
      } else {
        console.error("[API] Successfully wrote to Python stdin");
      }
    });
    res.json({ success: true, id });
  } catch (e) {
    console.error(`[API] Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/status", (req, res) => res.json(state));
app.get("/api/history", (req, res) => res.json(state.history));

app.post("/api/control", jsonParser, (req, res) => {
  const { command, voice, index } = req.body;
  if (command === "set_voice") {
    state.default_voice = voice;
    broadcast({ type: "status", data: getPublicState() });
  } else if (["pause", "resume", "stop", "restart", "next", "previous"].includes(command)) {
    sendControl(command);
    if (command === "pause") state.playback.paused = true;
    if (command === "resume") state.playback.paused = false;
    if (command === "stop") { state.playback.paused = false; state.playback.currentJobId = null; }
    broadcast({ type: "status", data: getPublicState() });
  } else if (command === "start_at" && typeof index === "number") {
    sendControl("start_at", { index });
  }
  res.json({ success: true });
});

app.post("/api/replay", jsonParser, (req, res) => {
  const { id } = req.body;
  const item = state.history.find(i => i.id === id);
  if (item) {
    const newId = uuidv4();
    const payload = { ...item, id: newId };
    addToHistory({ ...payload, timestamp: new Date().toISOString() });
    python.stdin.write(JSON.stringify(payload) + "\n");
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Item not found" });
  }
});

app.post("/api/server", jsonParser, (req, res) => {
  const { command } = req.body;
  if (command === "start") {
    // The processor is already running as it's spawned when this server starts
    // This endpoint is mainly for UI feedback
    res.json({ success: true, message: "Processor is running" });
  } else if (command === "stop") {
    // Stopping the processor would stop this entire service
    // This is more of a placeholder for now
    res.json({ success: true, message: "Cannot stop processor while API is running" });
  } else {
    res.status(400).json({ error: "Unknown command" });
  }
});

// Streamable HTTP transport - stateful mode with per-session server instances
const sessions = {};

app.all('/mcp', jsonParser, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];

  try {
    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId) {
      const mcpServer = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => uuidv4(),
        onsessioninitialized: (sid) => {
          sessions[sid] = { server: mcpServer, transport };
          console.log('[MCP] Session created:', sid);
        }
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && sessions[sid]) {
          sessions[sid].server.close();
          delete sessions[sid];
          console.log('[MCP] Session closed:', sid);
        }
      };
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(404).json({ error: 'Session not found' });
  } catch(e) {
    console.error('[MCP] handleRequest error:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});
console.log('[MCP] Streamable HTTP route registered (stateful session mode)');

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "status", data: state }));
  ws.send(JSON.stringify({ type: "history", data: state.history }));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Kokoro TTS Processor MCP Server running on Streamable HTTP at http://localhost:${PORT}/mcp`);
  console.log(`Dashboard API available at http://localhost:${PORT}/api`);

  // Start reverse-client connection to the broker hub
  startReverseClient({ state, python, addToHistory }).catch(err => {
    console.error(`[reverse-client] Startup error: ${err.message}`);
  });
});
