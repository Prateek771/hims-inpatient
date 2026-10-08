$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bootstrap = Join-Path $projectRoot 'web\scripts\bootstrap-local-database.mjs'
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'
Write-Host 'HIMS local database setup'
Write-Host 'Creates new hims_local and hims_test databases and separate limited accounts.'
Write-Host 'Existing databases/accounts are never replaced. Your administrator password is not saved.'
do {
    $securePassword = Read-Host 'Enter the local PostgreSQL postgres password' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $env:HIMS_SETUP_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        & $nodeExecutable $bootstrap
        $setupExitCode = $LASTEXITCODE
    } finally {
        Remove-Item Env:HIMS_SETUP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        $securePassword.Dispose()
    }
    $retryPassword = $false
    if ($setupExitCode -eq 2) {
        $retryPassword = (Read-Host 'Password was incorrect. Try another password here? (y/n)') -eq 'y'
    }
} while ($retryPassword)
if ($setupExitCode -ne 0) {
    Write-Host 'Setup did not complete. Tell Codex the displayed message, without sharing passwords.'
} else {
    Write-Host 'Setup complete. You can return to Codex.'
}
Read-Host 'Press Enter to close'
exit $setupExitCode
