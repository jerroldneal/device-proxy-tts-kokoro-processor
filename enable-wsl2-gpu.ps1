# Enable WSL2 + GPU Support for Docker Desktop
Write-Host "Configuring Docker Desktop for WSL2 + GPU Support..." -ForegroundColor Green

# Check if Docker Desktop is running
$dockerProcess = Get-Process "Docker Desktop" -ErrorAction SilentlyContinue
if (-not $dockerProcess) {
    Write-Host "Docker Desktop is not running. Please start it first." -ForegroundColor Red
    exit 1
}

# Path to Docker Desktop settings
$settingsPath = Join-Path $env:APPDATA "Docker\settings.json"

if (-not (Test-Path $settingsPath)) {
    Write-Host "Docker Desktop settings file not found at: $settingsPath" -ForegroundColor Red
    exit 1
}

Write-Host "Found Docker settings at: $settingsPath" -ForegroundColor Cyan

# Read current settings
$settings = Get-Content $settingsPath -Raw | ConvertFrom-Json

Write-Host "`nCurrent Settings:" -ForegroundColor Yellow
Write-Host "  wslEngineEnabled: $($settings.wslEngineEnabled)"
Write-Host "  useWindowsContainers: $($settings.useWindowsContainers)"

# Enable WSL2 backend
$modified = $false

if ($settings.wslEngineEnabled -ne $true) {
    $settings.wslEngineEnabled = $true
    $modified = $true
    Write-Host "`n[MODIFIED] Enabled WSL2 engine" -ForegroundColor Green
}

if ($settings.useWindowsContainers -ne $false) {
    $settings.useWindowsContainers = $false
    $modified = $true
    Write-Host "[MODIFIED] Disabled Windows containers (using Linux containers)" -ForegroundColor Green
}

# Ensure GPU support is enabled (if property exists)
if ($null -ne $settings.PSObject.Properties["exposeDockerAPIOnTCP2375"]) {
    if ($settings.exposeDockerAPIOnTCP2375 -eq $true) {
        Write-Host "[INFO] Docker API exposed on TCP" -ForegroundColor Cyan
    }
}

if ($modified) {
    # Backup original settings
    $backupPath = "$settingsPath.backup"
    Copy-Item $settingsPath $backupPath -Force
    Write-Host "`nBackup created: $backupPath" -ForegroundColor Cyan

    # Save modified settings
    $settings | ConvertTo-Json -Depth 100 | Set-Content $settingsPath -Force
    Write-Host "Settings updated successfully!" -ForegroundColor Green

    Write-Host "`n[ACTION REQUIRED] Restart Docker Desktop for changes to take effect:" -ForegroundColor Yellow
    Write-Host "  1. Right-click Docker Desktop system tray icon" -ForegroundColor White
    Write-Host "  2. Select 'Quit Docker Desktop'" -ForegroundColor White
    Write-Host "  3. Start Docker Desktop again" -ForegroundColor White
    Write-Host "`nOr run: docker restart" -ForegroundColor Cyan
} else {
    Write-Host "`nNo changes needed. WSL2 backend is already enabled!" -ForegroundColor Green
}

Write-Host "`n=== WSL2 Distributions ===" -ForegroundColor Cyan
wsl --list --verbose

Write-Host "`n=== Additional GPU Setup ===" -ForegroundColor Yellow
Write-Host "For GPU support in WSL2 containers, ensure:" -ForegroundColor White
Write-Host "  1. NVIDIA driver for WSL2 is installed" -ForegroundColor White
Write-Host "  2. Docker Desktop > Settings > Resources > WSL Integration is enabled" -ForegroundColor White
Write-Host "  3. Your Ubuntu distribution is enabled in WSL Integration" -ForegroundColor White
Write-Host "`nTo verify GPU in WSL2:" -ForegroundColor Cyan
Write-Host "  wsl -d Ubuntu -- nvidia-smi" -ForegroundColor White
