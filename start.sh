#!/bin/bash

# Check if forward_pipe.sh is already running (avoid double execution if inherited from base image)
if pgrep -f "forward_pipe.sh" > /dev/null; then
    echo "Pipe Forwarder already running. Skipping start."
else
    echo "Starting Pipe Forwarder..."
    ./forward_pipe.sh &
fi

# Start the Node.js MCP Server in the foreground
# It spawns processor.py as a child process
exec node mcp_server.js
