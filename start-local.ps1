$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = "C:\Users\Xin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$Pnpm = "C:\Users\Xin\.cache\codex-tools\pnpm\package\bin\pnpm.cjs"
$Vite = Join-Path $ProjectRoot "node_modules\vite\bin\vite.js"
$Url = "http://127.0.0.1:5173/cv-analyzer-gui/"
$LogOut = Join-Path $ProjectRoot "local-server.out.log"
$LogErr = Join-Path $ProjectRoot "local-server.err.log"

if (-not (Test-Path -LiteralPath $Node)) {
  throw "Node runtime not found: $Node"
}

if (-not (Test-Path -LiteralPath $Pnpm)) {
  throw "pnpm runtime not found: $Pnpm"
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
  Push-Location $ProjectRoot
  try {
    & $Node $Pnpm install
  } finally {
    Pop-Location
  }
}

$listening = $false
try {
  $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
  $listening = $response.StatusCode -eq 200
} catch {
  $listening = $false
}

if (-not $listening) {
  if (-not (Test-Path -LiteralPath $Vite)) {
    Push-Location $ProjectRoot
    try {
      & $Node $Pnpm install
    } finally {
      Pop-Location
    }
  }
  Start-Process -FilePath $Node -ArgumentList @($Vite, "--host", "127.0.0.1", "--port", "5173") -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr
  Start-Sleep -Seconds 4
}

Start-Process $Url
Write-Host "CV Analyzer GUI local URL: $Url"
