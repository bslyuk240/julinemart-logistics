import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import SetPassword from './pages/SetPassword';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Profile from './pages/Profile';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, influencer, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (!influencer) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <p className="text-gray-600 mb-2">No influencer account is linked to your login.</p>
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
      <Route path="/set-password" element={<SetPassword />} />
      {/* Invite emails from influencer-invite.js use …/setup — same page as set-password */}
      <Route path="/setup" element={<SetPassword />} />
      <Route path="/*" element={
        <PrivateRoute>
          <Layout>
            <Routes>
              <Route path="/"        element={<Dashboard />} />
              <Route path="/sales"   element={<Sales />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="*"        element={<Navigate to="/" replace />} />
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
