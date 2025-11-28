import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';

import { CustomerPortalLanding } from './customer-portal/pages/Landing';
import { OrderTrackingPage } from './customer-portal/pages/Track';
import { ShippingEstimatePage } from './customer-portal/pages/ShippingEstimate';
import { CustomerContactPage } from './customer-portal/pages/Contact';

import { DashboardLayout } from './dashboard/components/DashboardLayout';
import { LoginPage } from './dashboard/pages/auth/Login';
import { SignUpPage } from './dashboard/pages/auth/SignUp';
import { ForgotPasswordPage } from './dashboard/pages/auth/ForgotPassword';
import { ResetPasswordPage } from './dashboard/pages/auth/ResetPassword';
import { DashboardHome } from './dashboard/pages/DashboardHome';
import { OrdersPage } from './dashboard/pages/Orders';
import { OrderDetailsPage } from './dashboard/pages/OrderDetails';
import { CreateOrderPage } from './dashboard/pages/CreateOrder';
import { HubsPage } from './dashboard/pages/Hubs';
import { CouriersPage } from './dashboard/pages/Couriers';
import { ShippingRatesPage } from './dashboard/pages/ShippingRates';
import { AnalyticsPage } from './dashboard/pages/Analytics';
import { UsersPage } from './dashboard/pages/Users';
import { CourierSettingsPage } from './dashboard/pages/CourierSettings';
import { SettingsPage } from './dashboard/pages/Settings';
import { EmailSettingsPage } from './dashboard/pages/EmailSettings';
import { SettlementsPage } from './dashboard/pages/Settlements';
import { ActivityLogsPage } from './dashboard/pages/ActivityLogs';
import {
  ManagerHome,
  ManagerAttendance,
  ManagerPerformance,
} from './dashboard/manager';
import { ProtectedRoute } from './components/ProtectedRoute';
import { UnauthorizedPage } from './shared/UnauthorizedPage';

const adminRoutes = [
  { path: '', element: <DashboardHome /> },
  { path: 'dashboard', element: <DashboardHome /> },
  { path: 'orders', element: <OrdersPage /> },
  { path: 'orders/create', element: <CreateOrderPage /> },
  { path: 'orders/:id', element: <OrderDetailsPage /> },
  { path: 'hubs', element: <HubsPage /> },
  { path: 'couriers', element: <CouriersPage /> },
  { path: 'rates', element: <ShippingRatesPage /> },
  { path: 'analytics', element: <AnalyticsPage /> },
  { path: 'users', element: <UsersPage /> },
  { path: 'courier-settings', element: <CourierSettingsPage /> },
  { path: 'settings', element: <SettingsPage /> },
  { path: 'email-settings', element: <EmailSettingsPage /> },
  { path: 'settlements', element: <SettlementsPage /> },
  { path: 'activity-logs', element: <ActivityLogsPage /> },
];

const managerRoutes = [
  { path: '', element: <ManagerHome /> },
  { path: 'attendance', element: <ManagerAttendance /> },
  { path: 'performance', element: <ManagerPerformance /> },
];

const customerRoutes = [
  { path: '/', element: <CustomerPortalLanding /> },
  { path: '/track', element: <OrderTrackingPage /> },
  { path: '/estimate', element: <ShippingEstimatePage /> },
  { path: '/order/:id', element: <OrderTrackingPage /> },
  { path: '/contact', element: <CustomerContactPage /> },
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
    path: '/signup',
    element: <SignUpPage />,
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
      <ProtectedRoute allowedRoles={['admin']}>
        <DashboardLayout>
          <Outlet />
        </DashboardLayout>
      </ProtectedRoute>
    ),
    children: adminRoutes,
  },
  {
    path: '/manager',
    element: (
      <ProtectedRoute allowedRoles={['manager']}>
        <DashboardLayout>
          <Outlet />
        </DashboardLayout>
      </ProtectedRoute>
    ),
    children: managerRoutes,
  },
  {
    path: '*',
    element: <Navigate to="/customer" replace />,
  },
]);
