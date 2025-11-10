import { useEffect, useState } from 'react';
import { Package, MapPin, Truck, TrendingUp } from 'lucide-react';
import { useCallback } from 'react';

interface Stats {
  totalOrders: number;
  activeHubs: number;
  activeCouriers: number;
  avgDeliveryTime: number;
}

interface Zone {
  name: string;
  code: string;
  shipping_rates: Array<{ flat_rate: number }>;
}

export function DashboardHome() {
  const [stats, setStats] = useState<Stats>({
    totalOrders: 0,
    activeHubs: 0,
    activeCouriers: 0,
    avgDeliveryTime: 0,
  });
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  // Prefer env-based API base URL, fallback to localhost:3001
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  const fetchData = useCallback(async () => {
    try {
      // Fetch in parallel
      const [statsRes, zonesRes] = await Promise.all([
        fetch(`${apiBase}/api/stats`),
        fetch(`${apiBase}/api/zones`),
      ]);

      if (!statsRes.ok) throw new Error(`Stats fetch failed: ${statsRes.status}`);
      if (!zonesRes.ok) throw new Error(`Zones fetch failed: ${zonesRes.status}`);

      const statsType = statsRes.headers.get('content-type') || '';
      const zonesType = zonesRes.headers.get('content-type') || '';

      // Handle stats JSON
      if (!statsType.includes('application/json')) {
        console.error('Stats returned non-JSON:', await statsRes.text());
      } else {
        const statsJson = await statsRes.json();
        if (statsJson?.success && statsJson?.data) {
          setStats(statsJson.data);
        } else if (statsJson?.data) {
          setStats(statsJson.data);
        }
      }

      // Handle zones JSON
      if (!zonesType.includes('application/json')) {
        console.error('Zones returned non-JSON:', await zonesRes.text());
      } else {
        const zonesJson = await zonesRes.json();
        if (zonesJson?.success && zonesJson?.data) {
          setZones(zonesJson.data);
        } else if (Array.isArray(zonesJson)) {
          setZones(zonesJson);
        }
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statCards = [
    { 
      name: 'Total Orders', 
      value: stats.totalOrders, 
      icon: Package, 
      color: 'bg-blue-500',
      change: '+12%'
    },
    { 
      name: 'Active Hubs', 
      value: stats.activeHubs, 
      icon: MapPin, 
      color: 'bg-green-500',
      change: '+0%'
    },
    { 
      name: 'Couriers', 
      value: stats.activeCouriers, 
      icon: Truck, 
      color: 'bg-purple-500',
      change: '+0%'
    },
    { 
      name: 'Avg Delivery (days)', 
      value: stats.avgDeliveryTime, 
      icon: TrendingUp, 
      color: 'bg-orange-500',
      change: '-8%'
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
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome to JulineMart Logistics Orchestrator</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600 mb-1">{stat.name}</p>
                  <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
                  <p className={`text-sm mt-2 ${
                    stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {stat.change} from last month
                  </p>
                </div>
                <div className={`${stat.color} w-12 h-12 rounded-lg flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Recent Orders</h2>
          <div className="text-center py-12 text-gray-500">
            {stats.totalOrders === 0 
              ? 'No orders yet. Orders will appear here once created.' 
              : 'View all orders in the Orders page'}
          </div>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Shipping Zones</h2>
          <div className="space-y-3">
            {zones.slice(0, 4).map((zone) => (
              <div key={zone.code} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">{zone.name}</span>
                <span className="text-primary-600">
                  ₦{zone.shipping_rates?.[0]?.flat_rate?.toLocaleString() || 'N/A'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
