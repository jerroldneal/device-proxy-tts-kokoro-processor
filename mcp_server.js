import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const processorPath = path.join(__dirname, "processor.py");

// Spawn the Python processor GLOBALLY
// -u: Unbuffered stdout/stderr
const python = spawn("python", ["-u", processorPath], { cwd: __dirname });

// Handle Python output
python.stdout.on("data", (data) => {
  console.log(`[Python]: ${data}`);
});

python.stderr.on("data", (data) => {
  console.error(`[Python Error]: ${data}`);
});

python.on("close", (code) => {
  console.error(`Python process exited with code ${code}`);
  process.exit(code);
});

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
    const selectedVoice = voice || "af_heart";
    const selectedSpeed = speed || 1.0;
    const payload = { text, voice: selectedVoice, speed: selectedSpeed };

    try {
      python.stdin.write(JSON.stringify(payload) + "\n");
      return { content: [{ type: "text", text: "Request sent to processor" }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error sending request: ${error.message}` }], isError: true };
    }
  }
);

const app = express();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kokoro TTS Processor MCP Server running on SSE at http://localhost:${PORT}/sse`);
});
