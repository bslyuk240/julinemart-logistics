import { useEffect } from 'react';
import { HashRouter as Router, Route, Routes } from 'react-router-dom';
import DevBanner, { useDevBannerHeight } from '../components/DevBanner';
import { logActivity } from './lib/logActivity';
import {
  CustomerContactRoute,
  CustomerEstimateRoute,
  CustomerLandingRoute,
  CustomerManualShipmentTrackRoute,
  CustomerReturnConfirmationRoute,
  CustomerReturnMethodRoute,
  CustomerStandaloneLayout,
  CustomerTrackRoute,
} from './mobile/routes';

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
            <Route element={<CustomerStandaloneLayout />}>
              <Route index element={<CustomerLandingRoute />} />
              <Route path="track" element={<CustomerTrackRoute />} />
              <Route path="track/shipment" element={<CustomerManualShipmentTrackRoute />} />
              <Route path="estimate" element={<CustomerEstimateRoute />} />
              <Route path="contact" element={<CustomerContactRoute />} />
              <Route path="return/:id/method" element={<CustomerReturnMethodRoute />} />
              <Route path="return/:id/confirmation" element={<CustomerReturnConfirmationRoute />} />
            </Route>
          </Routes>
        </Router>
      </div>
    </>
  );
}

export default CustomerPortalApp;
