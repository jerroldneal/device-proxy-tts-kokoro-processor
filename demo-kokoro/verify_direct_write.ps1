$ErrorActionPreference = "Stop"

$sharedPath = "C:\.tts"
$todoPath = "$sharedPath\todo"
$donePath = "$sharedPath\done"
$targetFileName = "direct_write_test_kokoro.txt"
$targetFilePath = Join-Path $donePath $targetFileName
$sourceFilePath = Join-Path $todoPath $targetFileName

# Ensure directories exist
if (-not (Test-Path $todoPath)) {
    New-Item -ItemType Directory -Force -Path $todoPath | Out-Null
}
if (-not (Test-Path $donePath)) {
    New-Item -ItemType Directory -Force -Path $donePath | Out-Null
}

# Clean up previous test run
if (Test-Path $targetFilePath) {
    Remove-Item $targetFilePath -Force
}
if (Test-Path $sourceFilePath) {
    Remove-Item $sourceFilePath -Force
}

# Write file directly to todo folder
Write-Host "Writing file directly to $sourceFilePath..."
"This is a direct write test for Kokoro TTS." | Set-Content $sourceFilePath

# Poll for completion
Write-Host "Waiting for TTS processing..."
$timeout = 30
$sw = [System.Diagnostics.Stopwatch]::StartNew()

while ($sw.Elapsed.TotalSeconds -lt $timeout) {
    if (Test-Path $targetFilePath) {
        Write-Host "SUCCESS: File detected in $donePath"
        $content = Get-Content $targetFilePath -Raw
        if ($content -match "This is a direct write test for Kokoro TTS") {
            Write-Host "Content verification passed."
            exit 0
        }
    }
    Start-Sleep -Seconds 1
}

Write-Error "TIMEOUT: File did not appear in done folder."
exit 1
