# Enable GPU Support in Docker Desktop (WSL2)

## Current Status ✅
- **WSL2**: Enabled and running
- **GPU in WSL2**: Working (nvidia-smi shows TITAN Xp)
- **Docker Backend**: WSL2 (confirmed)

## Problem
Even though Docker is using WSL2, GPU isn't properly exposed to containers because Docker Desktop GPU settings aren't enabled.

## Solution Steps

### 1. Open Docker Desktop Settings
- Right-click Docker Desktop icon in system tray
- Click "Settings" or "Dashboard" then click gear icon

### 2. Enable WSL 2 Integration
- Go to: **Resources → WSL Integration**
- Enable "Enable integration with my default WSL distro"
- Enable integration for your Ubuntu distribution
- Click "Apply & Restart"

### 3. Enable GPU Support (CRITICAL)
- Go to: **Resources → Advanced** or **Resources → GPU**
- Look for "Enable GPU" or "Use WSL 2 based engine with GPU support"
- **Enable this option**
- Click "Apply & Restart"

### 4. Verify GPU Access
After Docker Desktop restarts, run from Windows terminal:
```bash
# Check Docker is using WSL2
docker info | grep -i wsl2

# Test GPU in Docker container
docker run --rm --gpus all nvidia/cuda:11.7.1-base-ubuntu22.04 nvidia-smi
```

### 5. Rebuild Kokoro Container
Once GPU access is confirmed:
```bash
cd /d/development/device-proxy-docker/tts-kokoro-processor
docker-compose down
docker-compose up -d --build
```

## Alternative: If GPU Settings Not Available in UI

If you don't see GPU options in Docker Desktop settings, you may need to:

1. Update Docker Desktop to latest version
2. Or manually enable in daemon.json:
   - Location: `%USERPROFILE%\.docker\daemon.json`
   - Add: `{"features": {"buildkit": true}, "experimental": true}`
   - Restart Docker Desktop

## Verification Commands

After configuration:
```bash
# GPU accessible in WSL2
wsl -d Ubuntu -- nvidia-smi

# GPU accessible in Docker
docker run --rm --gpus all nvidia/cuda:11.7.1-base-ubuntu22.04 nvidia-smi

# Check container GPU
docker exec tts-kokoro-processor-instance nvidia-smi
```

## If Still Not Working

The `--gpus all` flag requires Docker daemon to have GPU support enabled. If it still

 fails, try:
1. Restart Docker Desktop completely (Quit and reopen)
2. Restart Windows (sometimes required for GPU driver updates)
3. Update NVIDIA driver to latest version supporting WSL2

## Final Check
Once working, your container logs should show:
```
[Python Log]: CUDA available: NVIDIA TITAN Xp
[Python Log]: Model successfully moved to CUDA
[Python Log]: GPU Memory Allocated: 318.64 MB
```

And NOT show:
```
Error: libcuda.so: cannot open shared object file
```
