Write-Host "Starting HTTP Receiver..."
Set-Location "$PSScriptRoot\..\http-receiver"
docker-compose up -d

Write-Host "Starting TTS Kokoro Processor..."
Set-Location "$PSScriptRoot\..\tts-kokoro-processor"
docker-compose up -d

Write-Host "All services started."
Set-Location "$PSScriptRoot"
