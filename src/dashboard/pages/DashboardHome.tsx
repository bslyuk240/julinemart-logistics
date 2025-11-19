import { useCallback, useEffect, useState } from 'react';
import { Package, MapPin, Truck, TrendingUp } from 'lucide-react';
import { callSupabaseFunction, callSupabaseFunctionWithQuery } from '../../lib/supabaseFunctions';

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

interface RecentOrder {
  id: string;
  woocommerce_order_id: string;
  customer_name: string;
  created_at: string;
  total_amount: number;
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
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);

  const fetchData = useCallback(async () => {
    const [statsData, zonesData, ordersData] = await Promise.all([
      callSupabaseFunction('stats', { method: 'GET' }),
      callSupabaseFunction('zones', { method: 'GET' }),
      callSupabaseFunctionWithQuery('orders', { limit: '5', offset: '0' }, { method: 'GET' }),
    ]);

    if (statsData?.success && statsData?.data) {
      setStats(statsData.data);
    } else if (statsData?.data) {
      setStats(statsData.data);
    }

    if (zonesData?.success && Array.isArray(zonesData.data)) {
      setZones(zonesData.data);
    } else if (Array.isArray(zonesData)) {
      setZones(zonesData);
    }

    if (ordersData?.success && Array.isArray(ordersData.data)) {
      setRecentOrders(ordersData.data);
    } else if (Array.isArray(ordersData)) {
      setRecentOrders(ordersData);
    }
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
  } finally {
    setLoading(false);
  }
}, []);

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
          {recentOrders.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {stats.totalOrders === 0 
                ? 'No orders yet. Orders will appear here once created.' 
                : 'View all orders in the Orders page'}
            </div>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <div>
                    <p className="text-sm text-gray-600">#{order.woocommerce_order_id}</p>
                    <p className="text-sm text-gray-800 font-medium">{order.customer_name}</p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>{new Date(order.created_at).toLocaleDateString()}</p>
                    <p>?{order.total_amount?.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Shipping Zones</h2>
          <div className="space-y-3">
            {zones.slice(0, 4).map((zone) => (
              <div key={zone.code} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="font-medium">{zone.name}</span>
                <span className="text-primary-600">
                  ?{zone.shipping_rates?.[0]?.flat_rate?.toLocaleString() || 'N/A'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}





