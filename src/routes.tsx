import type { ReactElement } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './dashboard/contexts/AuthContext';

import {
  CustomerContactRoute,
  CustomerEstimateRoute,
  CustomerLandingRoute,
  CustomerManualShipmentTrackRoute,
  CustomerPortalLayout,
  CustomerReturnConfirmationRoute,
  CustomerReturnMethodRoute,
  CustomerTrackRoute,
} from './customer-portal/mobile/routes';

import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './dashboard/components/DashboardLayout';
import { MobileShell } from './dashboard/mobile/MobileShell';
import MoreMenu from './dashboard/mobile/MoreMenu';
import MobileHome from './dashboard/mobile/screens/Home';
import MobileOrders from './dashboard/mobile/screens/Orders';
import MobileSupport from './dashboard/mobile/screens/Support';
import MobileDispatch from './dashboard/mobile/screens/Dispatch';
import MobileRefunds from './dashboard/mobile/screens/Refunds';
import MobileProductModeration from './dashboard/mobile/screens/ProductModeration';
import MobileSupportChat from './dashboard/mobile/screens/SupportChat';
import MobileOrderDetails from './dashboard/mobile/screens/OrderDetails';
import MobileCreateOrder from './dashboard/mobile/screens/CreateOrder';
import MobileProductUpload from './dashboard/mobile/screens/ProductUpload';
import MobileManualShipments from './dashboard/mobile/screens/ManualShipments';
import MobileManualShipmentDetail from './dashboard/mobile/screens/ManualShipmentDetail';
import MobileCreateManualShipment from './dashboard/mobile/screens/CreateManualShipment';
import MobileRefundDetail from './dashboard/mobile/screens/RefundDetail';
import MobilePushNotifications from './dashboard/mobile/screens/PushNotifications';
import MobileNotifications from './dashboard/mobile/screens/Notifications';
import MobilePushNotificationCompose from './dashboard/mobile/screens/PushNotificationCompose';
import MobilePushNotificationDetail from './dashboard/mobile/screens/PushNotificationDetail';
import MobilePushTokenRegistry from './dashboard/mobile/screens/PushTokenRegistry';
import MobileProfile from './dashboard/mobile/screens/Profile';
import MobileShippingRates from './dashboard/mobile/screens/ShippingRates';
import MobileProductReviews from './dashboard/mobile/screens/ProductReviews';
import MobileCustomers from './dashboard/mobile/screens/Customers';
import MobileUsers from './dashboard/mobile/screens/Users';
import MobileAnalytics from './dashboard/mobile/screens/Analytics';
import MobileActivityLogs from './dashboard/mobile/screens/ActivityLogs';
import MobilePWAMonitoring from './dashboard/mobile/screens/PWAMonitoring';
import MobileGlobalSourcing from './dashboard/mobile/screens/GlobalSourcing';
import MobileTags from './dashboard/mobile/screens/Tags';
import MobileCategories from './dashboard/mobile/screens/Categories';
import MobileHomepageContent from './dashboard/mobile/screens/HomepageContent';
import MobileVendors from './dashboard/mobile/screens/Vendors';
import MobileSellerVerifications from './dashboard/mobile/screens/SellerVerifications';
import MobileGiftFulfilmentCentres from './dashboard/mobile/screens/GiftFulfilmentCentres';
import MobileGiftBoxes from './dashboard/mobile/screens/GiftBoxes';
import MobileGiftOps from './dashboard/mobile/screens/GiftOps';
import MobileGiftPackaging from './dashboard/mobile/screens/GiftPackaging';
import MobileGiftBoxReviews from './dashboard/mobile/screens/GiftBoxReviews';
import MobileCustomOrders from './dashboard/mobile/screens/CustomOrders';
import MobileVendorCampaignApprovals from './dashboard/mobile/screens/VendorCampaignApprovals';
import MobileVendorDetail from './dashboard/mobile/screens/VendorDetail';
import MobileVendorWithdrawals from './dashboard/mobile/screens/VendorWithdrawals';
import MobileVendorDebits from './dashboard/mobile/screens/VendorDebits';
import MobileVendorLocations from './dashboard/mobile/screens/VendorLocations';
import MobileCampaigns from './dashboard/mobile/screens/Campaigns';
import MobileVouchers from './dashboard/mobile/screens/Vouchers';
import MobileShippingDiscounts from './dashboard/mobile/screens/ShippingDiscounts';
import MobileInfluencers from './dashboard/mobile/screens/Influencers';
import MobileInfluencerDetail from './dashboard/mobile/screens/InfluencerDetail';
import MobileMetaAds from './dashboard/mobile/screens/MetaAds';
import MobileGoogleAds from './dashboard/mobile/screens/GoogleAds';
import MobileFinance from './dashboard/mobile/screens/Finance';
import MobileSettlements from './dashboard/mobile/screens/Settlements';
import MobileHubs from './dashboard/mobile/screens/Hubs';
import MobileCouriers from './dashboard/mobile/screens/Couriers';
import MobileSettings from './dashboard/mobile/screens/Settings';
import MobileGlobalSourcingSettings from './dashboard/mobile/screens/settings/GlobalSourcingSettings';
import MobileCourierSettings from './dashboard/mobile/screens/settings/CourierSettings';
import MobileEmailSettings from './dashboard/mobile/screens/settings/EmailSettings';
import MobileSettingsDocumentation from './dashboard/mobile/screens/settings/SettingsDocumentation';
import MobileSettingsWebhooks from './dashboard/mobile/screens/settings/SettingsWebhooks';
import MobileSettingsApi from './dashboard/mobile/screens/settings/SettingsApi';
import MobileSettingsDatabase from './dashboard/mobile/screens/settings/SettingsDatabase';
import MobileEmailLogs from './dashboard/mobile/screens/settings/EmailLogs';
import { useIsMobile } from './dashboard/hooks/useIsMobile';
import { ActivityLogsPage } from './dashboard/pages/ActivityLogs';
import { AnalyticsPage } from './dashboard/pages/Analytics';
import { AuthCallbackPage } from './dashboard/pages/auth/AuthCallback';
import { ForgotPasswordPage } from './dashboard/pages/auth/ForgotPassword';
import { LoginPage } from './dashboard/pages/auth/Login';
import { ResetPasswordPage } from './dashboard/pages/auth/ResetPassword';
import { CouriersPage } from './dashboard/pages/Couriers';
import { CourierSettingsPage } from './dashboard/pages/CourierSettings';
import { CreateOrderPage } from './dashboard/pages/CreateOrder';
import { CreateManualShipmentPage } from './dashboard/pages/CreateManualShipment';
import { CustomerJourneyPage } from './dashboard/pages/CustomerJourney';
import MobileCustomerJourney from './dashboard/mobile/screens/CustomerJourney';
import { ManualShipmentsPage } from './dashboard/pages/ManualShipments';
import { ManualShipmentDetailPage } from './dashboard/pages/ManualShipmentDetail';
import { DashboardHome } from './dashboard/pages/DashboardHome';
import { EmailSettingsPage } from './dashboard/pages/EmailSettings';
import { GlobalSourcingPage } from './dashboard/pages/GlobalSourcing';
import { ProductModerationPage } from './dashboard/pages/ProductModeration';
import ProductReviewsPage from './dashboard/pages/ProductReviewsPage';
import HomepageContent from './dashboard/pages/HomepageContent';
import TagsPage from './dashboard/pages/TagsPage';
import CategoriesPage from './dashboard/pages/CategoriesPage';
import ProductUpload from './dashboard/pages/ProductUpload';
import { HubsPage } from './dashboard/pages/Hubs';
import { HubDispatchPage } from './dashboard/pages/HubDispatch';
import InfluencerDetailPage from './dashboard/pages/InfluencerDetailPage.tsx';
import InfluencersPage from './dashboard/pages/InfluencersPage.tsx';
import { NotificationDetailsPage } from './dashboard/pages/NotificationDetails';
import { NotificationsNewPage } from './dashboard/pages/NotificationsNew';
import { NotificationsPage } from './dashboard/pages/Notifications';
import { PushTokenRegistryPage } from './dashboard/pages/PushTokenRegistry';
import { OrderDetailsPage } from './dashboard/pages/OrderDetails';
import { OrdersPage } from './dashboard/pages/Orders';
import ReturnsPage from './dashboard/pages/Returns';
import { SettingsPage } from './dashboard/pages/Settings';
import { FinancePage } from './dashboard/pages/Finance';
import { SettlementsPage } from './dashboard/pages/Settlements';
import { ShippingDiscountsPage } from './dashboard/pages/ShippingDiscounts';
import { ShippingRatesPage } from './dashboard/pages/ShippingRates';
import { UsersPage } from './dashboard/pages/Users';
import SupportInbox from './dashboard/pages/SupportInbox';
import SupportChatView from './dashboard/pages/SupportChatView';
import { VouchersPage } from './dashboard/pages/Vouchers';
import { CampaignsPage } from './dashboard/pages/Campaigns';
import { CustomersPage } from './dashboard/pages/Customers';
import { VendorsPage } from './dashboard/pages/Vendors';
import SellerVerificationsPage from './dashboard/pages/SellerVerifications';
import RiderVerificationsPage from './dashboard/pages/RiderVerifications';
import RiderRosterPage from './dashboard/pages/RiderRoster';
import VendorCampaignApprovalsPage from './dashboard/pages/VendorCampaignApprovals';
import GiftFulfilmentCentresPage from './dashboard/pages/GiftFulfilmentCentres';
import GiftBoxesPage from './dashboard/pages/GiftBoxes';
import GiftOpsPage from './dashboard/pages/GiftOps';
import GiftBoxReviewsPage from './dashboard/pages/GiftBoxReviews';
import GiftPackagingPage from './dashboard/pages/GiftPackaging';
import CustomOrdersPage from './dashboard/pages/CustomOrders';
import VendorDetail from './dashboard/pages/VendorDetail';
import VendorWithdrawals from './dashboard/pages/VendorWithdrawals';
import VendorDebits from './dashboard/pages/VendorDebits';
import { VendorLocationsPage } from './dashboard/pages/VendorLocations';
import { UnauthorizedPage } from './shared/UnauthorizedPage';
import { MetaAdsPage } from './dashboard/pages/MetaAds';
import { GoogleAdsPage } from './dashboard/pages/GoogleAds';
import { PWAMonitoringPage } from './dashboard/pages/PWAMonitoring';
import { ProfilePage } from './dashboard/pages/Profile';

