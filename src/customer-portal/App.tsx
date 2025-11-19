import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { CustomerPortalLanding } from './pages/Landing';
import { OrderTrackingPage } from './pages/Track';
import { ShippingEstimatePage } from './pages/ShippingEstimate';
import { CustomerContactPage } from './pages/Contact';

function CustomerPortalApp() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<CustomerPortalLanding />} />
        <Route path="/track" element={<OrderTrackingPage />} />
        <Route path="/estimate" element={<ShippingEstimatePage />} />
        <Route path="/contact" element={<CustomerContactPage />} />
      </Routes>
    </Router>
  );
}

export default CustomerPortalApp;
