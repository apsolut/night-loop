$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$entryPoint = Join-Path $projectRoot "src/cli.ts"

& bun $entryPoint @args
exit $LASTEXITCODE
