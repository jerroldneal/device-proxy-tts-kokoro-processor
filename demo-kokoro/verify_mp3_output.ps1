$ErrorActionPreference = "Stop"

$mp3OutputPath = "C:\temp\kokoro_test_output.mp3"
$apiUrl = "http://localhost:3021/api/speak"

Write-Host "=== Kokoro TTS MP3 Output Verification ===" -ForegroundColor Cyan
Write-Host ""

# Clean up any existing output file
if (Test-Path $mp3OutputPath) {
    Write-Host "Removing existing MP3 file..." -ForegroundColor Yellow
    Remove-Item $mp3OutputPath -Force
}

# Prepare the test text
$testText = @"
Hello! This is a verification of the MP3 output feature for Kokoro TTS.
{voice:am_michael} Now switching to Michael's voice.
{speed:1.2} Speaking a bit faster now.
{speed:0.9} And now slower.
{voice:af_bella} Back to Bella's voice at normal speed.
This MP3 file demonstrates dynamic voice and speed control.
"@

Write-Host "Test text prepared:" -ForegroundColor Green
Write-Host $testText
Write-Host ""

# Create the request body
$requestBody = @{
    text = $testText
    voice = "af_heart"
    speed = 1.0
    mp3 = $true
    mp3_path = $mp3OutputPath
} | ConvertTo-Json

Write-Host "Sending MP3 generation request to $apiUrl..." -ForegroundColor Cyan

try {
    # Send the request
    $response = Invoke-RestMethod -Uri $apiUrl -Method Post -Body $requestBody -ContentType "application/json"
    Write-Host "Response received:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 10)
    Write-Host ""

    # Wait a moment for file generation
    Write-Host "Waiting for MP3 file generation..." -ForegroundColor Yellow
    $timeout = 60
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    while ($sw.Elapsed.TotalSeconds -lt $timeout) {
        if (Test-Path $mp3OutputPath) {
            $fileInfo = Get-Item $mp3OutputPath
            if ($fileInfo.Length -gt 0) {
                Write-Host "SUCCESS: MP3 file created!" -ForegroundColor Green
                Write-Host "  Location: $mp3OutputPath" -ForegroundColor Cyan
                Write-Host "  Size: $($fileInfo.Length) bytes" -ForegroundColor Cyan
                Write-Host "  Created: $($fileInfo.CreationTime)" -ForegroundColor Cyan
                Write-Host ""

                # Verify it's a valid MP3 by checking the header
                $bytes = [System.IO.File]::ReadAllBytes($mp3OutputPath)
                if ($bytes.Length -gt 2 -and $bytes[0] -eq 0xFF -and ($bytes[1] -band 0xE0) -eq 0xE0) {
                    Write-Host "MP3 header validation: PASSED (Valid MP3 file)" -ForegroundColor Green
                } elseif ($bytes.Length -gt 4 -and $bytes[0] -eq 0x49 -and $bytes[1] -eq 0x44 -and $bytes[2] -eq 0x33) {
                    Write-Host "MP3 header validation: PASSED (MP3 with ID3 tags)" -ForegroundColor Green
                } else {
                    Write-Host "WARNING: File does not appear to be a valid MP3" -ForegroundColor Yellow
                }

                Write-Host ""
                Write-Host "You can play the file with:" -ForegroundColor Cyan
                Write-Host "  Start-Process '$mp3OutputPath'" -ForegroundColor White
                Write-Host ""
                Write-Host "Or via the play-mp3 endpoint:" -ForegroundColor Cyan
                Write-Host "  curl 'http://localhost:3006/play-mp3?filePath=$([System.Uri]::EscapeDataString($mp3OutputPath))'" -ForegroundColor White

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
