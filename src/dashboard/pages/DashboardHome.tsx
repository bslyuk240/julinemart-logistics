import { MapPin, Package, TrendingUp, Truck } from 'lucide-react';
import { MessageSquare, Tag, Users, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { callSupabaseFunction, callSupabaseFunctionWithQuery } from '../../lib/supabaseFunctions';
import { supabase } from '../contexts/AuthContext';

interface Stats {
  totalOrders: number;
  activeHubs: number;
  activeCouriers: number;
  avgDeliveryTime: number;
}

interface RecentOrder {
  id: string;
  order_number?: number | null;
  woocommerce_order_id?: string | null;
  payment_reference?: string | null;
  customer_name: string;
  created_at: string;
  total_amount: number;
}

function recentOrderDisplayLabel(order: RecentOrder): string {
  const wc = order.woocommerce_order_id?.trim();
  if (wc) return wc;
  if (order.order_number != null) return String(order.order_number);
  const ref = order.payment_reference?.trim();
  if (ref) return ref;
  return order.id.slice(0, 8).toUpperCase();
}

interface InfluencerSummary {
  id: string;
  name: string;
  email: string | null;
  coupon_code: string;
}

interface WhatsAppChatSummary {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  last_message_at: string;
  last_message_preview: string | null;
}

interface ShippingDiscountSummary {
  id: string;
  name: string;
  type: string;
  discount_value: number | null;
  is_active: boolean;
}

interface ZoneOrderCount {
  zone: string;
  orders: number;
}

interface PwaStats {
  promptShown: number;
  installClicked: number;
  installAccepted: number;
  installDismissed: number;
  appInstalled: number;
  standaloneOpens: number;
  androidInstalls: number;
  iosStandaloneOpens: number;
  androidStandaloneOpens: number;
  notifPromptShown: number;
  notifAllowed: number;
  notifDeclined: number;
  notifSnoozed: number;
}

export function DashboardHome() {
  const [stats, setStats] = useState<Stats>({
    totalOrders: 0,
    activeHubs: 0,
    activeCouriers: 0,
    avgDeliveryTime: 0,
  });
  const [loading, setLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [activeInfluencers, setActiveInfluencers] = useState<InfluencerSummary[]>([]);
  const [recentChats, setRecentChats] = useState<WhatsAppChatSummary[]>([]);
  const [activeDiscounts, setActiveDiscounts] = useState<ShippingDiscountSummary[]>([]);
  const [ordersByZone, setOrdersByZone] = useState<ZoneOrderCount[]>([]);
  const [pwaStats, setPwaStats] = useState<PwaStats | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [statsData, ordersData, influencersData, chatsResponse, discountsResponse, pwaEventsResponse] = await Promise.all([
        callSupabaseFunction('stats', { method: 'GET' }),
        callSupabaseFunctionWithQuery('orders', { limit: '200', offset: '0' }, { method: 'GET' }),
        callSupabaseFunctionWithQuery('influencers', { status: 'active' }, { method: 'GET' }),
        fetch('/.netlify/functions/whatsapp-chats?limit=5'),
        supabase
          .from('shipping_discounts')
          .select('id, name, type, discount_value, is_active')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('pwa_install_events')
          .select('event_name, platform, created_at'),
      ]);

      console.log('[DEBUG] Raw statsData response:', JSON.stringify(statsData, null, 2));
      console.log('[DEBUG] statsData.success:', statsData?.success);
      console.log('[DEBUG] statsData.data:', statsData?.data);

      if (statsData?.success && statsData?.data) {
        console.log('[DEBUG] Setting stats from statsData.data:', statsData.data);
        setStats(statsData.data);
      } else if (statsData?.data) {
        console.log('[DEBUG] Setting stats from statsData.data (no success flag):', statsData.data);
        setStats(statsData.data);
      } else {
        console.warn('[DEBUG] No valid stats data found in response');
      }

      const ordersList = ordersData?.success && Array.isArray(ordersData.data)
        ? ordersData.data
        : Array.isArray(ordersData)
          ? ordersData
          : [];
      setRecentOrders(ordersList.slice(0, 5));

      const zoneCounts: Record<string, number> = {};
      for (const order of ordersList as any[]) {
        const zone = (order?.delivery_zone || order?.delivery_state || 'Unknown') as string;
        zoneCounts[zone] = (zoneCounts[zone] || 0) + 1;
      }
      const zoneTotals = Object.entries(zoneCounts)
        .map(([zone, orders]) => ({ zone, orders }))
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 4);
      setOrdersByZone(zoneTotals);

      if (influencersData?.success && Array.isArray(influencersData.data)) {
        setActiveInfluencers(influencersData.data);
      } else if (Array.isArray(influencersData)) {
        setActiveInfluencers(influencersData);
      } else {
        setActiveInfluencers([]);
      }

      const chatsPayload = await chatsResponse.json().catch(() => ({}));
      if (chatsPayload?.success && Array.isArray(chatsPayload.data)) {
        setRecentChats(chatsPayload.data);
      } else {
        setRecentChats([]);
      }

      if (discountsResponse?.data && Array.isArray(discountsResponse.data)) {
        setActiveDiscounts(discountsResponse.data);
      } else {
        setActiveDiscounts([]);
      }

      const pwaEvents = pwaEventsResponse?.data ?? [];
      if (pwaEvents.length > 0) {
        const count = (name: string) => pwaEvents.filter((e) => e.event_name === name).length;
        const countPlat = (name: string, platform: string) =>
          pwaEvents.filter((e) => e.event_name === name && e.platform === platform).length;
        setPwaStats({
          promptShown: count('pwa_install_prompt_shown'),
          installClicked: count('pwa_install_clicked'),
          installAccepted: count('pwa_install_accepted'),
          installDismissed: count('pwa_install_dismissed'),
          appInstalled: count('pwa_appinstalled'),
          standaloneOpens: count('pwa_opened_standalone'),
          androidInstalls: countPlat('pwa_appinstalled', 'android_desktop') + countPlat('pwa_install_accepted', 'android_desktop'),
          iosStandaloneOpens: countPlat('pwa_opened_standalone', 'ios'),
          androidStandaloneOpens: countPlat('pwa_opened_standalone', 'android_desktop'),
          notifPromptShown: count('notification_prompt_shown'),
          notifAllowed: count('notification_prompt_allowed'),
          notifDeclined: count('notification_prompt_declined'),
          notifSnoozed: count('notification_prompt_snoozed'),
        });
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

  const formatDiscountValue = (discount: ShippingDiscountSummary) => {
    if (discount.type === 'free') return 'Free shipping';
    if (discount.type === 'flat') {
      return `- NGN ${Number(discount.discount_value || 0).toLocaleString()}`;
    }
    return `- ${discount.discount_value || 0}%`;
  };

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
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-6 mb-8">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="card p-3 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] sm:text-sm text-gray-600 mb-1">{stat.name}</p>
                  <p className="text-lg sm:text-3xl font-bold text-gray-900">{stat.value}</p>
                  <p className={`text-[10px] sm:text-sm mt-2 ${
                    stat.change.startsWith('+') ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {stat.change} from last month
                  </p>
                </div>
                <div className={`${stat.color} w-8 h-8 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center`}>
                  <Icon className="w-4 h-4 sm:w-6 sm:h-6 text-white" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Row 2: Recent Orders + 4 activity cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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
                    <p className="text-sm text-gray-600">#{recentOrderDisplayLabel(order)}</p>
                    <p className="text-sm text-gray-800 font-medium">{order.customer_name}</p>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <p>{new Date(order.created_at).toLocaleDateString()}</p>
                    <p>NGN {order.total_amount?.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Active Influencers</h2>
              <Users className="w-5 h-5 text-primary-600" />
            </div>
            {activeInfluencers.length === 0 ? (
              <p className="text-sm text-gray-500">No active influencers yet.</p>
            ) : (
              <div className="space-y-2">
                {activeInfluencers.slice(0, 4).map((influencer) => (
                  <div key={influencer.id} className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{influencer.name}</p>
                      <p className="text-xs text-gray-500">{influencer.email || 'No email'}</p>
                    </div>
                    <span className="text-xs text-gray-500">{influencer.coupon_code}</span>
                  </div>
                ))}
                <p className="text-xs text-gray-500">Total: {activeInfluencers.length}</p>
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Recent WhatsApp</h2>
              <MessageSquare className="w-5 h-5 text-green-600" />
            </div>
            {recentChats.length === 0 ? (
              <p className="text-sm text-gray-500">No recent chats.</p>
            ) : (
              <div className="space-y-2">
                {recentChats.map((chat) => (
                  <div key={chat.id} className="border-b border-gray-100 pb-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-800 truncate max-w-[120px]">
                        {chat.customer_name || chat.customer_phone}
                      </p>
                      <span className="text-xs text-gray-500 shrink-0">
                        {new Date(chat.last_message_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">
                      {chat.last_message_preview || 'No message yet'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Orders by Zones</h2>
              <MapPin className="w-5 h-5 text-blue-600" />
            </div>
            {ordersByZone.length === 0 ? (
              <p className="text-sm text-gray-500">No zone analytics yet.</p>
            ) : (
              <div className="space-y-2">
                {ordersByZone.map((zone) => (
                  <div key={zone.zone} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <span className="text-sm font-medium text-gray-700">{zone.zone}</span>
                    <span className="text-sm text-blue-600">{zone.orders} orders</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Active Discounts</h2>
              <Tag className="w-5 h-5 text-orange-500" />
            </div>
            {activeDiscounts.length === 0 ? (
              <p className="text-sm text-gray-500">No active discounts yet.</p>
            ) : (
              <div className="space-y-2">
                {activeDiscounts.map((discount) => (
                  <div key={discount.id} className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{discount.name}</p>
                      <p className="text-xs text-gray-500">{formatDiscountValue(discount)}</p>
                    </div>
                    <span className="text-xs text-gray-500 capitalize">{discount.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 3: PWA App Installs — full width */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold">PWA App Installs</h2>
            <p className="text-xs text-gray-500 mt-0.5">Tracks install events from JulineMart customer app</p>
          </div>
          <Smartphone className="w-5 h-5 text-purple-600" />
        </div>
        {!pwaStats ? (
          <p className="text-sm text-gray-500">No install data yet. Data will appear once customers interact with the install prompt.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-700">{pwaStats.promptShown}</p>
              <p className="text-xs text-gray-500 mt-1">Prompt Shown</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{pwaStats.installClicked}</p>
              <p className="text-xs text-gray-500 mt-1">Install Clicked</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-700">{pwaStats.appInstalled}</p>
              <p className="text-xs text-gray-500 mt-1">Confirmed Installs</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-orange-700">{pwaStats.standaloneOpens}</p>
              <p className="text-xs text-gray-500 mt-1">Standalone Opens</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">{pwaStats.androidInstalls}</p>
              <p className="text-xs text-gray-500 mt-1">Android Installs</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">{pwaStats.iosStandaloneOpens}</p>
              <p className="text-xs text-gray-500 mt-1">iOS App Opens</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{pwaStats.installDismissed}</p>
              <p className="text-xs text-gray-500 mt-1">Dismissed</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-gray-700">{pwaStats.androidStandaloneOpens}</p>
              <p className="text-xs text-gray-500 mt-1">Android App Opens</p>
            </div>
          </div>

          {/* Push notification prompt stats */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-500 mb-3">Push Notification Prompts</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-purple-700">{pwaStats.notifPromptShown}</p>
                <p className="text-xs text-gray-500 mt-1">Prompt Shown</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{pwaStats.notifAllowed}</p>
                <p className="text-xs text-gray-500 mt-1">Enabled</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-600">{pwaStats.notifDeclined}</p>
                <p className="text-xs text-gray-500 mt-1">Declined</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-orange-600">{pwaStats.notifSnoozed}</p>
                <p className="text-xs text-gray-500 mt-1">Snoozed</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}







