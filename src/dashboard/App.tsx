import '../dashboard/index.css';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { router } from '../routes';
import DevBanner from '../components/DevBanner';

function App() {
  const isDevMode = process.env.NODE_ENV !== 'production';
  const containerStyle = isDevMode ? { paddingTop: 36 } : undefined;

  return (
    <>
      <DevBanner />
      <div style={containerStyle}>
        <AuthProvider>
          <NotificationProvider>
            <RouterProvider router={router} />
          </NotificationProvider>
        </AuthProvider>
      </div>
    </>
  );
}

export default App;
