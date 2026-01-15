import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const processorPath = path.join(__dirname, "processor.py");

// State Management
const state = {
  status: "initializing",
  current_text: "",
  current_voice: "af_heart",
  default_voice: "af_heart",
  history: []
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
    // If we receive "ready", we transition to "idle"
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
    broadcast({ type: "status", data: state });
  } else if (msg.type === "error") {
    console.error("Python Error:", msg.message);
    broadcast({ type: "error", message: msg.message });
  }
}

function addToHistory(item) {
  state.history.unshift(item);
  if (state.history.length > 50) state.history.pop();
  broadcast({ type: "history", data: state.history });
}

const server = new McpServer({
  name: "tts-kokoro-processor-mcp",
  version: "1.0.0",
});

server.tool(
  "speak",
  {
    text: z.string().describe("The text to convert to speech"),
    voice: z.string().optional().describe("The voice to use (default: af_heart). Options: af_heart, af_bella, af_nicole, af_sarah, af_sky, am_adam, am_michael, bf_emma, bf_isabella, bm_george, bm_lewis"),
    speed: z.number().optional().describe("Speed of speech (default: 1.0)"),
  },
  async ({ text, voice, speed }) => {
    const selectedVoice = voice || state.default_voice;
    const selectedSpeed = speed || 1.0;
    const id = uuidv4();
    const payload = { id, text, voice: selectedVoice, speed: selectedSpeed };

    addToHistory({ ...payload, timestamp: new Date().toISOString() });

    console.log(`[MCP] Received speak request: ${text.substring(0, 50)}...`);
    try {
      python.stdin.write(JSON.stringify(payload) + "\n");
      console.log("[MCP] Request written to Python stdin");
      return { content: [{ type: "text", text: "Request sent to processor" }] };
    } catch (error) {
      console.error(`[MCP] Error writing to Python: ${error.message}`);
      return { content: [{ type: "text", text: `Error sending request: ${error.message}` }], isError: true };
    }
  }
);

const app = express();
app.use(cors());
// app.use(express.json()); // Removed global JSON parsing to avoid conflict with MCP SDK

const jsonParser = express.json();

// REST API
app.post("/api/speak", jsonParser, (req, res) => {
  const { text, voice, speed } = req.body;
  if (!text) return res.status(400).json({ error: "Text is required" });

  const id = uuidv4();
  const payload = { id, text, voice: voice || state.default_voice, speed: speed || 1.0 };

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
  const { command, voice } = req.body;
  if (command === "set_voice") {
    state.default_voice = voice;
    broadcast({ type: "status", data: state });
  }
  // TODO: Implement stop command (requires Python support)
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

let transport;

app.get("/sse", async (req, res) => {
  console.log("New SSE connection established");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No active transport");
  }
});

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
  console.log(`Kokoro TTS Processor MCP Server running on SSE at http://localhost:${PORT}/sse`);
  console.log(`Dashboard API available at http://localhost:${PORT}/api`);
});
