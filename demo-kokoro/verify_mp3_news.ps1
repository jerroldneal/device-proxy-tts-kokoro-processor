# MP3 Generation Test - Today's News Report
# Tests MP3 file generation with a realistic news report

$newsReport = @"
Good evening, this is your news report for Monday, January 27th, 2026.

In technology news, artificial intelligence continues to reshape industries worldwide. Major tech companies are announcing significant breakthroughs in natural language processing and computer vision. The integration of AI assistants into everyday workflows has reached unprecedented levels, with productivity gains reported across multiple sectors.

In space exploration, NASA's Artemis program has achieved another milestone. The latest mission to establish a sustainable lunar presence has successfully completed its initial phase. International partners are collaborating on the development of the lunar gateway, which will serve as a staging point for future Mars missions.

Climate and environmental news remains at the forefront. Global renewable energy capacity has reached new records this quarter, with solar and wind installations exceeding previous year projections. Several nations have announced accelerated timelines for achieving carbon neutrality, citing technological advances in energy storage and grid management.

In the financial sector, digital currencies and blockchain technology continue to evolve. Central banks worldwide are advancing their digital currency initiatives, while regulatory frameworks are being refined to address emerging challenges in the decentralized finance ecosystem.

The healthcare industry is experiencing transformative changes through biotechnology advancements. New treatments leveraging gene therapy and personalized medicine are showing promising results in clinical trials. Telemedicine platforms have become standard practice, improving healthcare accessibility in remote areas.

In sports, preparations for the 2026 FIFA World Cup are entering their final phases. Host cities are completing infrastructure upgrades, and teams worldwide are intensifying their training regimens. The tournament promises to showcase the latest in sports technology, including advanced analytics and player performance monitoring systems.

Cultural events are returning to pre-pandemic levels, with major festivals and exhibitions attracting international audiences. The arts community continues to explore innovative formats, blending physical and digital experiences to reach broader audiences.

In education, adaptive learning technologies are transforming classroom experiences. Personalized curriculum delivery based on individual student needs is becoming more sophisticated, with AI-powered tutoring systems providing real-time support.

Looking ahead to the rest of the week, economic indicators will be closely watched as markets respond to recent policy announcements. Weather forecasts predict a mix of conditions across different regions, with some areas expecting significant precipitation.

That concludes tonight's news report. Stay informed, stay safe, and we'll see you tomorrow with more updates. Good night.
"@

Write-Host "=== Today's News Report - MP3 Generation ===" -ForegroundColor Cyan
Write-Host ""

# Configuration
$hostMp3Path = "C:\.tts\mp3\news_report_2026_01_27.mp3"
$containerMp3Path = "/app/data/mp3/news_report_2026_01_27.mp3"
$voice = "am_adam"
$speed = 1.0

Write-Host "Host path: $hostMp3Path" -ForegroundColor Yellow
Write-Host "Container path: $containerMp3Path" -ForegroundColor Yellow
Write-Host ""

# Remove existing MP3 file if it exists
if (Test-Path $hostMp3Path) {
    Write-Host "Removing existing MP3 file..." -ForegroundColor Gray
    Remove-Item $hostMp3Path -Force
}

# Display text info
Write-Host "News Report: January 27, 2026" -ForegroundColor Green
Write-Host "Voice: $voice (Male American English)" -ForegroundColor Green
Write-Host "Speed: $speed" -ForegroundColor Green
Write-Host "Length: $($newsReport.Length) characters" -ForegroundColor Green
Write-Host ""

# Prepare request body
$body = @{
    text = $newsReport
    voice = $voice
    speed = $speed
    mp3 = $true
    mp3_path = $containerMp3Path
} | ConvertTo-Json

# Send request
Write-Host "Sending MP3 generation request to http://localhost:3021/api/speak..." -ForegroundColor Cyan
Write-Host "This may take 2-4 minutes for CPU processing..." -ForegroundColor Yellow
Write-Host ""

$startTime = Get-Date

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3021/api/speak" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 300

    Write-Host "Response received:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json) -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Error "Failed to send request: $_"
    exit 1
}

# Wait for file to be created
Write-Host "Waiting for MP3 file generation..." -ForegroundColor Yellow
$maxWait = 300  # 5 minutes
$waited = 0
$checkInterval = 2

while (-not (Test-Path $hostMp3Path) -and $waited -lt $maxWait) {
    Start-Sleep -Seconds $checkInterval
    $waited += $checkInterval
    Write-Host "." -NoNewline -ForegroundColor Gray
}

Write-Host ""
$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds

if (Test-Path $hostMp3Path) {
    Write-Host "SUCCESS! MP3 file created." -ForegroundColor Green
    Write-Host ""
    Write-Host "File Information:" -ForegroundColor Cyan
    $fileInfo = Get-Item $hostMp3Path
    Write-Host "  Path: $($fileInfo.FullName)" -ForegroundColor White
    Write-Host "  Size: $([math]::Round($fileInfo.Length / 1KB, 2)) KB" -ForegroundColor White
    Write-Host "  Created: $($fileInfo.CreationTime)" -ForegroundColor White
    Write-Host ""
    Write-Host "Generation Time: $([math]::Round($duration, 2)) seconds" -ForegroundColor Cyan
    Write-Host "Text Length: $($newsReport.Length) characters" -ForegroundColor Cyan
    Write-Host "Processing Speed: $([math]::Round($newsReport.Length / $duration, 2)) chars/sec" -ForegroundColor Cyan
    Write-Host ""

    # Verify MP3 file header
    $bytes = [System.IO.File]::ReadAllBytes($hostMp3Path)
    if ($bytes.Length -gt 3) {
        $header = [System.BitConverter]::ToString($bytes[0..2])
        if ($header -like "*FF-FB*" -or $header -like "*49-44-33*") {
            Write-Host "MP3 file validation: PASSED (valid MP3 header detected)" -ForegroundColor Green
        } else {
            Write-Host "MP3 file validation: WARNING (unexpected header: $header)" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "You can play the file with:" -ForegroundColor Cyan
    Write-Host "  Start-Process '$hostMp3Path'" -ForegroundColor White

} else {
    Write-Host "TIMEOUT: MP3 file was not created within $maxWait seconds" -ForegroundColor Red
    Write-Host ""
    Write-Host "Checking container logs:" -ForegroundColor Yellow
    docker logs tts-kokoro-processor-instance --tail 30
}
