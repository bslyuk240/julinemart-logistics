Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🚀 Starting JulineMart Logistics System" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan

Write-Host "`n📡 Starting API Server (Port 3001)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$PWD'; Write-Host '🔧 API Server' -ForegroundColor Cyan; npm run api:dev"
) -WindowStyle Normal

Write-Host "⏳ Waiting for API to initialize..." -ForegroundColor Gray
Start-Sleep -Seconds 5

Write-Host "`n🎨 Starting Dashboard (Port 3000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit", 
    "-Command",
    "cd '$PWD'; Write-Host '💻 Dashboard' -ForegroundColor Cyan; npm run dev"
) -WindowStyle Normal

Start-Sleep -Seconds 3

Write-Host "`n═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✅ SERVERS STARTED!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan

Write-Host "`n📍 Access Points:" -ForegroundColor Yellow
Write-Host "  API:       http://localhost:3001" -ForegroundColor White
Write-Host "  Dashboard: http://localhost:3000" -ForegroundColor White
Write-Host "  Login:     http://localhost:3000/login" -ForegroundColor White

Write-Host "`n💡 Tip: Keep both terminal windows open!" -ForegroundColor Cyan
Write-Host "Press any key to exit this message..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
