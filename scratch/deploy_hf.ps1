# Automated Deploy script to Hugging Face Spaces
$username = "Selmabcpdchozz00"
$spaceName = "azzoug-backend"

Write-Host "--- Automated Hugging Face Space Deployer ---" -ForegroundColor Green
$token = Read-Host -Prompt "Enter your Hugging Face Write Access Token (from https://huggingface.co/settings/tokens)"

if (-not $token) {
    Write-Error "Token is required."
    exit 1
}

$tempDir = Join-Path $env:TEMP "azzoug-backend-hf"
if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "Cloning Hugging Face Space repository..." -ForegroundColor Cyan
$cloneUrl = "https://oauth2:$($token)@huggingface.co/spaces/$($username)/$($spaceName)"
git clone $cloneUrl $tempDir

if (-not (Test-Path $tempDir)) {
    Write-Error "Failed to clone repository."
    exit 1
}

Write-Host "Copying backend files..." -ForegroundColor Cyan
$backendDir = "c:\Users\ZBOOK\Downloads\azzougshop\backend"

# Copy app directory, requirements, start script
Copy-Item -Path (Join-Path $backendDir "app") -Destination $tempDir -Recurse -Force
Copy-Item -Path (Join-Path $backendDir "requirements.txt") -Destination $tempDir -Force
Copy-Item -Path (Join-Path $backendDir "start_hf.sh") -Destination $tempDir -Force

# Copy Dockerfile.hf to Dockerfile in destination
Copy-Item -Path (Join-Path $backendDir "Dockerfile.hf") -Destination (Join-Path $tempDir "Dockerfile") -Force

# Change to temp directory
Push-Location $tempDir

Write-Host "Configuring Git user..." -ForegroundColor Cyan
git config user.name "Selma"
git config user.email "selmaahacii@gmail.com"

Write-Host "Staging and committing files..." -ForegroundColor Cyan
git add -A
git commit -m "Deploy production FastAPI backend with Celery & Redis"

Write-Host "Pushing to Hugging Face Space..." -ForegroundColor Green
git push origin main

Pop-Location
Write-Host "--- Deployment complete! Space is now building. ---" -ForegroundColor Green
