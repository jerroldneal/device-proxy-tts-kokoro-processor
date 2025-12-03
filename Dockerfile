FROM audio-driver-proxy:latest

# Keep Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# 1. Install system dependencies
# espeak-ng: required for phonemizer (Kokoro)
# libsndfile1: required for soundfile (Kokoro)
# git: required for some pip installs
# mpv: Audio player
RUN apt-get update && apt-get install -y \
    espeak-ng \
    libsndfile1 \
    git \
    mpv \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 2. Install Python dependencies
# This is the heavy step. By doing this before copying the app code,
# we ensure that changing processor.py doesn't trigger a re-install of torch.
COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

# 3. Copy application source
COPY processor.py .

# Create data directories
RUN mkdir -p /app/data/todo /app/data/working /app/data/done

# Declare volumes
VOLUME ["/app/data", "/root/.cache/huggingface"]

# Start the processor
CMD ["python", "-u", "processor.py"]
