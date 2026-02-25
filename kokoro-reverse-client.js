/**
 * Kokoro TTS Reverse-Client — Publishes TTS tools to the MCP reverse-server hub.
 *
 * Connects outbound to the reverse-server broker (WebSocket) and registers
 * a rich set of tools for speech synthesis, voice management, status, and history.
 *
 * This module is additive — the existing Streamable HTTP MCP endpoint stays intact.
 * The reverse-client connection makes TTS tools discoverable via the centralized hub.
 *
 * @module kokoro-reverse-client
 */

import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/** All available Kokoro voices with descriptions */
const AVAILABLE_VOICES = [
  { id: "af_heart", name: "Heart", gender: "female", accent: "american", description: "Warm, expressive female voice (default)" },
  { id: "af_bella", name: "Bella", gender: "female", accent: "american", description: "Smooth, confident female voice" },
  { id: "af_nicole", name: "Nicole", gender: "female", accent: "american", description: "Clear, professional female voice" },
  { id: "af_sarah", name: "Sarah", gender: "female", accent: "american", description: "Friendly, conversational female voice" },
  { id: "af_sky", name: "Sky", gender: "female", accent: "american", description: "Light, airy female voice" },
  { id: "am_adam", name: "Adam", gender: "male", accent: "american", description: "Deep, authoritative male voice" },
  { id: "am_michael", name: "Michael", gender: "male", accent: "american", description: "Balanced, natural male voice" },
  { id: "bf_emma", name: "Emma", gender: "female", accent: "british", description: "Elegant British female voice" },
  { id: "bf_isabella", name: "Isabella", gender: "female", accent: "british", description: "Refined British female voice" },
  { id: "bm_george", name: "George", gender: "male", accent: "british", description: "Distinguished British male voice" },
  { id: "bm_lewis", name: "Lewis", gender: "male", accent: "british", description: "Warm British male voice" },
];

/**
 * Sends a speak payload to the Python processor.
 * @param {object} python - The spawned Python child process
 * @param {object} payload - The speak payload
 * @returns {Promise<string>} Result message
 */
function sendToProcessor(python, payload) {
  return new Promise((resolve, reject) => {
    try {
      python.stdin.write(JSON.stringify(payload) + "\n", (err) => {
        if (err) {
          reject(new Error(`Failed to write to processor: ${err.message}`));
        } else {
          resolve(payload.mp3 ? `MP3 will be saved to ${payload.mp3_path}` : "Request sent to processor");
        }
      });
    } catch (err) {
      reject(new Error(`Processor write error: ${err.message}`));
    }
  });
}

/**
 * Creates a speak payload with defaults applied.
 * @param {object} params - Tool parameters
 * @param {object} state - Server state
 * @returns {object} Complete payload
 */
