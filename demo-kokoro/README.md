# Demo Kokoro TTS

This directory contains verification scripts for the Kokoro TTS MCP server.

## `test_kokoro_client.py`

A Python script that acts as an MCP client to verify the `kokoro-tts` MCP server running in a Docker container.

### Prerequisites

- Docker Desktop running.
- `mcp-kokoro-tts` Docker image built (from `../Dockerfile`).
- Python 3.x.

### Usage

```bash
python test_kokoro_client.py
```

### What it does

1. Runs the `mcp-kokoro-tts` container using the command defined in `mcp.json`.
2. Connects via Stdio (stdin/stdout).
3. Sends `initialize` request.
4. Sends `tools/list` request to verify the `speak` tool is available.
5. Sends `tools/call` request to the `speak` tool with sample text.
6. Prints the responses.

### Notes

- The `mcp_server.js` in the parent directory has been updated to use `StdioServerTransport` to support this communication method.
- `forward_pipe.sh` has been updated to log to stderr to avoid corrupting the JSON-RPC stdout stream.
