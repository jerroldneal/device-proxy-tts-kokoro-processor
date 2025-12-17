# Kokoro TTS MCP Architecture

## Current Architecture (Stdio)

The current implementation uses a Docker container running a Python-based TTS processor (`processor.py`) which is wrapped by a Node.js MCP server (`mcp_server.js`). The communication happens via standard input/output (stdio).

### Diagram

```mermaid
graph TD
    subgraph "Host (Windows)"
        VSCode["VS Code / MCP Client"]
        AudioProxy["Audio Driver Proxy (Port 3007)"]
    end

    subgraph "Docker Container (mcp-kokoro-tts)"
        NodeServer["Node.js MCP Server (mcp_server.js)"]
        PythonProc["Python Processor (processor.py)"]
        Kokoro["Kokoro TTS Pipeline"]
        PipeForwarder["Pipe Forwarder (socat)"]
        NamedPipe["/tmp/audio_pipe"]
    end

    VSCode -- "Spawn (docker run)" --> NodeServer
    NodeServer -- "Spawn (python)" --> PythonProc
    VSCode -- "JSON-RPC (stdin/stdout)" --> NodeServer
    NodeServer -- "JSON (stdin)" --> PythonProc
    PythonProc -- "Audio Data" --> NamedPipe
    NamedPipe -- "Read" --> PipeForwarder
    PipeForwarder -- "TCP (host.docker.internal:3007)" --> AudioProxy
    AudioProxy -- "Playback" --> Speakers
```

### Implementation Details

1.  **MCP Client (VS Code)**:
    *   Reads `.vscode/mcp.json`.
    *   Executes `docker run -i --rm ... mcp-kokoro-tts`.
    *   Connects to the container's `stdin` and `stdout` to send JSON-RPC requests.

2.  **Node.js MCP Server (`mcp_server.js`)**:
    *   Runs inside the container as the entry point (via `start.sh`).
    *   Spawns `processor.py` as a child process.
    *   Receives MCP tool calls (`speak`) from VS Code.
    *   Forwards the text/voice/speed payload to `processor.py` via its `stdin`.

3.  **Python Processor (`processor.py`)**:
    *   Initializes the Kokoro TTS pipeline (loading models).
    *   Runs a `stdin_reader` thread to listen for JSON payloads from `mcp_server.js`.
    *   Generates audio using `kokoro`.
    *   Writes raw audio data (PCM) to a named pipe `/tmp/audio_pipe`.

4.  **Audio Output**:
    *   `forward_pipe.sh` runs in the background (started by `start.sh`).
    *   It uses `socat` to read from `/tmp/audio_pipe` and forward the data via TCP to `host.docker.internal:3007`.
    *   On the host, an "Audio Driver Proxy" (presumably running on port 3007) receives the stream and plays it.

## The "New Container Per Session" Issue

Currently, the `mcp.json` configuration uses `type: "stdio"`. This means:
1.  When the MCP client connects (e.g., you open a workspace or reload the window), it spawns the `command` (`docker run ...`).
2.  This creates a **new** Docker container instance.
3.  When the client disconnects, the process terminates, and the container is removed (due to `--rm`).

**Problem**:
*   **Slow Startup**: Loading the Kokoro models takes time (initializing the pipeline).
*   **Resource Waste**: A new container is spun up for every session.
*   **No Persistence**: State is lost between sessions (though TTS is mostly stateless).

## Persistent Architecture with Dashboard

The system has been migrated to a persistent architecture using SSE for MCP communication and includes a dedicated Dashboard for monitoring and control.

### Diagram

```mermaid
graph TD
    subgraph "Host (Windows)"
        VSCode["VS Code / MCP Client"]
        Browser["Web Browser (Dashboard)"]
        AudioProxy["Audio Driver Proxy (Port 3007)"]
    end

    subgraph "Docker Network"
        subgraph "tts-kokoro-processor (Port 3021)"
            NodeServer["Node.js Server (Express + MCP + WS)"]
            PythonProc["Python Processor (processor.py)"]
            Kokoro["Kokoro TTS Pipeline"]
        end

        subgraph "tts-dashboard (Port 3022)"
            Nginx["Nginx Web Server"]
            DashboardApp["Vue.js Dashboard App"]
        end
    end

    VSCode -- "SSE (JSON-RPC)" --> NodeServer
    Browser -- "HTTP (Port 3022)" --> Nginx
    DashboardApp -- "REST / WebSocket (Port 3021)" --> NodeServer
    NodeServer -- "Spawn / Stdio (JSON)" --> PythonProc
    PythonProc -- "Audio Stream (TCP)" --> AudioProxy
```

### Components

1.  **Node.js Server (`mcp_server.js`)**:
    *   **MCP Endpoint**: `/sse` for VS Code communication.
    *   **REST API**: `/api/status`, `/api/history`, `/api/control` for the Dashboard.
    *   **WebSocket**: Real-time status updates to the Dashboard.
    *   **State Management**: Maintains history and current status in memory.

2.  **Python Processor (`processor.py`)**:
    *   **Input**: Receives JSON commands via `stdin`.
    *   **Output**: Emits JSON status events (start, finish, error) via `stdout`.
    *   **Audio**: Streams raw audio to the Audio Proxy via a named pipe and `socat`.

3.  **Dashboard (`tts-dashboard`)**:
    *   **Tech Stack**: Nginx serving a static Vue.js (CDN) application.
    *   **Features**:
        *   **Status**: View connection state, current voice, and processing status.
        *   **History**: List of recently spoken items with Replay functionality.
        *   **Control**: Change default voice, Stop playback.
        *   **Live View**: See the text currently being spoken.

### API Endpoints

*   `GET /api/status`: Returns current state (idle/processing), current text, and voice settings.
*   `GET /api/history`: Returns a list of past spoken items.
*   `POST /api/control`: Send commands like `stop` or `set_voice`.
*   `POST /api/replay`: Re-queue a specific history item.

### WebSocket Events

*   `status`: Broadcasts the full state object whenever it changes.
*   `history`: Broadcasts the updated history list when a new item is added.

