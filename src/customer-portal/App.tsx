import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { CustomerPortalLanding } from './pages/Landing';
import { OrderTrackingPage } from './pages/Track';
import { ShippingEstimatePage } from './pages/ShippingEstimate';
import { CustomerContactPage } from './pages/Contact';
import DevBanner from '../components/DevBanner';

function CustomerPortalApp() {
  const isDevMode = process.env.NODE_ENV !== 'production';
  const contentStyle = isDevMode ? { paddingTop: 36 } : undefined;

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
