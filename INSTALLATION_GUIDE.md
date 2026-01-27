# Kokoro TTS Processor - Installation Guide

Complete setup guide for Windows and macOS (Apple Silicon M1/M2/M3).

---

## Table of Contents
- [Prerequisites](#prerequisites)
- [Windows Installation](#windows-installation)
- [macOS (Apple Silicon) Installation](#macos-apple-silicon-installation)
- [Post-Installation Setup](#post-installation-setup)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

#### Windows
- **OS**: Windows 10/11 (64-bit)
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 10GB free space
- **CPU**: Modern multi-core processor
- **GPU** (Optional): NVIDIA GPU with compute capability 7.0+ for GPU acceleration

#### macOS (Apple Silicon)
- **OS**: macOS 12 (Monterey) or later
- **RAM**: 8GB minimum, 16GB recommended
- **Storage**: 10GB free space
- **Chip**: M1, M2, or M3 (Apple Silicon)

---

## Windows Installation

### Step 1: Install Git

1. Download Git from [https://git-scm.com/download/win](https://git-scm.com/download/win)
2. Run the installer with default settings
3. Verify installation:
   ```powershell
   git --version
   ```

### Step 2: Install Docker Desktop

1. **Download Docker Desktop**
   - Visit [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
   - Download "Docker Desktop for Windows"

2. **Install Docker Desktop**
   - Run the installer
   - **Important**: Enable WSL 2 backend during installation
   - Restart your computer when prompted

3. **Enable WSL 2** (if not already enabled)
   ```powershell
   # Run PowerShell as Administrator
   wsl --install
   wsl --set-default-version 2
   ```
   - Restart your computer

4. **Start Docker Desktop**
   - Launch Docker Desktop from Start Menu
   - Wait for Docker Engine to start (whale icon in system tray)
   - Accept the Docker Service Agreement

5. **Configure Docker Settings**
   - Right-click Docker icon → Settings
   - **Resources → Advanced**:
     - CPUs: 4+ cores recommended
     - Memory: 8GB+ recommended
   - **Docker Engine**: Ensure it's running

6. **Verify Docker Installation**
   ```powershell
   docker --version
   docker compose version
   docker run hello-world
   ```

### Step 3: Install Node.js (for audio pipe support)

1. Download Node.js LTS from [https://nodejs.org](https://nodejs.org)
2. Run the installer (use default settings)
3. Verify installation:
   ```powershell
   node --version
   npm --version
   ```

### Step 4: GPU Setup (Optional - for NVIDIA GPU acceleration)

⚠️ **Important**: Only for NVIDIA GPUs with compute capability 7.0 or higher (RTX 20 series and newer)

1. **Install NVIDIA Drivers**
   - Download latest drivers from [https://www.nvidia.com/Download/index.aspx](https://www.nvidia.com/Download/index.aspx)
   - Install and restart

2. **Install NVIDIA Container Toolkit**
   ```powershell
   # This is handled automatically by Docker Desktop for Windows
   # GPU support is enabled via WSL 2
   ```

3. **Verify GPU Access**
   ```powershell
   docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
   ```

### Step 5: Clone the Repository

```powershell
# Create development directory
New-Item -ItemType Directory -Path "C:\development" -Force
cd C:\development

# Clone the repository
git clone https://github.com/jerroldneal/device-proxy-tts-kokoro-processor.git
cd device-proxy-tts-kokoro-processor
```

### Step 6: Create Required Directories

```powershell
# Create TTS data directories
New-Item -ItemType Directory -Path "C:\.tts\todo" -Force
New-Item -ItemType Directory -Path "C:\.tts\working" -Force
New-Item -ItemType Directory -Path "C:\.tts\done" -Force
New-Item -ItemType Directory -Path "C:\.tts\mp3" -Force

# Create temp directory
New-Item -ItemType Directory -Path "C:\temp" -Force
```

### Step 7: Configure Environment

Create `.env` file in the project directory:

```powershell
# Create .env file
@"
KOKORO_VOICE=af_heart
USE_GPU=false
"@ | Out-File -FilePath .env -Encoding UTF8
```

**For GPU users**: Change `USE_GPU=false` to `USE_GPU=true` and uncomment GPU settings in `docker-compose.yml`

### Step 8: Build and Start the Container

```powershell
# Build the Docker image
docker compose build

# Start the service
docker compose up -d

# Check logs
docker compose logs -f
```

---

## macOS (Apple Silicon) Installation

### Step 1: Install Homebrew

```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Add Homebrew to PATH (follow on-screen instructions)
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

# Verify installation
brew --version
```

### Step 2: Install Docker Desktop

1. **Download Docker Desktop**
   - Visit [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
   - Download "Docker Desktop for Mac with Apple silicon"

2. **Install Docker Desktop**
   - Open the downloaded `.dmg` file
   - Drag Docker to Applications folder
   - Launch Docker from Applications

3. **Configure Docker Settings**
   - Open Docker Desktop
   - Click Settings (gear icon)
   - **Resources**:
     - CPUs: 4+ cores recommended
     - Memory: 8GB+ recommended
     - Swap: 2GB
     - Disk: 64GB+ recommended
   - Click "Apply & Restart"

4. **Verify Docker Installation**
   ```bash
   docker --version
   docker compose version
   docker run hello-world
   ```

### Step 3: Install Git and Node.js

```bash
# Install Git
brew install git

# Install Node.js
brew install node@20

# Verify installations
git --version
node --version
npm --version
```

### Step 4: GPU Configuration (Apple Silicon MPS)

Apple Silicon Macs have built-in GPU acceleration via Metal Performance Shaders (MPS).

The Kokoro processor will **automatically detect** and use MPS if available. No additional configuration needed!

### Step 5: Clone the Repository

```bash
# Create development directory
mkdir -p ~/development
cd ~/development

# Clone the repository
git clone https://github.com/jerroldneal/device-proxy-tts-kokoro-processor.git
cd device-proxy-tts-kokoro-processor
```

### Step 6: Create Required Directories

```bash
# Create TTS data directories
mkdir -p ~/.tts/{todo,working,done,mp3}

# Create temp directory
mkdir -p ~/temp
```

### Step 7: Update docker-compose.yml for macOS

Edit `docker-compose.yml` to use macOS paths:

```yaml
version: '3.8'

services:
  tts-kokoro-processor:
    build: .
    container_name: tts-kokoro-processor-instance
    environment:
      - USE_GPU=true  # MPS will be auto-detected
    ports:
      - "3021:3001"
    volumes:
      - ~/.tts:/app/data  # Changed from c:/.tts
      - ~/temp:/app/temp   # Changed from c:/temp
      - kokoro_hf_cache:/root/.cache/huggingface
      - ./processor.py:/app/processor.py
      - ../pipes/audio-driver-proxy/forward_pipe.py:/app/forward_pipe.py
      - ../pipes/audio-driver-proxy/forward_pipe_shim.sh:/app/forward_pipe.sh
    env_file:
      - .env
    restart: unless-stopped

volumes:
  kokoro_hf_cache:
```

### Step 8: Configure Environment

```bash
# Create .env file
cat > .env << 'EOF'
KOKORO_VOICE=af_heart
USE_GPU=true
EOF
```

### Step 9: Build and Start the Container

```bash
# Build the Docker image
docker compose build

# Start the service
docker compose up -d

# Check logs
docker compose logs -f
```

---

## Post-Installation Setup

### 1. Verify Service is Running

**Windows (PowerShell)**:
```powershell
# Check container status
docker ps

# Test API endpoint
curl http://localhost:3021/api/stats
```

**macOS**:
```bash
# Check container status
docker ps

# Test API endpoint
curl http://localhost:3021/api/stats
```

### 2. Test Audio Generation

#### File-based TTS (Both platforms)

**Windows**:
```powershell
# Create test file
"Hello from Kokoro TTS!" | Out-File -FilePath "C:\.tts\todo\test.txt" -Encoding UTF8

# Check done directory after a few seconds
Get-ChildItem "C:\.tts\done\"
```

**macOS**:
```bash
# Create test file
echo "Hello from Kokoro TTS!" > ~/.tts/todo/test.txt

# Check done directory after a few seconds
ls -la ~/.tts/done/
```

#### API-based TTS (Both platforms)

```bash
curl -X POST http://localhost:3021/api/speak \
  -H "Content-Type: application/json" \
  -d '{"text":"Testing Kokoro TTS processor","voice":"af_heart","speed":1.0}'
```

#### MP3 Generation Test

**Windows**:
```powershell
cd demo-kokoro
.\verify_mp3_output.ps1
```

**macOS**:
```bash
cd demo-kokoro

# Create test script
curl -X POST http://localhost:3021/api/speak \
  -H "Content-Type: application/json" \
  -d '{
    "text":"This is a test of MP3 file generation",
    "voice":"am_adam",
    "speed":1.0,
    "mp3":true,
    "mp3_path":"/app/data/mp3/test.mp3"
  }'

# Check output
ls -la ~/.tts/mp3/
```

---

## Verification

### Check Container Health

```bash
# View logs
docker compose logs --tail=50

# Check resource usage
docker stats tts-kokoro-processor-instance

# Inspect container
docker inspect tts-kokoro-processor-instance
```

### Expected Log Output

**CPU Mode** (Windows with incompatible GPU or basic setup):
```
[Python Log]: Initializing Kokoro Pipeline...
[Python Log]: GPU disabled via USE_GPU=false
[Python Log]: Using device: cpu
[Python Log]: Kokoro Pipeline Initialized.
```

**GPU Mode** (Windows with compatible NVIDIA GPU):
```
[Python Log]: Initializing Kokoro Pipeline...
[Python Log]: CUDA available: NVIDIA GeForce RTX 3060
[Python Log]: CUDA version: 12.8
[Python Log]: Using device: cuda
[Python Log]: Model successfully moved to CUDA
[Python Log]: GPU Memory Allocated: 245.67 MB
```

**MPS Mode** (macOS Apple Silicon):
```
[Python Log]: Initializing Kokoro Pipeline...
[Python Log]: MPS (Apple Silicon) available
[Python Log]: Using device: mps
[Python Log]: Model successfully moved to MPS
[Python Log]: Kokoro Pipeline Initialized.
```

### Available Voices

Test different voices:

```bash
# Female American voices
af_heart, af_bella, af_nicole, af_sarah, af_sky

# Male American voices
am_adam, am_michael

# Female British voices
bf_emma, bf_isabella

# Male British voices
bm_george, bm_lewis
```

Example:
```bash
curl -X POST http://localhost:3021/api/speak \
  -H "Content-Type: application/json" \
  -d '{"text":"Testing different voice","voice":"am_adam","speed":1.2}'
```

---

## Troubleshooting

### Windows Issues

#### Docker Desktop won't start
```powershell
# Restart Docker service
Restart-Service docker

# Or restart Docker Desktop
Stop-Process -Name "Docker Desktop" -Force
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

#### WSL 2 issues
```powershell
# Update WSL
wsl --update

# Set default version
wsl --set-default-version 2

# List distributions
wsl --list --verbose
```

#### Port 3021 already in use
```powershell
# Find process using port
netstat -ano | findstr :3021

# Kill process (replace PID)
taskkill /PID <PID> /F
```

#### Permission denied accessing C:\.tts
```powershell
# Run PowerShell as Administrator and create directories
New-Item -ItemType Directory -Path "C:\.tts" -Force
icacls "C:\.tts" /grant Everyone:F /T
```

### macOS Issues

#### Docker Desktop won't start
```bash
# Reset Docker Desktop
rm -rf ~/Library/Group\ Containers/group.com.docker
rm -rf ~/Library/Containers/com.docker.docker
rm -rf ~/.docker

# Reinstall Docker Desktop
```

#### Permission denied accessing ~/.tts
```bash
# Fix permissions
chmod -R 755 ~/.tts
chown -R $(whoami) ~/.tts
```

#### Port 3021 already in use
```bash
# Find process using port
lsof -i :3021

# Kill process
kill -9 <PID>
```

#### Rosetta issues
```bash
# Ensure Rosetta is not interfering
# Docker should run natively on Apple Silicon
# Check Docker is running in ARM mode:
docker run --rm alpine uname -m
# Should output: aarch64
```

### Common Issues (Both Platforms)

#### Container keeps restarting
```bash
# Check logs
docker compose logs --tail=100

# Common causes:
# 1. Missing dependencies - rebuild image
docker compose build --no-cache

# 2. Port conflict - change port in docker-compose.yml
# 3. Volume mount issues - check paths exist
```

#### Model download fails
```bash
# Clear Hugging Face cache and retry
docker compose down
docker volume rm tts-kokoro-processor_kokoro_hf_cache
docker compose up -d
```

#### Audio not playing
```bash
# Check audio pipe is forwarding (Windows)
# Ensure host-pipe service is running on port 3007

# For macOS, audio pipe may need configuration
# Check audio-driver-proxy logs
```

#### Slow performance (CPU mode)
```bash
# This is expected for CPU mode
# Solutions:
# 1. Use shorter text segments
# 2. Enable GPU (if compatible hardware available)
# 3. Increase Docker CPU allocation
# 4. Use MP3 mode for non-realtime generation
```

#### Out of memory errors
```bash
# Increase Docker memory allocation
# Docker Desktop → Settings → Resources → Memory
# Recommended: 8GB minimum, 16GB for large batches

# Or reduce batch size in requests
```

---

## Performance Tuning

### Windows GPU Users (RTX 3060+)

Edit `docker-compose.yml`:
```yaml
runtime: nvidia
environment:
  - NVIDIA_VISIBLE_DEVICES=all
  - USE_GPU=true
```

Rebuild:
```powershell
docker compose down
docker compose up -d --build
```

### macOS Apple Silicon Users

MPS should be auto-detected. Verify in logs:
```bash
docker compose logs | grep -i "mps\|device"
```

### Optimize Docker Resources

**Windows**:
- Docker Desktop → Settings → Resources
- Increase CPUs (4-8 cores)
- Increase Memory (8-16GB)

**macOS**:
- Docker Desktop → Settings → Resources
- Increase CPUs (4-8 cores)
- Increase Memory (8-16GB)
- Increase Disk space if model downloads are slow

---

## Uninstallation

### Windows

```powershell
# Stop and remove containers
cd C:\development\device-proxy-tts-kokoro-processor
docker compose down -v

# Remove Docker images
docker rmi tts-kokoro-processor-tts-kokoro-processor

# Remove data directories (optional)
Remove-Item -Path "C:\.tts" -Recurse -Force
Remove-Item -Path "C:\temp" -Recurse -Force

# Remove repository
cd ..
Remove-Item -Path "device-proxy-tts-kokoro-processor" -Recurse -Force
```

### macOS

```bash
# Stop and remove containers
cd ~/development/device-proxy-tts-kokoro-processor
docker compose down -v

# Remove Docker images
docker rmi tts-kokoro-processor-tts-kokoro-processor

# Remove data directories (optional)
rm -rf ~/.tts
rm -rf ~/temp

# Remove repository
cd ..
rm -rf device-proxy-tts-kokoro-processor
```

---

## Additional Resources

- **Project Repository**: [https://github.com/jerroldneal/device-proxy-tts-kokoro-processor](https://github.com/jerroldneal/device-proxy-tts-kokoro-processor)
- **Docker Documentation**: [https://docs.docker.com](https://docs.docker.com)
- **Kokoro Model**: [https://huggingface.co/hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
- **GPU Compatibility**: See `GPU_COMPATIBILITY.md` in this directory
- **Demo Scripts**: Check `demo-kokoro/` directory

---

## Getting Help

If you encounter issues not covered in this guide:

1. Check existing logs: `docker compose logs --tail=100`
2. Review the `GPU_COMPATIBILITY.md` for GPU-specific issues
3. Ensure all prerequisites are met
4. Try rebuilding with `docker compose build --no-cache`
5. Check GitHub Issues for similar problems

---

**Document Version**: 1.0
**Last Updated**: January 27, 2026
**Supported Platforms**: Windows 10/11, macOS 12+ (Apple Silicon)
