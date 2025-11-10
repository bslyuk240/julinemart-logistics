Write-Host "🚀 Quick Auth Setup Helper" -ForegroundColor Cyan

Write-Host "`n1. Checking .env file..." -ForegroundColor Yellow
if (Test-Path ".env") {
    Write-Host "   ✅ .env file exists" -ForegroundColor Green
    $env = Get-Content ".env" -Raw
    if ($env -match "VITE_SUPABASE_URL" -and $env -match "VITE_SUPABASE_ANON_KEY") {
        Write-Host "   ✅ Required variables present" -ForegroundColor Green
    } else {
        Write-Host "   ❌ Missing required variables" -ForegroundColor Red
    }
} else {
    Write-Host "   ❌ .env file not found" -ForegroundColor Red
}

Write-Host "`n2. Next steps:" -ForegroundColor Yellow
Write-Host "   • Run database migrations in Supabase" -ForegroundColor White
Write-Host "   • Create demo users" -ForegroundColor White
Write-Host "   • Start servers: npm run api:dev & npm run dev" -ForegroundColor White
Write-Host "   • Visit: http://localhost:3000" -ForegroundColor White
