FROM python:3.10-slim

# Keep Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# 1. Install system dependencies
# espeak-ng: required for phonemizer (Kokoro)
# libsndfile1: required for soundfile (Kokoro)
# git: required for some pip installs
# mpv: Audio player
# ffmpeg: required for WAV to MP3 conversion
RUN apt-get update && apt-get install -y \
    espeak-ng \
    libsndfile1 \
    git \
    mpv \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 2. Install Python dependencies
# This is the heavy step. By doing this before copying the app code,
# we ensure that changing processor.py doesn't trigger a re-install of torch.
COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

# 3. Copy application source
COPY processor.py .
COPY package.json .
RUN npm install
COPY mcp_server.js .
COPY --chmod=0755 start.sh .
RUN sed -i 's/\r$//' start.sh

# Create data directories
RUN mkdir -p /app/data/todo /app/data/working /app/data/done

# Declare volumes
VOLUME ["/app/data", "/root/.cache/huggingface"]

# Start the processor
CMD ["./start.sh"]
