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
    # Small delay to ensure order (though the queue should handle it)
    Start-Sleep -Milliseconds 500
}

Write-Host "Starting Dialogue Simulation..." -ForegroundColor Cyan

# Dialogue
Send-TTS -Voice "am_michael" -Text "I really think he should stay here. The local state college has a great engineering program, and he'll save a fortune living at home."
Send-TTS -Voice "af_bella" -Text "But Michael, he needs to experience the world! Going away to college is about more than just classes. It's about independence."
Send-TTS -Voice "am_michael" -Text "Independence is expensive, Sarah. We're talking about forty thousand dollars a year versus five. That's a down payment on a house!"
Send-TTS -Voice "af_bella" -Text "Money isn't everything. If he stays here, he'll just be 'our little boy' for another four years. He needs to learn to do his own laundry, manage his own time."
Send-TTS -Voice "am_michael" -Text "He can do his own laundry here! I'll charge him rent if that makes you feel better. I just don't want him drowning in debt before he even starts his career."
Send-TTS -Voice "af_bella" -Text "He won't drown. We have savings, and he can work. You're just afraid of the empty nest, aren't you?"
Send-TTS -Voice "am_michael" -Text "Maybe a little. But I'm mostly afraid of the tuition bill."

Write-Host "Dialogue queued." -ForegroundColor Green
