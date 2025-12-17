import subprocess
import json
import sys
import os
import time

def read_json_rpc(stdout):
    line = stdout.readline()
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        print(f"Invalid JSON received: {line}")
        return None

def main():
    # Command from mcp.json
    # Note: We assume the image mcp-kokoro-tts is built and available
    cmd = [
        "docker", "run", "-i", "--rm",
        "-v", "c:/.tts:/app/data",
        "mcp-kokoro-tts"
    ]

    print(f"Starting server: {' '.join(cmd)}")

    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        text=True,
        bufsize=0
    )

    try:
        # 1. Initialize
        init_req = {
            "jsonrpc": "2.0",
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test-client", "version": "1.0"}
            },
            "id": 0
        }

        print("Sending initialize...")
        process.stdin.write(json.dumps(init_req) + "\n")
        process.stdin.flush()

        # Read response
        print("Waiting for initialize response...")
        init_resp = read_json_rpc(process.stdout)
        print(f"Initialize response: {json.dumps(init_resp, indent=2)}")

        if not init_resp:
            print("Failed to initialize.")
            return

        # 2. Initialized notification
        notify_req = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }
        process.stdin.write(json.dumps(notify_req) + "\n")
        process.stdin.flush()

        # 3. List Tools
        list_tools_req = {
            "jsonrpc": "2.0",
            "method": "tools/list",
            "id": 1
        }
        print("Sending tools/list...")
        process.stdin.write(json.dumps(list_tools_req) + "\n")
        process.stdin.flush()

        list_tools_resp = read_json_rpc(process.stdout)
        print(f"Tools response: {json.dumps(list_tools_resp, indent=2)}")

        # 4. Call Speak Tool
        speak_req = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "speak",
                "arguments": {
                    "text": "Hello, this is a test of the Kokoro TTS MCP server.",
                    "voice": "af_heart",
                    "speed": 1.0
                }
            },
            "id": 2
        }
        print("Sending tools/call (speak)...")
        process.stdin.write(json.dumps(speak_req) + "\n")
        process.stdin.flush()

        speak_resp = read_json_rpc(process.stdout)
        print(f"Speak response: {json.dumps(speak_resp, indent=2)}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        print("Terminating process...")
        process.terminate()

if __name__ == "__main__":
    main()