function buildSpeakPayload({ text, voice, speed, mp3, mp3_path, mp3announce }, state) {
  const id = uuidv4();
  let resolvedMp3Path = mp3_path || null;
  if (mp3 && !resolvedMp3Path) {
    const mp3Dir = "/app/data/mp3";
    fs.mkdirSync(mp3Dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    resolvedMp3Path = path.join(mp3Dir, `tts-${timestamp}.mp3`);
  }
  return {
    id,
    text,
    voice: voice || state.default_voice,
    speed: speed || 1.0,
    mp3: mp3 || false,
    mp3_path: resolvedMp3Path,
    mp3announce: mp3announce || false,
  };
}

/** System prompt for AI narrative generation */
const PRESENT_SYSTEM_PROMPT = `You are a presentation narrator. Transform the following document section into a natural, spoken narrative suitable for a TED Talk style presentation.

Rules:
- Convert bullet points into flowing sentences
- Describe diagrams and code conceptually rather than reading them literally
- Use transitions between ideas ("Now, let's look at...", "The key insight here is...")
- Keep technical accuracy but use conversational language
- For code blocks: explain what the code does and why, don't read syntax
- For Mermaid diagrams: describe the flow, relationships, or architecture depicted
- For tables: summarize the key data points narratively
- Output ONLY the spoken narrative text — no markdown, no formatting, no asterisks, no bullet characters
- Keep it concise — aim for 2-4 sentences per section unless the content is dense
- Never start with "Sure" or "Here's" — start speaking as if you are presenting`;

/** In-memory presentation cache (keyed by presentation ID) */
const presentations = new Map();

/**
 * Split a markdown document into logical sections by heading boundaries.
 * Code blocks, Mermaid diagrams, and tables are kept within their parent section.
 *
 * @param {string} markdown - The full markdown text
 * @returns {Array<{heading: string, content: string, type: string}>} Sections
 */
function splitMarkdownSections(markdown) {
  if (!markdown || typeof markdown !== "string") return [];

  const lines = markdown.split("\n");
  const sections = [];
  let currentHeading = "Introduction";
  let currentLines = [];
  let currentType = "text";

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      // Flush previous section
      const content = currentLines.join("\n").trim();
      if (content.length > 0) {
        sections.push({ heading: currentHeading, content, type: currentType });
      }
      currentHeading = headingMatch[2].trim();
      currentLines = [];
      currentType = "text";
    } else {
      currentLines.push(line);
      // Detect section types from content
      if (line.startsWith("```mermaid")) currentType = "diagram";
      else if (line.startsWith("```") && currentType !== "diagram") currentType = "code";
      else if (line.startsWith("|") && line.includes("|")) currentType = "table";
    }
  }

  // Flush final section
  const content = currentLines.join("\n").trim();
  if (content.length > 0) {
    sections.push({ heading: currentHeading, content, type: currentType });
  }

  return sections;
}

/**
 * Transform a section to spoken narrative using AI (Ollama via reverse-server chat proxy).
 *
 * @param {object} rc - The ReverseClient instance
 * @param {string} sectionContent - The raw markdown section content
 * @param {string} sectionHeading - The heading for context
 * @param {string} [model] - Ollama model to use
 * @returns {Promise<string>} The spoken narrative text
 */
