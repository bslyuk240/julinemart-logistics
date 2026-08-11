import { Outlet } from 'react-router-dom';
import { useIsMobile } from '../../dashboard/hooks/useIsMobile';
import { CustomerContactPage } from '../pages/Contact';
import { CustomerPortalLanding } from '../pages/Landing';
import { ReturnConfirmationPage } from '../pages/returns/ReturnConfirmation';
import { ReturnMethodPage } from '../pages/returns/ReturnMethod';
import { ShippingEstimatePage } from '../pages/ShippingEstimate';
import { OrderTrackingPage } from '../pages/Track';
import { ManualShipmentTrackingPage } from '../pages/TrackManualShipment';
import { CustomerShell } from './CustomerShell';
import MobileCustomerContact from './screens/Contact';
import MobileCustomerHome from './screens/Home';
import MobileManualShipmentTracking from './screens/ManualShipmentTracking';
import MobileOrderTracking from './screens/OrderTracking';
import MobileReturnConfirmation from './screens/ReturnConfirmation';
import MobileReturnMethod from './screens/ReturnMethod';
import MobileShippingEstimate from './screens/ShippingEstimate';

export function CustomerPortalLayout() {
  const isMobile = useIsMobile();
  if (!isMobile) return <Outlet />;
  return (
    <CustomerShell>
      <Outlet />
    </CustomerShell>
  );
}

export function CustomerLandingRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCustomerHome /> : <CustomerPortalLanding />;
}

export function CustomerTrackRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileOrderTracking /> : <OrderTrackingPage />;
}

export function CustomerManualShipmentTrackRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileManualShipmentTracking /> : <ManualShipmentTrackingPage />;
}

export function CustomerEstimateRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileShippingEstimate /> : <ShippingEstimatePage />;
}

export function CustomerContactRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileCustomerContact /> : <CustomerContactPage />;
}

export function CustomerReturnMethodRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileReturnMethod /> : <ReturnMethodPage />;
}

export function CustomerReturnConfirmationRoute() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileReturnConfirmation /> : <ReturnConfirmationPage />;
}

/** Standalone HashRouter app — wraps child routes in the mobile shell when viewport is narrow. */
export function CustomerStandaloneLayout() {
  const isMobile = useIsMobile();
  if (!isMobile) return <Outlet />;
  return (
    <CustomerShell>
      <Outlet />
    </CustomerShell>
  );
}
