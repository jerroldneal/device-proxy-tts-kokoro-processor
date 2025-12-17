#!/bin/bash

# Start the pipe forwarder in the background
./forward_pipe.sh &

# Start the Node.js MCP Server in the foreground
# It spawns processor.py as a child process
exec node mcp_server.js