async function transformSectionWithAI(rc, sectionContent, sectionHeading, model) {
  try {
    const response = await rc.chat({
      model: model || "qwen2.5:3b",
      messages: [
        { role: "system", content: PRESENT_SYSTEM_PROMPT },
        { role: "user", content: `Section: "${sectionHeading}"\n\n${sectionContent}` },
      ],
    }, { timeout: 120000 });

    return response?.payload?.message?.content || response?.message?.content || sectionContent;
  } catch (err) {
    console.error(`[present] AI transform failed for "${sectionHeading}": ${err.message}`);
    // Fallback: strip markdown formatting for a basic spoken version
    return sectionContent
      .replace(/```[\s\S]*?```/g, "(code block omitted)")
      .replace(/\|[^\n]+\|/g, "")
      .replace(/[#*_`]/g, "")
      .trim();
  }
}

/**
 * Start the reverse-client connection and register all TTS tools.
 *
 * @param {object} config
 * @param {object} config.state - Server state object (status, history, default_voice, etc.)
 * @param {object} config.python - Spawned Python child process
 * @param {Function} config.addToHistory - Function to add item to speech history
 * @param {string} [config.reverseServerUrl] - WebSocket URL of the reverse-server
 * @returns {Promise<object|null>} The ReverseClient instance, or null if unavailable
 */
export async function startReverseClient({ state, python, addToHistory, reverseServerUrl }) {
  const url = reverseServerUrl || process.env.REVERSE_SERVER_URL || "ws://host.docker.internal:3099";

  // Dynamic import — gracefully skip if SDK not available
  let ReverseClient;
  try {
    const sdk = await import("./reverse-client-sdk.js");
    ReverseClient = sdk.ReverseClient;
  } catch (err) {
    console.error(`[reverse-client] SDK not available (${err.message}). Reverse-client disabled.`);
    console.error("[reverse-client] Mount mcp-reverse-client/sdk.js as /app/reverse-client-sdk.js to enable.");
    return null;
  }

  const rc = new ReverseClient("kokoro-tts", { url, autoReconnect: true });

  // ─── Speech & Audio Tools ──────────────────────────────────────────────

  rc.addTool({
    name: "speak",
    description: "Convert text to speech and play through speakers",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to convert to speech" },
        voice: { type: "string", description: "Voice ID (e.g. af_heart, am_adam). Use list_voices to see all options." },
        speed: { type: "number", description: "Speed of speech (default: 1.0, range: 0.5-2.0)" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      if (!args.text || typeof args.text !== "string") return "Error: text is required";
      const payload = buildSpeakPayload({ text: args.text, voice: args.voice, speed: args.speed }, state);
      addToHistory({ ...payload, timestamp: new Date().toISOString() });
      return sendToProcessor(python, payload);
    },
  });

  rc.addTool({
    name: "speak_mp3",
    description: "Convert text to speech and save as MP3 file instead of playing through speakers",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to convert to speech" },
        voice: { type: "string", description: "Voice ID (e.g. af_heart, am_adam)" },
        speed: { type: "number", description: "Speed of speech (default: 1.0)" },
        mp3_path: { type: "string", description: "Output file path for the MP3 (auto-generated if omitted)" },
        mp3announce: { type: "boolean", description: "If true, also announce MP3 creation via speakers" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      if (!args.text || typeof args.text !== "string") return "Error: text is required";
      const payload = buildSpeakPayload({
        text: args.text,
        voice: args.voice,
        speed: args.speed,
        mp3: true,
        mp3_path: args.mp3_path,
        mp3announce: args.mp3announce,
      }, state);
      addToHistory({ ...payload, timestamp: new Date().toISOString() });
      return sendToProcessor(python, payload);
    },
  });

  rc.addTool({
    name: "speak_with_options",
    description: "Speak text with full control over voice, speed, and output format",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to convert to speech" },
        voice: { type: "string", description: "Voice ID" },
        speed: { type: "number", description: "Speed multiplier (0.5 = slow, 1.0 = normal, 2.0 = fast)" },
        mp3: { type: "boolean", description: "If true, save as MP3 instead of playing" },
        mp3_path: { type: "string", description: "MP3 output path (auto-generated if omitted)" },
        mp3announce: { type: "boolean", description: "If true, announce MP3 creation via speakers" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      if (!args.text || typeof args.text !== "string") return "Error: text is required";
      const payload = buildSpeakPayload(args, state);
      addToHistory({ ...payload, timestamp: new Date().toISOString() });
      return sendToProcessor(python, payload);
    },
  });

  // ─── Voice Management Tools ────────────────────────────────────────────

  rc.addTool({
    name: "list_voices",
    description: "List all available Kokoro TTS voices with their IDs, names, genders, accents, and descriptions",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const table = AVAILABLE_VOICES.map(v =>
        `${v.id} — ${v.name} (${v.gender}, ${v.accent}): ${v.description}`
      ).join("\n");
      return `Available voices:\n${table}\n\nCurrent default: ${state.default_voice}`;
    },
  });

  rc.addTool({
    name: "set_default_voice",
    description: "Change the default voice used for subsequent speak calls",
    inputSchema: {
      type: "object",
      properties: {
        voice: { type: "string", description: "Voice ID to set as default (e.g. af_heart, am_adam)" },
      },
      required: ["voice"],
    },
    handler: async ({ voice }) => {
      if (!voice || typeof voice !== "string") return "Error: voice ID is required";
      const known = AVAILABLE_VOICES.find(v => v.id === voice);
      if (!known) {
        return `Unknown voice "${voice}". Use list_voices to see available options.`;
      }
      const previous = state.default_voice;
      state.default_voice = voice;
      return `Default voice changed from "${previous}" to "${voice}" (${known.name})`;
    },
  });

  rc.addTool({
    name: "get_current_voice",
    description: "Get the currently active default voice",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const v = AVAILABLE_VOICES.find(v => v.id === state.default_voice);
      return v
        ? `Current voice: ${state.default_voice} — ${v.name} (${v.gender}, ${v.accent})`
        : `Current voice: ${state.default_voice}`;
    },
  });

  rc.addTool({
    name: "preview_voice",
    description: "Speak a sample sentence in a given voice so you can hear what it sounds like",
    inputSchema: {
      type: "object",
      properties: {
        voice: { type: "string", description: "Voice ID to preview" },
        sample_text: { type: "string", description: "Custom sample text (optional, uses default if omitted)" },
      },
      required: ["voice"],
    },
    handler: async ({ voice, sample_text }) => {
      if (!voice || typeof voice !== "string") return "Error: voice ID is required";
      const known = AVAILABLE_VOICES.find(v => v.id === voice);
      if (!known) return `Unknown voice "${voice}". Use list_voices to see available options.`;
      const text = sample_text || `Hello! This is ${known.name}, a ${known.accent} ${known.gender} voice. How do I sound?`;
      const payload = buildSpeakPayload({ text, voice, speed: 1.0 }, state);
      addToHistory({ ...payload, timestamp: new Date().toISOString() });
      return sendToProcessor(python, payload);
    },
  });

  // ─── Status & History Tools ────────────────────────────────────────────

  rc.addTool({
    name: "get_status",
    description: "Get current TTS processor status including state (idle/processing), current text being spoken, and voice settings",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      return JSON.stringify({
        status: state.status,
        currentText: state.current_text || null,
        defaultVoice: state.default_voice,
        historyCount: state.history.length,
      }, null, 2);
    },
  });

  rc.addTool({
    name: "get_history",
    description: "Get recent speech history (last N items, default 10)",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of history items to return (default: 10, max: 50)" },
      },
    },
    handler: async ({ limit }) => {
      const n = Math.min(Math.max(1, limit || 10), 50);
      const items = state.history.slice(0, n).map((item, i) => ({
        index: i + 1,
        id: item.id,
        text: item.text?.substring(0, 100) + (item.text?.length > 100 ? "..." : ""),
        voice: item.voice,
        speed: item.speed,
        mp3: item.mp3 || false,
        timestamp: item.timestamp,
      }));
      return JSON.stringify(items, null, 2);
    },
  });

  rc.addTool({
    name: "replay",
    description: "Replay a previous speech item by its ID from the history",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The ID of the history item to replay (use get_history to find IDs)" },
      },
      required: ["id"],
    },
    handler: async ({ id }) => {
      if (!id || typeof id !== "string") return "Error: history item ID is required";
      const item = state.history.find(i => i.id === id);
      if (!item) return `History item "${id}" not found. Use get_history to see available items.`;
      const newId = uuidv4();
      const payload = { ...item, id: newId };
      addToHistory({ ...payload, timestamp: new Date().toISOString() });
      return sendToProcessor(python, payload);
    },
  });

  rc.addTool({
    name: "clear_history",
    description: "Clear the speech history",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const count = state.history.length;
      state.history.length = 0;
      return `Cleared ${count} history item(s)`;
    },
  });

  // ─── Processor Control Tools ──────────────────────────────────────────

  rc.addTool({
    name: "ping",
    description: "Health check — verify the TTS processor is alive and responding",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      return JSON.stringify({
        alive: true,
        status: state.status,
        uptime: process.uptime(),
        defaultVoice: state.default_voice,
        historySize: state.history.length,
      });
    },
  });

  rc.addTool({
    name: "get_capabilities",
    description: "Return full processor capabilities, available voices, supported features, and configuration",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      return JSON.stringify({
        name: "Kokoro TTS Processor",
        version: "1.0.0",
        engine: "Kokoro",
        features: ["text-to-speech", "mp3-export", "voice-selection", "speed-control", "history-replay"],
        voices: AVAILABLE_VOICES,
        defaultVoice: state.default_voice,
        speedRange: { min: 0.5, max: 2.0, default: 1.0 },
        status: state.status,
      }, null, 2);
    },
  });

  // ─── Batch & Utility Tools ─────────────────────────────────────────────

  rc.addTool({
    name: "narrate_document",
    description: "Break a long document into paragraphs and speak them sequentially. Each paragraph is queued as a separate speak request.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The full document text to narrate" },
        voice: { type: "string", description: "Voice ID to use for narration" },
        speed: { type: "number", description: "Speed of narration (default: 1.0)" },
        paragraph_pause: { type: "number", description: "Pause duration between paragraphs in seconds (default: 0.5)" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      if (!args.text || typeof args.text !== "string") return "Error: text is required";
      // Split on double newlines or single newlines with blank lines
      const paragraphs = args.text
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

      if (paragraphs.length === 0) return "No paragraphs found in the provided text.";

      const results = [];
      for (const para of paragraphs) {
        const payload = buildSpeakPayload({
          text: para,
          voice: args.voice,
          speed: args.speed,
        }, state);
        addToHistory({ ...payload, timestamp: new Date().toISOString() });
        try {
          await sendToProcessor(python, payload);
          results.push(`✓ Queued: "${para.substring(0, 60)}..."`);
        } catch (err) {
          results.push(`✗ Failed: "${para.substring(0, 60)}..." — ${err.message}`);
        }
      }
      return `Narration queued: ${paragraphs.length} paragraph(s)\n${results.join("\n")}`;
    },
  });

  // ─── Presentation Tools (AI-Powered Document Presenting) ───────────────

  rc.addTool({
    name: "present",
    description: "Present a document as a TED Talk — AI transforms each section into spoken narrative using Ollama, then speaks through TTS. Encapsulates the full Present Document SOP.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Full markdown document text to present" },
        voice: { type: "string", description: "Voice ID for narration (default: current default voice)" },
        speed: { type: "number", description: "Speech speed (default: 0.9 for presentations)" },
        model: { type: "string", description: "Ollama model for narrative generation (default: qwen2.5:3b)" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      if (!args.text || typeof args.text !== "string") return "Error: text is required";

      const sections = splitMarkdownSections(args.text);
      if (sections.length === 0) return "No sections found in the document.";

      const speed = args.speed || 0.9;
      const voice = args.voice || state.default_voice;
      const results = [];

      console.log(`[present] Starting presentation with ${sections.length} section(s), model: ${args.model || "qwen2.5:3b"}`);

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        console.log(`[present] Section ${i + 1}/${sections.length}: "${section.heading}"`);

        // Transform section with AI
        const narrative = await transformSectionWithAI(rc, section.content, section.heading, args.model);

        // Speak the narrative
        const payload = buildSpeakPayload({ text: narrative, voice, speed }, state);
        addToHistory({ ...payload, timestamp: new Date().toISOString(), presentSection: section.heading });

        try {
          await sendToProcessor(python, payload);
          results.push(`✓ Section ${i + 1}: "${section.heading}"`);
        } catch (err) {
          results.push(`✗ Section ${i + 1}: "${section.heading}" — ${err.message}`);
        }
      }

      return `Presentation complete: ${sections.length} section(s)\n${results.join("\n")}`;
    },
  });

  rc.addTool({
    name: "prepare_presentation",
    description: "Generate a presentation script from a document using AI, without speaking it. Returns a presentation ID that can be used with present_cached or get_presentation. Allows reviewing and editing before delivery.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Full markdown document text to transform" },
        title: { type: "string", description: "Title for this presentation (auto-generated if omitted)" },
        model: { type: "string", description: "Ollama model for narrative generation (default: qwen2.5:3b)" },
      },
      required: ["text"],
    },
    handler: async (args) => {
      if (!args.text || typeof args.text !== "string") return "Error: text is required";

      const sections = splitMarkdownSections(args.text);
      if (sections.length === 0) return "No sections found in the document.";

      const presentationId = crypto.randomBytes(6).toString("hex");
      const title = args.title || sections[0]?.heading || "Untitled Presentation";
      const narrativeSections = [];

      console.log(`[present] Preparing presentation "${title}" (${presentationId}) with ${sections.length} section(s)`);

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        console.log(`[present] Transforming section ${i + 1}/${sections.length}: "${section.heading}"`);
        const narrative = await transformSectionWithAI(rc, section.content, section.heading, args.model);
        narrativeSections.push({
          index: i + 1,
          heading: section.heading,
          type: section.type,
          originalContent: section.content.substring(0, 200),
          narrative,
        });
      }

      const presentation = {
        id: presentationId,
        title,
        createdAt: new Date().toISOString(),
        model: args.model || "qwen2.5:3b",
        sectionCount: narrativeSections.length,
        sections: narrativeSections,
      };

      presentations.set(presentationId, presentation);
      console.log(`[present] Presentation "${title}" (${presentationId}) prepared with ${narrativeSections.length} section(s)`);

      return JSON.stringify({
        id: presentationId,
        title,
        sectionCount: narrativeSections.length,
        sections: narrativeSections.map(s => ({
          index: s.index,
          heading: s.heading,
          narrativePreview: s.narrative.substring(0, 120) + (s.narrative.length > 120 ? "..." : ""),
        })),
        message: `Presentation prepared. Use present_cached with id "${presentationId}" to deliver it, or get_presentation to review the full script.`,
      }, null, 2);
    },
  });

  rc.addTool({
    name: "present_cached",
    description: "Deliver a previously prepared presentation by its ID. Speaks each section through TTS.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Presentation ID from prepare_presentation" },
        voice: { type: "string", description: "Voice ID for narration" },
        speed: { type: "number", description: "Speech speed (default: 0.9)" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      if (!args.id || typeof args.id !== "string") return "Error: presentation ID is required";

      const presentation = presentations.get(args.id);
      if (!presentation) return `Presentation "${args.id}" not found. Use list_presentations to see available presentations.`;

      const speed = args.speed || 0.9;
      const voice = args.voice || state.default_voice;
      const results = [];

      console.log(`[present] Delivering cached presentation "${presentation.title}" (${args.id})`);

      for (const section of presentation.sections) {
        const payload = buildSpeakPayload({ text: section.narrative, voice, speed }, state);
        addToHistory({ ...payload, timestamp: new Date().toISOString(), presentSection: section.heading });

        try {
          await sendToProcessor(python, payload);
          results.push(`✓ Section ${section.index}: "${section.heading}"`);
        } catch (err) {
          results.push(`✗ Section ${section.index}: "${section.heading}" — ${err.message}`);
        }
      }

      return `Presentation "${presentation.title}" delivered: ${presentation.sections.length} section(s)\n${results.join("\n")}`;
    },
  });

  rc.addTool({
    name: "get_presentation",
    description: "Retrieve the full script of a previously prepared presentation, including all section narratives",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Presentation ID" },
      },
      required: ["id"],
    },
    handler: async (args) => {
      if (!args.id || typeof args.id !== "string") return "Error: presentation ID is required";

      const presentation = presentations.get(args.id);
      if (!presentation) return `Presentation "${args.id}" not found. Use list_presentations to see available presentations.`;

      return JSON.stringify(presentation, null, 2);
    },
  });

  rc.addTool({
    name: "list_presentations",
    description: "List all cached presentation scripts with their IDs, titles, and section counts",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      if (presentations.size === 0) return "No cached presentations. Use prepare_presentation to create one.";

      const list = [];
      for (const [id, p] of presentations) {
        list.push({
          id,
          title: p.title,
          sectionCount: p.sectionCount,
          model: p.model,
          createdAt: p.createdAt,
        });
      }
      return JSON.stringify(list, null, 2);
    },
  });

  // ─── Connect ───────────────────────────────────────────────────────────

  try {
    await rc.connect();
    console.log(`[reverse-client] Connected to ${url} as "kokoro-tts" with ${rc._tools.size} tool(s)`);
    return rc;
  } catch (err) {
    console.error(`[reverse-client] Failed to connect to ${url}: ${err.message}`);
    console.error("[reverse-client] Will auto-reconnect when reverse-server becomes available.");
    return rc; // SDK handles auto-reconnect
  }
}
