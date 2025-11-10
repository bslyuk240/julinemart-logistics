import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { CustomerPortalLanding } from './pages/Landing';
import { OrderTrackingPage } from './pages/Track';
import { ShippingEstimatePage } from './pages/ShippingEstimate';

function CustomerPortalApp() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<CustomerPortalLanding />} />
        <Route path="/track" element={<OrderTrackingPage />} />
        <Route path="/estimate" element={<ShippingEstimatePage />} />
      </Routes>
    </Router>
  );
}

export default CustomerPortalApp;
