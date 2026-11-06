# Creates the local MariaDB databases and accounts for the HIMS MariaDB branch and writes web/.env.mariadb.local.
# Run from the INS folder:  powershell -NoProfile -File scripts/setup-local-mariadb.ps1
# The administrator (root) password is read privately, passed to the client only through an environment variable of that
# child process, and never saved. Existing databases, accounts and the env file are never overwritten.
$ErrorActionPreference = 'Stop'
$client = 'C:\Program Files\MariaDB 11.8\bin\mariadb.exe'
if (-not (Test-Path $client)) { throw "MariaDB 11.8 client not found at $client" }
$envFile = Join-Path $PSScriptRoot '..\web\.env.mariadb.local'
if (Test-Path $envFile) { throw "Refusing to overwrite existing $envFile" }

$secure = Read-Host 'MariaDB root password' -AsSecureString
$root = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
function Invoke-Sql([string]$sql) {
  $env:MYSQL_PWD = $root
  try { & $client -h127.0.0.1 -uroot -N -e $sql } finally { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
  if ($LASTEXITCODE -ne 0) { throw 'MariaDB command failed; no further changes were made.' }
}
function New-Secret { $bytes = New-Object byte[] 18; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x') }

$existing = Invoke-Sql "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('hims_local','hims_test')"
if ([int]$existing -ne 0) { throw 'hims_local or hims_test already exists; refusing to continue.' }
$users = Invoke-Sql "SELECT COUNT(*) FROM mysql.user WHERE User IN ('hims_app','hims_test_owner','hims_test_runtime')"
if ([int]$users -ne 0) { throw 'A HIMS database account already exists; refusing to continue.' }

$app = New-Secret; $owner = New-Secret; $runtime = New-Secret
$charset = 'CHARACTER SET utf8mb4 COLLATE utf8mb4_nopad_bin'
Invoke-Sql @"
CREATE DATABASE hims_local $charset;
CREATE DATABASE hims_test $charset;
CREATE USER 'hims_app'@'127.0.0.1' IDENTIFIED BY '$app';
CREATE USER 'hims_test_owner'@'127.0.0.1' IDENTIFIED BY '$owner';
CREATE USER 'hims_test_runtime'@'127.0.0.1' IDENTIFIED BY '$runtime';
GRANT ALL ON hims_local.* TO 'hims_app'@'127.0.0.1';
GRANT ALL ON hims_test.* TO 'hims_test_owner'@'127.0.0.1' WITH GRANT OPTION;
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON hims_test.* TO 'hims_test_runtime'@'127.0.0.1';
GRANT ALL ON ``hims\_test\_restore\_%``.* TO 'hims_test_owner'@'127.0.0.1';
GRANT PROCESS ON *.* TO 'hims_test_owner'@'127.0.0.1';
GRANT PROCESS ON *.* TO 'hims_test_runtime'@'127.0.0.1';
FLUSH PRIVILEGES;
"@

$authSecret = (New-Secret) + (New-Secret)
@"
DATABASE_URL=mysql://hims_app:$app@127.0.0.1:3306/hims_local
MIGRATION_DATABASE_URL=mysql://hims_app:$app@127.0.0.1:3306/hims_local
TEST_DATABASE_URL=mysql://hims_test_owner:$owner@127.0.0.1:3306/hims_test
TEST_RUNTIME_DATABASE_URL=mysql://hims_test_runtime:$runtime@127.0.0.1:3306/hims_test
BETTER_AUTH_SECRET=$authSecret
BETTER_AUTH_URL=http://localhost:3000
"@ | Set-Content -Path $envFile -NoNewline
Write-Host "Created hims_local and hims_test and wrote $envFile (ignored by Git). Next: npm --prefix web run db:migrate"