// Branch point for the mobile shell: viewport-gated, not user-agent
// sniffed, so resizing/rotating switches shells live. Desktop's DashboardLayout
// is otherwise untouched by this.
function AdminShell({ children }: { children: ReactElement }) {
  const isMobile = useIsMobile();
  return isMobile ? <MobileShell>{children}</MobileShell> : <DashboardLayout>{children}</DashboardLayout>;
}

// Role-aware landing for mobile-first roles
function AdminLanding() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  if (user?.role === 'social_media_manager') {
    return <Navigate to="/admin/campaigns" replace />;
  }
  if (user?.role === 'shop_manager' && isMobile) {
    return <Navigate to="/admin/products/moderation" replace />;
  }
  return isMobile ? <MobileHome /> : <DashboardHome />;
}

function OrdersRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileOrders /> : <OrdersPage />;
}

function SupportRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSupport /> : <SupportInbox />;
}

function DispatchRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileDispatch /> : <HubDispatchPage />;
}

function RefundsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileRefunds /> : <ReturnsPage />;
}

function ProductModerationRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileProductModeration /> : <ProductModerationPage />;
}

function SupportChatRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSupportChat /> : <SupportChatView />;
}

function OrderDetailsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileOrderDetails /> : <OrderDetailsPage />;
}

function CreateOrderRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCreateOrder /> : <CreateOrderPage />;
}

function ProductUploadRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileProductUpload /> : <ProductUpload />;
}

function ManualShipmentsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileManualShipments /> : <ManualShipmentsPage />;
}

function ManualShipmentDetailRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileManualShipmentDetail /> : <ManualShipmentDetailPage />;
}

function CreateManualShipmentRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCreateManualShipment /> : <CreateManualShipmentPage />;
}

function RefundDetailRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileRefundDetail /> : <Navigate to="/admin/refunds" replace />;
}

function NotificationsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobilePushNotifications /> : <NotificationsPage />;
}

function InboxRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileNotifications /> : <Navigate to="/admin/dashboard" replace />;
}

function NotificationsNewRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobilePushNotificationCompose /> : <NotificationsNewPage />;
}

function NotificationDetailsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobilePushNotificationDetail /> : <NotificationDetailsPage />;
}

function PushTokenRegistryRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobilePushTokenRegistry /> : <PushTokenRegistryPage />;
}

function ProfileRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileProfile /> : <ProfilePage />;
}

function ShippingRatesRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileShippingRates /> : <ShippingRatesPage />;
}

function GlobalSourcingRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileGlobalSourcing /> : <GlobalSourcingPage />;
}

function TagsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileTags /> : <TagsPage />;
}

function CategoriesRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCategories /> : <CategoriesPage />;
}

function HomepageContentRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileHomepageContent /> : <HomepageContent />;
}

function CatalogMigrationRoute() {
  return <Navigate to="/admin/products/moderation" replace />;
}

function ProductReviewsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileProductReviews /> : <ProductReviewsPage />;
}

function CustomersRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCustomers /> : <CustomersPage />;
}

function UsersRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileUsers /> : <UsersPage />;
}

function AnalyticsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileAnalytics /> : <AnalyticsPage />;
}

function CustomerJourneyRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCustomerJourney /> : <CustomerJourneyPage />;
}

function ActivityLogsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileActivityLogs /> : <ActivityLogsPage />;
}

function PWAMonitoringRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobilePWAMonitoring /> : <PWAMonitoringPage />;
}

function VendorsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileVendors /> : <VendorsPage />;
}

function SellerVerificationsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSellerVerifications /> : <SellerVerificationsPage />;
}

function VendorCampaignApprovalsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileVendorCampaignApprovals /> : <VendorCampaignApprovalsPage />;
}

function GiftFulfilmentCentresRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileGiftFulfilmentCentres /> : <GiftFulfilmentCentresPage />;
}

function GiftBoxesRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileGiftBoxes /> : <GiftBoxesPage />;
}

function GiftOpsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileGiftOps /> : <GiftOpsPage />;
}

function GiftPackagingRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileGiftPackaging /> : <GiftPackagingPage />;
}

function GiftBoxReviewsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileGiftBoxReviews /> : <GiftBoxReviewsPage />;
}

function CustomOrdersRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCustomOrders /> : <CustomOrdersPage />;
}

function VendorDetailRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileVendorDetail /> : <VendorDetail />;
}

function VendorWithdrawalsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileVendorWithdrawals /> : <VendorWithdrawals />;
}

function VendorDebitsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileVendorDebits /> : <VendorDebits />;
}

function VendorLocationsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileVendorLocations /> : <VendorLocationsPage />;
}

function CampaignsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCampaigns /> : <CampaignsPage />;
}

function VouchersRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileVouchers /> : <VouchersPage />;
}

function ShippingDiscountsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileShippingDiscounts /> : <ShippingDiscountsPage />;
}

function InfluencersRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileInfluencers /> : <InfluencersPage />;
}

function InfluencerDetailRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileInfluencerDetail /> : <InfluencerDetailPage />;
}

function MetaAdsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileMetaAds /> : <MetaAdsPage />;
}

function GoogleAdsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileGoogleAds /> : <GoogleAdsPage />;
}

function FinanceRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileFinance /> : <FinancePage />;
}

function SettlementsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSettlements /> : <SettlementsPage />;
}

function HubsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileHubs /> : <HubsPage />;
}

function CouriersRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCouriers /> : <CouriersPage />;
}

function SettingsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSettings /> : <SettingsPage />;
}

function SettingsGlobalSourcingRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileGlobalSourcingSettings /> : <Navigate to="/admin/settings" replace />;
}

function SettingsCouriersRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCourierSettings /> : <CourierSettingsPage />;
}

function SettingsEmailRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileEmailSettings /> : <EmailSettingsPage />;
}

function SettingsEmailLogsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileEmailLogs /> : <Navigate to="/admin/email-settings" replace />;
}

function SettingsDocumentationRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSettingsDocumentation /> : <Navigate to="/admin/settings" replace />;
}

function SettingsWebhooksRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSettingsWebhooks /> : <Navigate to="/admin/settings" replace />;
}

function SettingsApiRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSettingsApi /> : <Navigate to="/admin/settings" replace />;
}

function SettingsDatabaseRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileSettingsDatabase /> : <Navigate to="/admin/settings" replace />;
}

function CourierSettingsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <Navigate to="/admin/settings/couriers" replace /> : <CourierSettingsPage />;
}

function EmailSettingsRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <Navigate to="/admin/settings/email" replace /> : <EmailSettingsPage />;
}

