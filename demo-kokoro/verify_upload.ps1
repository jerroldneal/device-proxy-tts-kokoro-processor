$ErrorActionPreference = "Stop"

$sharedPath = "C:\.tts"
$donePath = "$sharedPath\done"
$targetFileName = "upload_test_kokoro.txt"
$targetFilePath = Join-Path $donePath $targetFileName
$localTestFile = "$PSScriptRoot\upload_source_kokoro.txt"

# Create a local test file
"This is an uploaded file test for Kokoro TTS." | Set-Content $localTestFile

# Ensure done directory exists
if (-not (Test-Path $donePath)) {
    New-Item -ItemType Directory -Force -Path $donePath | Out-Null
}

# Clean up previous test run
if (Test-Path $targetFilePath) {
    Remove-Item $targetFilePath -Force
}

# Send Request
Write-Host "Uploading file to HTTP Receiver..."

try {
    # Using .NET HttpClient for reliable multipart upload in PowerShell
    $httpClient = New-Object System.Net.Http.HttpClient
    $content = New-Object System.Net.Http.MultipartFormDataContent
    $fileStream = [System.IO.File]::OpenRead($localTestFile)
    $fileContent = New-Object System.Net.Http.StreamContent($fileStream)
    $content.Add($fileContent, "file", $targetFileName)

    $response = $httpClient.PostAsync("http://localhost:3006/read", $content).Result

    if (-not $response.IsSuccessStatusCode) {
        throw "HTTP Error: $($response.StatusCode)"
    }

    $responseBody = $response.Content.ReadAsStringAsync().Result

    Write-Host "Response received:"
    Write-Host $responseBody

    $fileStream.Dispose()
    $httpClient.Dispose()
}
catch {
    Write-Error "Failed to upload file: $_"
}

# Poll for completion
Write-Host "Waiting for TTS processing..."
$timeout = 30
$sw = [System.Diagnostics.Stopwatch]::StartNew()

while ($sw.Elapsed.TotalSeconds -lt $timeout) {
    if (Test-Path $targetFilePath) {
        Write-Host "SUCCESS: File detected in $donePath"
        $content = Get-Content $targetFilePath -Raw
        if ($content -match "This is an uploaded file test for Kokoro TTS") {
            Write-Host "Content verification passed."
            if (Test-Path $localTestFile) { Remove-Item $localTestFile }
            exit 0
        }
    }
    Start-Sleep -Seconds 1
}

Write-Error "TIMEOUT: File did not appear."
exit 1
