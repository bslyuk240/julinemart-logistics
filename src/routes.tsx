import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';

import { CustomerContactPage } from './customer-portal/pages/Contact';
import { CustomerPortalLanding } from './customer-portal/pages/Landing';
import { ReturnConfirmationPage } from './customer-portal/pages/returns/ReturnConfirmation';
import { ReturnMethodPage } from './customer-portal/pages/returns/ReturnMethod';
import { ShippingEstimatePage } from './customer-portal/pages/ShippingEstimate';
import { OrderTrackingPage } from './customer-portal/pages/Track';

import { ProtectedRoute } from './components/ProtectedRoute';
import { DashboardLayout } from './dashboard/components/DashboardLayout';
import { ActivityLogsPage } from './dashboard/pages/ActivityLogs';
import { AnalyticsPage } from './dashboard/pages/Analytics';
import { ForgotPasswordPage } from './dashboard/pages/auth/ForgotPassword';
import { LoginPage } from './dashboard/pages/auth/Login';
import { ResetPasswordPage } from './dashboard/pages/auth/ResetPassword';
import { CouriersPage } from './dashboard/pages/Couriers';
import { CourierSettingsPage } from './dashboard/pages/CourierSettings';
import { CreateOrderPage } from './dashboard/pages/CreateOrder';
import { DashboardHome } from './dashboard/pages/DashboardHome';
import { EmailSettingsPage } from './dashboard/pages/EmailSettings';
import { GlobalSourcingPage } from './dashboard/pages/GlobalSourcing';
import { ProductModerationPage } from './dashboard/pages/ProductModeration';
import HomepageContent from './dashboard/pages/HomepageContent';
import CatalogMigration from './dashboard/pages/CatalogMigration';
import { HubsPage } from './dashboard/pages/Hubs';
import { HubDispatchPage } from './dashboard/pages/HubDispatch';
import InfluencerDetailPage from './dashboard/pages/InfluencerDetailPage.tsx';
import InfluencersPage from './dashboard/pages/InfluencersPage.tsx';
import { NotificationDetailsPage } from './dashboard/pages/NotificationDetails';
import { NotificationsNewPage } from './dashboard/pages/NotificationsNew';
import { NotificationsPage } from './dashboard/pages/Notifications';
import { OrderDetailsPage } from './dashboard/pages/OrderDetails';
import { OrdersPage } from './dashboard/pages/Orders';
import RefundsPage from './dashboard/pages/Refunds';
import { SettingsPage } from './dashboard/pages/Settings';
import { SettlementsPage } from './dashboard/pages/Settlements';
import { ShippingDiscountsPage } from './dashboard/pages/ShippingDiscounts';
import { ShippingRatesPage } from './dashboard/pages/ShippingRates';
import { UsersPage } from './dashboard/pages/Users';
import WhatsAppChatView from './dashboard/pages/WhatsAppChatView';
import WhatsAppSupportPage from './dashboard/pages/WhatsAppSupport';
import { VouchersPage } from './dashboard/pages/Vouchers';
import { UnauthorizedPage } from './shared/UnauthorizedPage';

// Routes accessible by both admin and agent
const sharedRoutes = [
  { path: '', element: <DashboardHome /> },
  { path: 'dashboard', element: <DashboardHome /> },
  { path: 'orders', element: <OrdersPage /> },
  { path: 'orders/create', element: <CreateOrderPage /> },
  { path: 'dispatch/hub', element: <HubDispatchPage /> },
  { path: 'refunds', element: <RefundsPage /> },
  { path: 'orders/:id', element: <OrderDetailsPage /> },
  { path: 'rates', element: <ShippingRatesPage /> },
  { path: 'whatsapp', element: <WhatsAppSupportPage /> },
  { path: 'whatsapp/:chatId', element: <WhatsAppChatView /> },
  { path: 'global-sourcing', element: <ProtectedRoute allowedRoles={['admin', 'shop_manager', 'agent']}><GlobalSourcingPage /></ProtectedRoute> },
  { path: 'products/moderation', element: <ProtectedRoute allowedRoles={['admin', 'shop_manager', 'agent']}><ProductModerationPage /></ProtectedRoute> },
  { path: 'homepage-content', element: <ProtectedRoute allowedRoles={['admin', 'shop_manager']}><HomepageContent /></ProtectedRoute> },
  { path: 'catalog-migration', element: <CatalogMigration /> },
];

// Routes accessible only by admin
const adminOnlyRoutes = [
  { path: 'hubs', element: <HubsPage /> },
  { path: 'couriers', element: <CouriersPage /> },
  { path: 'analytics', element: <AnalyticsPage /> },
  { path: 'users', element: <UsersPage /> },
  { path: 'discounts', element: <ShippingDiscountsPage /> },
  { path: 'influencers', element: <InfluencersPage /> },
  { path: 'influencers/:id', element: <InfluencerDetailPage /> },
  { path: 'courier-settings', element: <CourierSettingsPage /> },
  { path: 'settings', element: <SettingsPage /> },
  { path: 'email-settings', element: <EmailSettingsPage /> },
  { path: 'settlements', element: <SettlementsPage /> },
  { path: 'activity-logs', element: <ActivityLogsPage /> },
  { path: 'vouchers', element: <VouchersPage /> },
  { path: 'notifications', element: <NotificationsPage /> },
  { path: 'notifications/new', element: <NotificationsNewPage /> },
  { path: 'notifications/:id', element: <NotificationDetailsPage /> },
];

const customerRoutes = [
  { path: '/', element: <CustomerPortalLanding /> },
  { path: '/track', element: <OrderTrackingPage /> },
  { path: '/estimate', element: <ShippingEstimatePage /> },
  { path: '/order/:id', element: <OrderTrackingPage /> },
  { path: '/contact', element: <CustomerContactPage /> },
  { path: '/return/:id/method', element: <ReturnMethodPage /> },
  { path: '/return/:id/confirmation', element: <ReturnConfirmationPage /> },
];

const formatCustomerPath = (routePath: string) =>
  routePath === '/' ? '/customer' : `/customer${routePath}`;

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/customer" replace />,
  },
  ...customerRoutes.map((route) => ({
    path: formatCustomerPath(route.path),
    element: route.element,
  })),
  {
    path: '/login',
    element: <LoginPage />,
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
      <ProtectedRoute allowedRoles={['admin', 'agent', 'shop_manager']}>
        <DashboardLayout>
          <Outlet />
        </DashboardLayout>
      </ProtectedRoute>
    ),
    children: [
      // Shared routes (admin + agent)
      ...sharedRoutes,
      // Admin-only routes wrapped in ProtectedRoute
      ...adminOnlyRoutes.map((route) => ({
        path: route.path,
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
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
