$ErrorActionPreference = "Stop"

function Send-TTS {
    param (
        [string]$Text,
        [string]$Voice
    )
    $encodedText = [Uri]::EscapeDataString("{voice:$Voice} $Text")
    $uri = "http://localhost:3006/read?text=$encodedText"

    Write-Host "[$Voice]: $Text"
    try {
        $response = Invoke-RestMethod -Uri $uri -Method Get
    }
    catch {
        Write-Error "Failed to send TTS request: $_"
    }
    Start-Sleep -Milliseconds 800
}

Write-Host "Starting Dialogue Simulation 2 (Tabs vs Spaces)..." -ForegroundColor Cyan

Send-TTS -Voice "am_adam" -Text "I can't believe you just committed that. Spaces? Really?"
Send-TTS -Voice "af_nicole" -Text "It's about consistency, Adam. The style guide clearly says two spaces."
Send-TTS -Voice "am_adam" -Text "The style guide is wrong. Tabs are semantic. They let the user decide the indentation width."
Send-TTS -Voice "af_nicole" -Text "And have the code look like a staircase on a 4k monitor? No thanks. Precision matters."
Send-TTS -Voice "am_adam" -Text "Precision? You're pressing the space bar twice for every level of indentation. It's inefficient."
Send-TTS -Voice "af_nicole" -Text "It's 2025. The IDE does it for me. I haven't manually pressed space for indentation in years."
Send-TTS -Voice "am_adam" -Text "Fine. But when we merge this, I'm running a formatter."
Send-TTS -Voice "af_nicole" -Text "Don't you dare. I'll revert it."

Write-Host "Dialogue queued." -ForegroundColor Green
