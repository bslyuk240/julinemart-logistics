import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { DashboardLayout } from './components/DashboardLayout';

// Auth Pages
import { LoginPage } from './pages/auth/Login';
import { SignUpPage } from './pages/auth/SignUp';
import { ForgotPasswordPage } from './pages/auth/ForgotPassword';
import { ResetPasswordPage } from './pages/auth/ResetPassword';

// Dashboard Pages
import { DashboardHome } from './pages/DashboardHome';
import { OrdersPage } from './pages/Orders';
import { OrderDetailsPage } from './pages/OrderDetails';
import { CreateOrderPage } from './pages/CreateOrder';
import { HubsPage } from './pages/Hubs';
import { CouriersPage } from './pages/Couriers';
import { ShippingRatesPage } from './pages/ShippingRates';
import { AnalyticsPage } from './pages/Analytics';
import { UsersPage } from './pages/Users';
import { ActivityLogsPage } from './pages/ActivityLogs';
import { CourierSettingsPage } from './pages/CourierSettings';
import { SettingsPage } from './pages/Settings';
import { EmailSettingsPage } from './pages/EmailSettings';
import { SettlementsPage } from './pages/Settlements';

import './index.css';

function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Protected Dashboard Routes */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <DashboardHome />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/orders"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <OrdersPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/orders/create"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager']}>
                  <DashboardLayout>
                    <CreateOrderPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/orders/:id"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <OrderDetailsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/hubs"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <HubsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/couriers"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <CouriersPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/rates"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager']}>
                  <DashboardLayout>
                    <ShippingRatesPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/analytics"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <AnalyticsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/users"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <DashboardLayout>
                    <UsersPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />
            
            <Route
              path="/dashboard/activity"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager']}>
                  <DashboardLayout>
                    <ActivityLogsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

                        
            <Route
              path="/dashboard/courier-settings"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <DashboardLayout>
                    <CourierSettingsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

                        
            <Route
              path="/dashboard/settings"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <DashboardLayout>
                    <SettingsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

                        
            <Route
              path="/dashboard/settlements"
              element={
                <ProtectedRoute allowedRoles={['admin', 'manager']}>
                  <DashboardLayout>
                    <SettlementsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

                        
            <Route
              path="/dashboard/email-settings"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <DashboardLayout>
                    <EmailSettingsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            {/* 404 Route */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </NotificationProvider>
    </AuthProvider>
  );
}

export default App;




