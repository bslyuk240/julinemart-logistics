import { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

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

function wrapAdmin(element: ReactNode) {
  return (
    <ProtectedRoute role="admin">
      <DashboardLayout>{element}</DashboardLayout>
    </ProtectedRoute>
  );
}

function wrapManager(element: ReactNode) {
  return (
    <ProtectedRoute role="manager">
      <DashboardLayout>{element}</DashboardLayout>
    </ProtectedRoute>
  );
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/customer" replace />} />

        {/* Customer portal */}
        <Route path="/customer" element={<CustomerPortalLanding />} />
        <Route path="/customer/track" element={<OrderTrackingPage />} />
        <Route path="/customer/shipping-estimate" element={<ShippingEstimatePage />} />
        <Route path="/customer/estimate" element={<ShippingEstimatePage />} />
        <Route path="/customer/contact" element={<CustomerContactPage />} />
        <Route path="/customer/order/:id" element={<OrderTrackingPage />} />

        {/* Auth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        {/* Admin portal */}
        <Route path="/admin" element={wrapAdmin(<DashboardHome />)} />
        <Route path="/admin/dashboard" element={wrapAdmin(<DashboardHome />)} />
        <Route path="/admin/orders" element={wrapAdmin(<OrdersPage />)} />
        <Route path="/admin/orders/create" element={wrapAdmin(<CreateOrderPage />)} />
        <Route path="/admin/orders/:id" element={wrapAdmin(<OrderDetailsPage />)} />
        <Route path="/admin/hubs" element={wrapAdmin(<HubsPage />)} />
        <Route path="/admin/couriers" element={wrapAdmin(<CouriersPage />)} />
        <Route path="/admin/rates" element={wrapAdmin(<ShippingRatesPage />)} />
        <Route path="/admin/analytics" element={wrapAdmin(<AnalyticsPage />)} />
        <Route path="/admin/users" element={wrapAdmin(<UsersPage />)} />
        <Route path="/admin/courier-settings" element={wrapAdmin(<CourierSettingsPage />)} />
        <Route path="/admin/settings" element={wrapAdmin(<SettingsPage />)} />
        <Route path="/admin/email-settings" element={wrapAdmin(<EmailSettingsPage />)} />
        <Route path="/admin/settlements" element={wrapAdmin(<SettlementsPage />)} />
        <Route path="/admin/activity-logs" element={wrapAdmin(<ActivityLogsPage />)} />

        {/* Manager portal */}
        <Route path="/manager" element={wrapManager(<ManagerHome />)} />
        <Route path="/manager/attendance" element={wrapManager(<ManagerAttendance />)} />
        <Route path="/manager/performance" element={wrapManager(<ManagerPerformance />)} />

        {/* Legacy redirect */}
        <Route path="/dashboard/*" element={<Navigate to="/admin/dashboard" replace />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/customer" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
