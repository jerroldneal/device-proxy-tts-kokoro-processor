# Dashboard API Specification

## Internal Protocol (Python -> Node.js)
The Python processor will emit JSON lines to `stdout` with the following structure:
```json
{"type": "status", "state": "processing", "text": "Hello world", "id": "uuid"}
{"type": "status", "state": "idle"}
{"type": "error", "message": "Something went wrong"}
```

## REST API (Node.js)

### `GET /api/status`
Returns the current state of the TTS engine.
```json
{
  "state": "idle", // or "processing"
  "current_text": "...",
  "current_voice": "af_heart",
  "default_voice": "af_heart",
  "queue_length": 0
}
```

### `POST /api/control`
Control the engine.
```json
{
  "command": "stop" // or "set_voice"
  "voice": "af_heart" // required if command is set_voice
}
```

### `GET /api/history`
Returns list of recently spoken items.
```json
[
  {
    "id": "uuid",
    "text": "Hello world",
    "voice": "af_heart",
    "timestamp": "2025-12-16T..."
  }
]
```

### `POST /api/replay`
Re-queue an item from history.
```json
{
  "id": "uuid"
}
```

## WebSocket Events
- `status`: Emitted when state changes (processing/idle).
- `history`: Emitted when a new item is added to history.