// Routes accessible by both admin and agent
const sharedRoutes = [
  { path: '', element: <AdminLanding /> },
  { path: 'dashboard', element: <AdminLanding /> },
  { path: 'orders', element: <OrdersRoute /> },
  { path: 'orders/create', element: <CreateOrderRoute /> },
  { path: 'manual-shipments', element: <ManualShipmentsRoute /> },
  { path: 'manual-shipments/create', element: <CreateManualShipmentRoute /> },
  { path: 'manual-shipments/:id', element: <ManualShipmentDetailRoute /> },
  {
    path: 'dispatch/hub',
    element: (
      <ProtectedRoute allowedRoles={['admin', 'agent', 'manager', 'viewer']}>
        <DispatchRoute />
      </ProtectedRoute>
    ),
  },
  { path: 'refunds', element: <RefundsRoute /> },
  { path: 'refunds/:id', element: <RefundDetailRoute /> },
  { path: 'more', element: <MoreMenu /> },
  { path: 'profile', element: <ProfileRoute /> },
  { path: 'inbox', element: <InboxRoute /> },
  { path: 'notifications', element: <NotificationsRoute /> },
  { path: 'orders/:id', element: <OrderDetailsRoute /> },
  { path: 'rates', element: <ShippingRatesRoute /> },
  { path: 'support', element: <SupportRoute /> },
  { path: 'support/:sessionId', element: <SupportChatRoute /> },
  {
    path: 'products/upload',
    element: (
      <ProtectedRoute allowedRoles={['admin', 'shop_manager', 'agent', 'manager']}>
        <ProductUploadRoute />
      </ProtectedRoute>
    ),
  },
  {
    path: 'global-sourcing',
    element: (
      <ProtectedRoute allowedRoles={['admin', 'shop_manager', 'agent', 'manager']}>
        <GlobalSourcingRoute />
      </ProtectedRoute>
    ),
  },
  {
    path: 'products/moderation',
    element: (
      <ProtectedRoute allowedRoles={['admin', 'shop_manager', 'agent', 'manager']}>
        <ProductModerationRoute />
      </ProtectedRoute>
    ),
  },
  {
    path: 'products/reviews',
    element: (
      <ProtectedRoute allowedRoles={['admin', 'shop_manager', 'agent', 'manager']}>
        <ProductReviewsRoute />
      </ProtectedRoute>
    ),
  },
  { path: 'homepage-content', element: <ProtectedRoute allowedRoles={['admin']}><HomepageContentRoute /></ProtectedRoute> },
  { path: 'tags', element: <ProtectedRoute allowedRoles={['admin']}><TagsRoute /></ProtectedRoute> },
  { path: 'categories', element: <ProtectedRoute allowedRoles={['admin']}><CategoriesRoute /></ProtectedRoute> },
  {
    path: 'catalog-migration',
    element: (
      <ProtectedRoute allowedRoles={['admin']}>
        <CatalogMigrationRoute />
      </ProtectedRoute>
    ),
  },
];

type AdminRouteConfig = { path: string; element: ReactElement; allowedRoles?: string[] };

