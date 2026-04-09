import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Orders from './pages/Orders';
import Earnings from './pages/Earnings';
import Withdrawals from './pages/Withdrawals';
import Settings from './pages/Settings';
import SetPassword from './pages/SetPassword';
import AddProduct from './pages/AddProduct';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, vendor, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (!vendor) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <p className="text-gray-600 mb-2">No vendor account is linked to your login.</p>
        <p className="text-sm text-gray-500">Contact JulineMart support to get access.</p>
      </div>
    </div>
  );
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"        element={<Login />} />
      <Route path="/register"     element={<Register />} />
      <Route path="/set-password" element={<SetPassword />} />
      <Route path="/*" element={
        <PrivateRoute>
          <Layout>
            <Routes>
              <Route path="/"            element={<Dashboard />} />
              <Route path="/products"           element={<Products />} />
              <Route path="/products/add"      element={<AddProduct />} />
              <Route path="/products/edit/:id" element={<AddProduct />} />
              <Route path="/orders"      element={<Orders />} />
              <Route path="/earnings"    element={<Earnings />} />
              <Route path="/withdrawals" element={<Withdrawals />} />
              <Route path="/settings"    element={<Settings />} />
              <Route path="*"            element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </PrivateRoute>
      } />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
