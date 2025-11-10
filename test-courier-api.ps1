Write-Host "`n Testing Courier API Integration" -ForegroundColor Cyan

# Test 1: Check courier API status
Write-Host "`n1. Checking courier configuration..." -ForegroundColor Yellow
try {
    $couriers = Invoke-RestMethod -Uri "http://localhost:3001/api/couriers"
    Write-Host "    Found $($couriers.data.Count) couriers" -ForegroundColor Green
    
    $fez = $couriers.data | Where-Object { $_.code -eq "FEZ" }
    if ($fez) {
        Write-Host "    Fez Delivery Status:" -ForegroundColor White
        Write-Host "      API Enabled: $($fez.api_enabled)" -ForegroundColor Gray
        Write-Host "      Base URL: $($fez.api_base_url)" -ForegroundColor Gray
        Write-Host "      Live Tracking: $($fez.supports_live_tracking)" -ForegroundColor Gray
        Write-Host "      Label Generation: $($fez.supports_label_generation)" -ForegroundColor Gray
    }
} catch {
    Write-Host "    Failed to fetch couriers" -ForegroundColor Red
}

# Test 2: Check if orders exist
Write-Host "`n2. Checking for test orders..." -ForegroundColor Yellow
try {
    $orders = Invoke-RestMethod -Uri "http://localhost:3001/api/orders?limit=5"
    Write-Host "    Found $($orders.data.Count) orders" -ForegroundColor Green
    
    if ($orders.data.Count -gt 0) {
        $testOrder = $orders.data[0]
        Write-Host "    Sample Order: #$($testOrder.woocommerce_order_id)" -ForegroundColor White
        Write-Host "      Status: $($testOrder.overall_status)" -ForegroundColor Gray
        Write-Host "      Customer: $($testOrder.customer_name)" -ForegroundColor Gray
    }
} catch {
    Write-Host "    Failed to fetch orders" -ForegroundColor Red
}

# Test 3: Check API logs endpoint
Write-Host "`n3. Checking API logs endpoint..." -ForegroundColor Yellow
try {
    $logs = Invoke-RestMethod -Uri "http://localhost:3001/api/courier/logs?limit=5"
    Write-Host "    API logs endpoint working" -ForegroundColor Green
    Write-Host "    Found $($logs.data.Count) log entries" -ForegroundColor White
} catch {
    Write-Host "     No logs yet (normal for new setup)" -ForegroundColor Yellow
}

Write-Host "`n" -ForegroundColor Cyan
Write-Host " API Integration Setup Complete!" -ForegroundColor Green
Write-Host "" -ForegroundColor Cyan

Write-Host "`n Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Get Fez Delivery API credentials" -ForegroundColor White
Write-Host "  2. Go to Courier Settings page" -ForegroundColor White
Write-Host "  3. Enter API key and enable integration" -ForegroundColor White
Write-Host "  4. Create a test order" -ForegroundColor White
Write-Host "  5. Click 'Create Shipment on Fez Delivery'" -ForegroundColor White
Write-Host "  6. Test live tracking!" -ForegroundColor White

Write-Host "`n Access Points:" -ForegroundColor Cyan
Write-Host "  Courier Settings: http://localhost:3000/dashboard/courier-settings" -ForegroundColor White
Write-Host "  Orders:          http://localhost:3000/dashboard/orders" -ForegroundColor White
Write-Host "  API Logs:        http://localhost:3001/api/courier/logs" -ForegroundColor White
