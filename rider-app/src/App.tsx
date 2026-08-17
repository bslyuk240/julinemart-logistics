import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import Apply from './pages/Apply';
import Home from './pages/Home';
import ActiveDelivery from './pages/ActiveDelivery';
import Earnings from './pages/Earnings';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route
        path="/apply"
        element={
          <PrivateRoute>
            <Apply />
          </PrivateRoute>
        }
      />
      <Route
        path="/delivery"
        element={
          <PrivateRoute>
            <ActiveDelivery />
          </PrivateRoute>
        }
      />
      <Route
        path="/earnings"
        element={
          <PrivateRoute>
            <Earnings />
          </PrivateRoute>
        }
      />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Home />
          </PrivateRoute>
        }
      />
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
