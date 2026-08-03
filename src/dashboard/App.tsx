import '../dashboard/index.css';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { router } from '../routes';
import DevBanner, { useDevBannerHeight } from '../components/DevBanner';
import { installGlobalErrorLogging } from './lib/clientErrorLogger';

function App() {
  const bannerHeight = useDevBannerHeight();
  const isDevMode = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    installGlobalErrorLogging();
  }, []);

  return (
    <>
      <DevBanner />
      <div
        style={{
          height: '100%',
          boxSizing: 'border-box',
          paddingTop: isDevMode ? bannerHeight : 0,
          minHeight: 0,
        }}
      >
        <AuthProvider>
          <ThemeProvider>
            <NotificationProvider>
              <RouterProvider router={router} />
            </NotificationProvider>
          </ThemeProvider>
        </AuthProvider>
      </div>
    </>
  );
}

export default App;
