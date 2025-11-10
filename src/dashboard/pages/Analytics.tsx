import { useEffect, useState } from 'react';
import { TrendingUp, Package, MapPin, Truck, DollarSign } from 'lucide-react';

interface AnalyticsData {
  totalOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  topZones: Array<{ zone: string; orders: number }>;
  recentOrders: number;
}

export function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData>({
    totalOrders: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
    topZones: [],
    recentOrders: 0,
  });
  const [loading, setLoading] = useState(true);
  const [zonesCount, setZonesCount] = useState(0);
  const [activeHubs, setActiveHubs] = useState(0);
  const [activeCouriers, setActiveCouriers] = useState(0);
  const [avgDeliveryDays, setAvgDeliveryDays] = useState(0);
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      // Fetch orders (sample), stats, and zones concurrently
      const [ordersRes, statsRes, zonesRes] = await Promise.all([
        fetch(`${apiBase}/api/orders?limit=100`),
        fetch(`${apiBase}/api/stats`),
        fetch(`${apiBase}/api/zones`),
      ]);
      const [ordersData, statsData, zonesData] = await Promise.all([
        ordersRes.json().catch(() => ({})),
        statsRes.json().catch(() => ({})),
        zonesRes.json().catch(() => ({})),
      ]);
      
      if (ordersData.success && ordersData.data) {
        const orders = ordersData.data;
        
        // Calculate metrics
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((sum: number, order: any) => 
          sum + parseFloat(order.total_amount || 0), 0
        );
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        
        // Get recent orders (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentOrders = orders.filter((order: any) => 
          new Date(order.created_at) > thirtyDaysAgo
        ).length;

        setData({
          totalOrders,
          totalRevenue,
          avgOrderValue,
          topZones: [],
          recentOrders,
        });
      }
      if (statsData?.success && statsData?.data) {
        setActiveHubs(statsData.data.activeHubs ?? 0);
        setActiveCouriers(statsData.data.activeCouriers ?? 0);
        setAvgDeliveryDays(statsData.data.avgDeliveryTime ?? 0);
      }
      if (zonesData?.success && Array.isArray(zonesData?.data)) {
        setZonesCount(zonesData.data.length);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const metrics = [
    {
      name: 'Total Orders',
      value: data.totalOrders,
      icon: Package,
      color: 'bg-blue-500',
      trend: '+12%',
    },
    {
      name: 'Total Revenue',
      value: `₦${data.totalRevenue.toLocaleString()}`,
      icon: DollarSign,
      color: 'bg-green-500',
      trend: '+23%',
    },
    {
      name: 'Avg Order Value',
      value: `₦${data.avgOrderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      icon: TrendingUp,
      color: 'bg-purple-500',
      trend: '+8%',
    },
    {
      name: 'Recent Orders (30d)',
      value: data.recentOrders,
      icon: Package,
      color: 'bg-orange-500',
      trend: '+15%',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-600 mt-2">Performance metrics and insights</p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.name} className="card">
              <div className="flex items-center justify-between mb-4">
                <div className={`${metric.color} w-12 h-12 rounded-lg flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-sm text-green-600 font-medium">
                  {metric.trend}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-1">{metric.name}</p>
              <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
            </div>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Orders by Zone</h2>
          {data.totalOrders === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No data available yet. Create orders to see analytics.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                <span className="font-medium">South West</span>
                <span className="text-blue-600 font-semibold">0 orders</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <span className="font-medium">South South</span>
                <span className="text-green-600 font-semibold">0 orders</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                <span className="font-medium">South East</span>
                <span className="text-purple-600 font-semibold">0 orders</span>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Delivery Performance</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">On-Time Delivery</span>
                <span className="font-medium">95%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: '95%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">Customer Satisfaction</span>
                <span className="font-medium">92%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: '92%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600">Failed Deliveries</span>
                <span className="font-medium">3%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-red-500 h-2 rounded-full" style={{ width: '3%' }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Quick Stats</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-900">{zonesCount}</p>
            <p className="text-sm text-gray-600 mt-1">Delivery Zones</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-900">{activeHubs}</p>
            <p className="text-sm text-gray-600 mt-1">Active Hubs</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-900">{activeCouriers}</p>
            <p className="text-sm text-gray-600 mt-1">Courier Partners</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-900">{avgDeliveryDays}</p>
            <p className="text-sm text-gray-600 mt-1">Avg Delivery Days</p>
          </div>
        </div>
      </div>
    </div>
  );
}
