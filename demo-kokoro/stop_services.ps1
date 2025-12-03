Write-Host "Stopping TTS Kokoro Processor..."
Set-Location "$PSScriptRoot\..\tts-kokoro-processor"
docker-compose down

Write-Host "Stopping HTTP Receiver..."
Set-Location "$PSScriptRoot\..\http-receiver"
docker-compose down

Write-Host "All services stopped."
Set-Location "$PSScriptRoot"
