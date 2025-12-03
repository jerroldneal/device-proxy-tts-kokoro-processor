$ErrorActionPreference = "Stop"

$text = "Don't really care so I'm just going to type in system. exit to make sure we don't get stuck in this infinite Loop otherwise it would print no no more rows indefinitely. But just like that we can run the file once again and first it's going to retrieve the first three elements. And if we want to continue reading or retrieving the rows we just tap on enter and it's going to give us three more on the spot. It's going to generate them on the spot and we can try one more time but since I have nothing left it's going to give us back the message of no of no more rows. So yeah that was the final example of the day. I hope this gave you a better understanding on how generators work. If you think there's anything I forgot to mention regarding generators please do leave that in the comment section down below so that other people can learn. But otherwise with all that being said as always thanks for watching and I'll see you in the next video."

$voice = "am_adam"
$encodedText = [Uri]::EscapeDataString("{voice:$voice} $text")
$uri = "http://localhost:3006/read?text=$encodedText"

Write-Host "Sending YouTube Transcript to TTS ($voice)..." -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri $uri -Method Get
    Write-Host "Request sent successfully." -ForegroundColor Green
}
catch {
    Write-Error "Failed to send TTS request: $_"
}
