$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Push-Location $PSScriptRoot

try {
    $npm = (Get-Command npm.cmd -CommandType Application).Source
    $packOutput = & $npm pack
    $packageFile = $packOutput |
        Where-Object { $_ -is [string] -and $_.Trim().EndsWith('.tgz') } |
        ForEach-Object { $_.Trim() } |
        Select-Object -Last 1

    if (-not $packageFile) {
        throw "npm pack did not return a package filename.`nOutput:`n$($packOutput -join [Environment]::NewLine)"
    }

    $packagePath = Join-Path $PSScriptRoot $packageFile
    & $npm install --no-save $packagePath
}
finally {
    Pop-Location
}
