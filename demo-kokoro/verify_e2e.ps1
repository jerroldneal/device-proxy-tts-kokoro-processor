$ErrorActionPreference = "Stop"

$sharedPath = "C:\.tts"
$donePath = "$sharedPath\done"
$textToSpeak = "End to end verification successful. The system is fully operational with Kokoro TTS."

# Ensure done directory exists
if (-not (Test-Path $donePath)) {
    New-Item -ItemType Directory -Force -Path $donePath | Out-Null
}

# Get initial file count
$initialFiles = (Get-ChildItem $donePath).Count
Write-Host "Initial processed files: $initialFiles"

# Send Request
Write-Host "Sending request to HTTP Receiver..."
try {
    $response = Invoke-RestMethod -Uri "http://localhost:3006/read?text=$textToSpeak" -Method Get
    Write-Host "Response received:"
    Write-Host $response
}
catch {
    Write-Error "Failed to contact HTTP Receiver. Is it running? (Run start_services.ps1)"
}

# Poll for completion
Write-Host "Waiting for TTS processing..."
$timeout = 30 # Increased timeout for Kokoro model loading/inference
$sw = [System.Diagnostics.Stopwatch]::StartNew()

while ($sw.Elapsed.TotalSeconds -lt $timeout) {
    $currentFiles = (Get-ChildItem $donePath).Count
    if ($currentFiles -gt $initialFiles) {
        Write-Host "SUCCESS: New file detected in $donePath"
        Write-Host "The text should have been spoken."
        exit 0
    }
    Start-Sleep -Seconds 1
}

Write-Error "TIMEOUT: No new file appeared in $donePath after $timeout seconds."
exit 1
