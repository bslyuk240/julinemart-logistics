# Test multi-hub shipping calculation
$testRequest = @{
    deliveryState = "Lagos"
    deliveryCity = "Ikeja"
    items = @(
        @{
            productId = "PROD-001"
            vendorId = "VENDOR-1"
            hubId = ""
            quantity = 2
            weight = 1.5
        }
    )
    totalOrderValue = 50000
} | ConvertTo-Json -Depth 5

Write-Host "`n🧪 Testing Shipping Calculation..." -ForegroundColor Cyan

try {
    $result = Invoke-RestMethod -Uri "http://localhost:3001/api/calc-shipping" -Method POST -Body $testRequest -ContentType "application/json"

    Write-Host "`n✅ RESULT:" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    Write-Host "Zone: $($result.data.zoneName)" -ForegroundColor White
    Write-Host "Total Shipping: ₦$($result.data.totalShippingFee)" -ForegroundColor Yellow

    if ($result.data.subOrders) {
        Write-Host "`nSub-Orders:" -ForegroundColor Cyan
        $result.data.subOrders | ForEach-Object {
            Write-Host "  • $($_.hubName) via $($_.courierName)" -ForegroundColor White
            Write-Host "    Weight: $($_.totalWeight)kg | Fee: ₦$($_.totalShippingFee)" -ForegroundColor Gray
        }
    }

    Write-Host "`n📋 Full Response:" -ForegroundColor Yellow
    $result | ConvertTo-Json -Depth 10
} catch {
    Write-Host "`n❌ ERROR:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    Write-Host "`nMake sure API server is running on port 3001" -ForegroundColor Gray
}
