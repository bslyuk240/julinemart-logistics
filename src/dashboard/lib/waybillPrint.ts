import { supabase } from '../contexts/AuthContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type WaybillParams = {
  subOrderId?: string;
  returnShipmentId?: string;
  shipmentId?: string;
};

/** Fetch an authenticated waybill HTML page and open it for printing. */
export async function openWaybillPrint(params: WaybillParams): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw new Error('Sign in required to print waybills.');
  }

  const qs = new URLSearchParams({ print: 'true' });
  if (params.subOrderId) qs.set('subOrderId', params.subOrderId);
  if (params.returnShipmentId) qs.set('returnShipmentId', params.returnShipmentId);
  if (params.shipmentId) qs.set('shipmentId', params.shipmentId);

  const res = await fetch(`${functionsBase}/generate-waybill?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    let message = 'Could not generate waybill.';
    try {
      const json = await res.json();
      message = json.error || json.message || message;
    } catch {
      /* HTML or empty body */
    }
    throw new Error(message);
  }

  const html = await res.text();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error('Pop-up blocked — allow pop-ups to print the waybill.');
  }
  win.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
}
