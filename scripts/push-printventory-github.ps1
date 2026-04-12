# Commit project files (respecting .gitignore) and push to techjeeper/printventory.
# Uses a GitHub PAT from the environment — never commit tokens.
#
# Usage:
#   $env:GITHUB_TOKEN = "<your_personal_access_token>"
#   .\scripts\push-printventory-github.ps1                    # pushes to main
#   .\scripts\push-printventory-github.ps1 -Branch beta       # pushes to beta
#
# Requires repo scope on the token (read/write for private repos).

param(
    [ValidateSet("main", "beta")]
    [string]$Branch = "main",
    [switch]$Release   # Forwarded to upload-to-github.ps1 (release flow; typically use with main)
)

$ErrorActionPreference = "Stop"
if ($Release) {
    & "$PSScriptRoot\upload-to-github.ps1" -Branch $Branch -Release
} else {
    & "$PSScriptRoot\upload-to-github.ps1" -Branch $Branch
}