// Default allowedRoles is ['admin'] when omitted
const adminOnlyRoutes: AdminRouteConfig[] = [
  { path: 'hubs', element: <HubsRoute /> },
  { path: 'couriers', element: <CouriersRoute /> },
  { path: 'analytics', element: <AnalyticsRoute /> },
  { path: 'customer-journey', element: <CustomerJourneyRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'users', element: <UsersRoute /> },
  { path: 'customers', element: <CustomersRoute /> },
  { path: 'discounts', element: <ShippingDiscountsRoute /> },
  { path: 'meta-ads', element: <MetaAdsRoute />, allowedRoles: ['admin', 'manager', 'social_media_manager'] },
  { path: 'google-ads', element: <GoogleAdsRoute />, allowedRoles: ['admin', 'manager', 'social_media_manager'] },
  { path: 'influencers', element: <InfluencersRoute /> },
  { path: 'influencers/:id', element: <InfluencerDetailRoute /> },
  { path: 'courier-settings', element: <CourierSettingsRoute /> },
  { path: 'settings', element: <SettingsRoute /> },
  { path: 'settings/global-sourcing', element: <SettingsGlobalSourcingRoute /> },
  { path: 'settings/couriers', element: <SettingsCouriersRoute /> },
  { path: 'settings/email', element: <SettingsEmailRoute /> },
  { path: 'settings/email/logs', element: <SettingsEmailLogsRoute /> },
  { path: 'settings/documentation', element: <SettingsDocumentationRoute /> },
  { path: 'settings/webhooks', element: <SettingsWebhooksRoute /> },
  { path: 'settings/api', element: <SettingsApiRoute /> },
  { path: 'settings/database', element: <SettingsDatabaseRoute /> },
  { path: 'email-settings', element: <EmailSettingsRoute /> },
  { path: 'finance', element: <FinanceRoute /> },
  { path: 'settlements', element: <SettlementsRoute /> },
  { path: 'activity-logs', element: <ActivityLogsRoute /> },
  { path: 'vouchers', element: <VouchersRoute /> },
  { path: 'campaigns', element: <CampaignsRoute />, allowedRoles: ['admin', 'manager', 'social_media_manager'] },
  { path: 'vendors', element: <VendorsRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'seller-verifications', element: <SellerVerificationsRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'rider-verifications', element: <RiderVerificationsPage />, allowedRoles: ['admin', 'manager'] },
  { path: 'rider-roster', element: <RiderRosterPage />, allowedRoles: ['admin', 'manager'] },
  { path: 'vendor-campaign-approvals', element: <VendorCampaignApprovalsRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'gift-fulfilment-centres', element: <GiftFulfilmentCentresRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'gift-boxes', element: <GiftBoxesRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'gift-ops', element: <GiftOpsRoute />, allowedRoles: ['admin', 'manager', 'staff'] },
  { path: 'gift-box-reviews', element: <GiftBoxReviewsRoute />, allowedRoles: ['admin', 'manager', 'staff'] },
  { path: 'gift-packaging', element: <GiftPackagingRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'custom-orders', element: <CustomOrdersRoute />, allowedRoles: ['admin', 'manager', 'staff'] },
  { path: 'vendors/:id', element: <VendorDetailRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'vendor-withdrawals', element: <VendorWithdrawalsRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'vendor-debits', element: <VendorDebitsRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'vendor-locations', element: <VendorLocationsRoute />, allowedRoles: ['admin', 'manager'] },
  { path: 'notifications', element: <NotificationsRoute /> },
  { path: 'notifications/new', element: <NotificationsNewRoute /> },
  { path: 'notifications/tokens', element: <PushTokenRegistryRoute /> },
  { path: 'notifications/:id', element: <NotificationDetailsRoute /> },
  { path: 'pwa-monitoring', element: <PWAMonitoringRoute /> },
];

const customerChildRoutes = [
  { index: true, element: <CustomerLandingRoute /> },
  { path: 'track', element: <CustomerTrackRoute /> },
  { path: 'track/shipment', element: <CustomerManualShipmentTrackRoute /> },
  { path: 'estimate', element: <CustomerEstimateRoute /> },
  { path: 'order/:id', element: <CustomerTrackRoute /> },
  { path: 'contact', element: <CustomerContactRoute /> },
  { path: 'return/:id/method', element: <CustomerReturnMethodRoute /> },
  { path: 'return/:id/confirmation', element: <CustomerReturnConfirmationRoute /> },
];

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/customer" replace />,
  },
  {
    path: '/customer',
    element: <CustomerPortalLayout />,
    children: customerChildRoutes,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/auth/callback',
    element: <AuthCallbackPage />,
  },
  {
    path: '/forgot-password',
    element: <ForgotPasswordPage />,
  },
  {
    path: '/reset-password',
    element: <ResetPasswordPage />,
  },
  {
    path: '/unauthorized',
    element: <UnauthorizedPage />,
  },
  {
    path: '/admin',
    element: (
      <ProtectedRoute allowedRoles={['admin', 'agent', 'shop_manager', 'manager', 'viewer', 'social_media_manager']}>
        <AdminShell>
          <Outlet />
        </AdminShell>
      </ProtectedRoute>
    ),
    children: [
      // Shared routes (admin + agent)
      ...sharedRoutes,
      // Admin-only routes wrapped in ProtectedRoute
      ...adminOnlyRoutes.map((route) => ({
        path: route.path,
        element: (
          <ProtectedRoute allowedRoles={route.allowedRoles ?? ['admin']}>
            {route.element}
          </ProtectedRoute>
        ),
      })),
    ],
  },
  {
    path: '*',
    element: <Navigate to="/customer" replace />,
  },
]);
