param(
  [string]$ServerAddress = '127.0.0.1',
  [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
$postgresCommand = Get-Command pg_isready -ErrorAction SilentlyContinue
$postgresExecutable = if ($postgresCommand) {
  $postgresCommand.Source
} else {
  Join-Path $env:ProgramFiles 'PostgreSQL\18\bin\pg_isready.exe'
}
if (!(Test-Path -LiteralPath $postgresExecutable)) {
  throw 'pg_isready was not found. Add your PostgreSQL bin folder to PATH.'
}
& $postgresExecutable -h $ServerAddress -p $Port
exit $LASTEXITCODE
