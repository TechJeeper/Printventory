# Push Printventory to GitHub (TechJeeper/Printventory, main)
# Token must be set via environment: $env:GITHUB_TOKEN = "your_token"
# NEVER commit or store the token in this script or in the repo.

param(
    [switch]$Release,   # If set, create/update a release and upload dist assets
    [string]$RemoteName = "origin"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
Set-Location $rootDir

$repo = "TechJeeper/Printventory"
$repoUrl = "https://github.com/$repo.git"

# Token from environment only
$token = $env:GITHUB_TOKEN
if (-not $token) {
    Write-Host "ERROR: GITHUB_TOKEN is not set." -ForegroundColor Red
    Write-Host "Set it in this session: `$env:GITHUB_TOKEN = 'your_github_pat'" -ForegroundColor Yellow
    Write-Host "Or in System env vars (never commit the token)." -ForegroundColor Yellow
    exit 1
}

# Initialize git repo if needed
if (-not (Test-Path ".git")) {
    Write-Host "Not a git repository. Initializing..." -ForegroundColor Yellow
    git init
    git branch -M main 2>$null  # ensure branch is named main
    git remote add $RemoteName $repoUrl
    git add -A
    git commit -m "Initial commit - Printventory"
    Write-Host "Initial commit created." -ForegroundColor Green
} else {
    # Ensure current branch is main (create if missing)
    $currentBranch = git rev-parse --abbrev-ref HEAD 2>$null
    if ($currentBranch -ne "main") {
        git branch -M main 2>$null
    }
}

# Ensure remote exists
$remotes = git remote 2>$null
if ($remotes -notmatch $RemoteName) {
    Write-Host "Adding remote: $RemoteName -> $repo"
    git remote add $RemoteName $repoUrl
}

# Commit any uncommitted changes so we have something to push
$status = git status --porcelain 2>$null
if ($status) {
    Write-Host "Committing changes..." -ForegroundColor Yellow
    git add -A
    git commit -m "Update - Printventory"
}

$pushUrl = "https://${token}@github.com/$repo.git"
Write-Host "Pushing to $repo (main)..." -ForegroundColor Cyan
cmd /c "git push `"$pushUrl`" HEAD:main 2>&1"
$pushExit = $LASTEXITCODE
if ($pushExit -ne 0) {
    Write-Host "Remote has commits you don't have. Pulling and merging, then pushing again..." -ForegroundColor Yellow
    cmd /c "git pull `"$pushUrl`" main --no-edit --allow-unrelated-histories 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Pull failed (exit code $LASTEXITCODE)." -ForegroundColor Red
        exit $LASTEXITCODE
    }
    cmd /c "git push `"$pushUrl`" HEAD:main 2>&1"
    $pushExit = $LASTEXITCODE
}
if ($pushExit -ne 0) {
    Write-Host "Push failed (exit code $pushExit)." -ForegroundColor Red
    Write-Host "Common causes: invalid/expired GITHUB_TOKEN, no write access to $repo." -ForegroundColor Yellow
    exit $pushExit
}

Write-Host "Push to main succeeded." -ForegroundColor Green

if (-not $Release) {
    Write-Host "To create a release and upload assets, run with -Release" -ForegroundColor Gray
    exit 0
}

# --- Release: create tag/release and upload assets ---
$packageJson = Get-Content -Raw -Path "package.json" | ConvertFrom-Json
$version = $packageJson.version
$tag = "v$version"

# Check if tag exists locally
$tagExists = git tag -l $tag 2>$null
if (-not $tagExists) {
    Write-Host "Creating tag: $tag"
    git tag -a $tag -m "Release $version"
    git push $pushUrl $tag 2>&1
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$distDir = "dist"
$assets = @()
if (Test-Path $distDir) {
    $assets = @(Get-ChildItem -Path $distDir -File -Recurse | Where-Object { $_.Extension -match '\.(zip|exe|dmg|AppImage)$' })
}
if ($assets.Count -eq 0) {
    Write-Host "No release assets found in $distDir (zip, exe, dmg, AppImage). Skipping asset upload." -ForegroundColor Yellow
    exit 0
}

# Create or get release via GitHub API and upload assets
$headers = @{
    "Authorization" = "token $token"
    "Accept"        = "application/vnd.github.v3+json"
}
$apiBase = "https://api.github.com/repos/$repo"

# Get or create release
$releases = Invoke-RestMethod -Uri "$apiBase/releases" -Headers $headers -Method Get
$release = $releases | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
if (-not $release) {
    $body = @{ tag_name = $tag; name = $tag; body = "Release $version" } | ConvertTo-Json
    $release = Invoke-RestMethod -Uri "$apiBase/releases" -Headers $headers -Method Post -Body $body -ContentType "application/json; charset=utf-8"
    Write-Host "Created release: $tag"
} else {
    Write-Host "Using existing release: $tag"
}

$uploadUrl = $release.upload_url -replace '\{\?name,label\}', ''
foreach ($asset in $assets) {
    $name = $asset.Name
    $fullPath = $asset.FullName
    $uri = "$uploadUrl?name=$name"
    Write-Host "Uploading: $name"
    $contentType = "application/octet-stream"
    if ($asset.Extension -eq ".zip") { $contentType = "application/zip" }
    $headersUpload = @{
        "Authorization" = "token $token"
        "Content-Type"  = $contentType
    }
    try {
        Invoke-RestMethod -Uri $uri -Headers $headersUpload -Method Post -InFile $fullPath
    } catch {
        Write-Host "  Warning: upload failed for $name - $_" -ForegroundColor Yellow
    }
}

Write-Host "Release $tag updated with assets." -ForegroundColor Green
