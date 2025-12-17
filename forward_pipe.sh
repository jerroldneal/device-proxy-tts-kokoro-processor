#!/bin/bash

PIPE=${PIPE_PATH:-/tmp/audio_pipe}
HOST=${HOST_ADDRESS:-host.docker.internal}
PORT=${HOST_PORT:-3007}

if [[ ! -p $PIPE ]]; then
    mkfifo $PIPE
    chmod 666 $PIPE
fi

echo "Pipe Forwarder: Starting socat from $PIPE to $HOST:$PORT" >&2

# Loop to keep restarting socat if it fails
while true; do
    # socat -u PIPE:<pipe> TCP:<host>:<port>
    # retry=10: retry connection 10 times
    # interval=1: wait 1s between retries
    socat -u PIPE:$PIPE TCP:$HOST:$PORT,retry=10,interval=1 >&2 2>&1

    echo "Pipe Forwarder: socat exited, restarting in 1s..." >&2
    sleep 1
done
