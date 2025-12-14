import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const processorPath = path.join(__dirname, "processor.py");

const server = new McpServer({
  name: "tts-kokoro-processor-mcp",
  version: "1.0.0",
});

// Spawn the Python processor
// -u: Unbuffered stdout/stderr
const python = spawn("python", ["-u", processorPath], { cwd: __dirname });

// Handle Python output
// We redirect Python's stdout/stderr to stderr so it doesn't interfere with MCP Stdio transport
python.stdout.on("data", (data) => {
  console.error(`[Python]: ${data}`);
});

python.stderr.on("data", (data) => {
  console.error(`[Python Error]: ${data}`);
});

python.on("close", (code) => {
  console.error(`Python process exited with code ${code}`);
  process.exit(code);
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

    const payload = {
      text,
      voice: selectedVoice,
      speed: selectedSpeed,
    };

    try {
      // Write JSON payload to Python's stdin
      python.stdin.write(JSON.stringify(payload) + "\n");

      return {
        content: [
          {
            type: "text",
            text: "Request sent to processor",
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error sending request: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main();
