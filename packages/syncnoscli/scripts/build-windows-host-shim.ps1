[CmdletBinding()]
param(
  [string]$Zig = 'zig'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $packageRoot 'native-host-shim/win32/main.c'
$prebuildRoot = Join-Path $packageRoot 'prebuilds'
$targets = [ordered]@{
  'win32-x64' = 'x86_64-windows-gnu'
  'win32-arm64' = 'aarch64-windows-gnu'
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

$artifacts = [ordered]@{}
foreach ($name in $targets.Keys) {
  $outputDirectory = Join-Path $prebuildRoot $name
  $output = Join-Path $outputDirectory 'syncnos-native-host.exe'
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

  & $Zig cc `
    -target $targets[$name] `
    -Oz `
    -s `
    -DUNICODE `
    -D_UNICODE `
    -municode `
    -Wl,--subsystem,windows `
    $source `
    -lbcrypt `
    -lcrypt32 `
    -lshell32 `
    -lshlwapi `
    -o $output
  if ($LASTEXITCODE -ne 0) {
    throw "zig failed while building $name"
  }

  $artifacts[$name] = [ordered]@{
    file = "$name/syncnos-native-host.exe"
    sha256 = Get-Sha256 $output
  }
}

$manifest = [ordered]@{
  version = 1
  sourceSha256 = Get-Sha256 $source
  artifacts = $artifacts
}
$manifestPath = Join-Path $prebuildRoot 'manifest.json'
$utf8WithoutBom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4) + [Environment]::NewLine, $utf8WithoutBom)
