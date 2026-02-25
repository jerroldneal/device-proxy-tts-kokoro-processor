$ErrorActionPreference = "Stop"

# Use the mounted volume path (C:\.tts maps to /app/data in container)
$hostMp3Path = "C:\.tts\mp3\gettysburg_address.mp3"
$containerMp3Path = "/app/data/mp3/gettysburg_address.mp3"
$apiUrl = "http://localhost:3021/api/speak"

# Ensure the mp3 directory exists
$mp3Dir = "C:\.tts\mp3"
if (-not (Test-Path $mp3Dir)) {
    New-Item -ItemType Directory -Force -Path $mp3Dir | Out-Null
}

Write-Host "=== Gettysburg Address MP3 Generation ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Host path: $hostMp3Path" -ForegroundColor Gray
Write-Host "Container path: $containerMp3Path" -ForegroundColor Gray
Write-Host ""

# Clean up any existing output file
if (Test-Path $hostMp3Path) {
    Write-Host "Removing existing MP3 file..." -ForegroundColor Yellow
    Remove-Item $hostMp3Path -Force
}

# The Gettysburg Address
$text = "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal. Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. We are met on a great battle-field of that war. We have come to dedicate a portion of that field, as a final resting place for those who here gave their lives that that nation might live. It is altogether fitting and proper that we should do this. But, in a larger sense, we can not dedicate -- we can not consecrate -- we can not hallow -- this ground. The brave men, living and dead, who struggled here, have consecrated it, far above our poor power to add or detract. The world will little note, nor long remember what we say here, but it can never forget what they did here. It is for us the living, rather, to be dedicated here to the unfinished work which they who fought here have thus far so nobly advanced. It is rather for us to be here dedicated to the great task remaining before us -- that from these honored dead we take increased devotion to that cause for which they gave the last full measure of devotion -- that we here highly resolve that these dead shall not have died in vain -- that this nation, under God, shall have a new birth of freedom -- and that government of the people, by the people, for the people, shall not perish from the earth."

Write-Host "Text: Gettysburg Address" -ForegroundColor Green
Write-Host "Length: $($text.Length) characters" -ForegroundColor Gray
Write-Host ""

# Create the request body (use container path for mp3_path)
$requestBody = @{
    text = $text
    voice = "am_adam"
    speed = 1.0
    mp3 = $true
    mp3_path = $containerMp3Path
} | ConvertTo-Json

Write-Host "Sending MP3 generation request to $apiUrl..." -ForegroundColor Cyan

try {
    # Send the request
    $response = Invoke-RestMethod -Uri $apiUrl -Method Post -Body $requestBody -ContentType "application/json"
    Write-Host "Response received:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 10)
    Write-Host ""

    # Wait for file generation (longer timeout for larger text)
    Write-Host "Waiting for MP3 file generation (this may take a minute)..." -ForegroundColor Yellow
    $timeout = 120
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    while ($sw.Elapsed.TotalSeconds -lt $timeout) {
        if (Test-Path $hostMp3Path) {
            $fileInfo = Get-Item $hostMp3Path
            if ($fileInfo.Length -gt 0) {
                Write-Host "SUCCESS: MP3 file created!" -ForegroundColor Green
                Write-Host "  Host Location: $hostMp3Path" -ForegroundColor Cyan
                Write-Host "  Container Location: $containerMp3Path" -ForegroundColor Gray
                Write-Host "  Size: $($fileInfo.Length) bytes ($([Math]::Round($fileInfo.Length/1KB, 2)) KB)" -ForegroundColor Cyan
                Write-Host "  Created: $($fileInfo.CreationTime)" -ForegroundColor Cyan
                Write-Host ""

                # Verify it's a valid MP3 by checking the header
                $bytes = [System.IO.File]::ReadAllBytes($hostMp3Path)
                if ($bytes.Length -gt 2 -and $bytes[0] -eq 0xFF -and ($bytes[1] -band 0xE0) -eq 0xE0) {
                    Write-Host "MP3 header validation: PASSED (Valid MP3 file)" -ForegroundColor Green
                } elseif ($bytes.Length -gt 4 -and $bytes[0] -eq 0x49 -and $bytes[1] -eq 0x44 -and $bytes[2] -eq 0x33) {
                    Write-Host "MP3 header validation: PASSED (MP3 with ID3 tags)" -ForegroundColor Green
                } else {
                    Write-Host "WARNING: File does not appear to be a valid MP3" -ForegroundColor Yellow
                }

                Write-Host ""
                Write-Host "You can play the file with:" -ForegroundColor Cyan
                Write-Host "  Start-Process '$hostMp3Path'" -ForegroundColor White
                Write-Host ""
                Write-Host "Or via the play-mp3 endpoint:" -ForegroundColor Cyan
                Write-Host "  curl 'http://localhost:3006/play-mp3?filePath=$([System.Uri]::EscapeDataString($hostMp3Path))'" -ForegroundColor White

                exit 0
            }
        }
        Start-Sleep -Milliseconds 500
    }

    Write-Error "TIMEOUT: MP3 file was not created within $timeout seconds"
    exit 1

} catch {
    Write-Error "Failed to send request: $_"
    Write-Host "Error Details:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $reader.BaseStream.Position = 0
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody" -ForegroundColor Red
    }
    exit 1
}
