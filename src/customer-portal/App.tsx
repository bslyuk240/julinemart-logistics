import { useEffect } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { CustomerPortalLanding } from './pages/Landing';
import { OrderTrackingPage } from './pages/Track';
import { ShippingEstimatePage } from './pages/ShippingEstimate';
import { CustomerContactPage } from './pages/Contact';
import DevBanner, { useDevBannerHeight } from '../components/DevBanner';
import { logActivity } from './lib/logActivity';

function CustomerPortalApp() {
  const isDevMode = process.env.NODE_ENV !== 'production';
  const bannerHeight = useDevBannerHeight();
  const contentStyle = isDevMode ? { paddingTop: bannerHeight } : undefined;

  useEffect(() => {
    logActivity({
      action: 'PWA_OPENED',
      resource_type: 'pwa',
      details: {
        path: window.location.pathname,
        hash: window.location.hash,
      },
    });
  }, []);

  return (
    <>
      <DevBanner />
      <div style={contentStyle}>
        <Router>
          <Routes>
            <Route path="/" element={<CustomerPortalLanding />} />
            <Route path="/track" element={<OrderTrackingPage />} />
            <Route path="/estimate" element={<ShippingEstimatePage />} />
            <Route path="/contact" element={<CustomerContactPage />} />
          </Routes>
        </Router>
      </div>
    </>
  );
}

export default CustomerPortalApp;
