param(
  [int]$Port = $(if ($env:LIBRARY_PORT) { [int]$env:LIBRARY_PORT } else { 8080 })
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
  Write-Error "Library Web Preview needs Deno 2.9.6 or newer. Install Deno from https://deno.com/ and run this script again."
}

& deno run --allow-all "$PSScriptRoot\deno\src\main.ts" $Port
exit $LASTEXITCODE
