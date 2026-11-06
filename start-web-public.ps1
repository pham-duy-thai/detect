$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'fall_detection_lstm'
$cloudflaredDir = Join-Path $projectRoot 'tools'
$cloudflaredExe = Join-Path $cloudflaredDir 'cloudflared.exe'
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
$localUrl = 'http://127.0.0.1:8000'
$env:MPLCONFIGDIR = Join-Path $projectRoot '.cache\matplotlib'
$env:YOLO_CONFIG_DIR = Join-Path $projectRoot '.cache\ultralytics'
New-Item -ItemType Directory -Path $env:MPLCONFIGDIR, $env:YOLO_CONFIG_DIR -Force | Out-Null
if ($env:FALLGUARD_ADMIN_RESET_PASSWORD) {
    Write-Host 'Admin password reset requested; it will be applied once and existing admin sessions revoked.' -ForegroundColor Yellow
}

if (-not (Test-Path (Join-Path $backendRoot 'backend\main.py'))) {
    throw "Khong tim thay backend tai $backendRoot"
}
if (-not (Test-Path (Join-Path $projectRoot 'frontend\index.html'))) {
    throw 'Khong tim thay giao dien web trong frontend.'
}
if (-not (Test-Path $pythonExe)) {
    $pythonCommand = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { throw 'Khong tim thay Python. Cai Python va dependencies theo muc 2 truoc.' }
    $pythonExe = $pythonCommand.Source
    Write-Host "Khong co .venv; se dung Python tren PATH: $pythonExe"
}

& $pythonExe -c "import uvicorn, fastapi" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Python environment thieu FastAPI/Uvicorn. Cai dependencies truoc bang: python -m pip install -r `"$backendRoot\backend\requirements.txt`""
}

$existingHealth = $null
try { $existingHealth = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 2 } catch { }
if ($existingHealth -and $existingHealth.status -eq 'ok') {
    throw 'Cong 8000 dang co backend chay. Hay dung backend cu bang Ctrl+C roi chay lai script nay.'
}
if (-not (Test-Path $cloudflaredExe)) {
    New-Item -ItemType Directory -Path $cloudflaredDir -Force | Out-Null
    $downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
    Write-Host 'Dang tai cloudflared chinh thuc tu GitHub Cloudflare...'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $cloudflaredExe
}

$backendProcess = $null
try {
    Write-Host 'Dang mo FallGuard API va giao dien PWA...'
    $backendProcess = Start-Process -FilePath $pythonExe -WindowStyle Hidden -PassThru `
        -WorkingDirectory $backendRoot `
        -ArgumentList @('-m', 'uvicorn', 'backend.main:app', '--host', '0.0.0.0', '--port', '8000') `
        -RedirectStandardOutput (Join-Path $backendRoot 'pwa-backend.log') `
        -RedirectStandardError (Join-Path $backendRoot 'pwa-backend-error.log')

    Write-Host 'Dang doi backend san sang...'
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($backendProcess.HasExited) { throw 'Backend dung som. Xem backend\pwa-backend-error.log de tim loi.' }
        try {
            $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 2
            if ($health.status -eq 'ok') { $ready = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw 'Backend chua san sang. Kiem tra backend\pwa-backend-error.log va thu chay lai.' }

    Write-Host ''
    Write-Host 'Tunnel HTTPS dang khoi dong; cho URL trycloudflare.com ben duoi.' -ForegroundColor Cyan
    Write-Host 'Mo URL nay trong Safari tren iPhone, dang nhap, sau do Chia se > Them vao man hinh chinh.' -ForegroundColor Cyan
    Write-Host 'Giu cua so nay mo khi su dung. Nhan Ctrl+C de dung tunnel va backend.' -ForegroundColor Yellow
    Write-Host 'URL tunnel tam thoi se thay doi moi lan chay.' -ForegroundColor Yellow
    Write-Host ''
    & $cloudflaredExe tunnel --url $localUrl
} finally {
    if ($backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id -Force
        Write-Host 'Backend da dung.'
    }
}
