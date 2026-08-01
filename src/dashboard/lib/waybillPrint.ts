import { supabase } from '../contexts/AuthContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type WaybillParams = {
  subOrderId?: string;
  returnShipmentId?: string;
  shipmentId?: string;
};

const LOADING_HTML =
  '<!DOCTYPE html><html><head><title>Waybill</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center;color:#64748b"><p>Loading waybill…</p></body></html>';

/** Full-screen in-app viewer when mobile browsers block window.open. */
function showInPageWaybill(html: string): void {
  const existing = document.getElementById('waybill-print-overlay');
  existing?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'waybill-print-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Waybill preview');
  overlay.className = 'fixed inset-0 z-[200] flex flex-col bg-white';

  const toolbar = document.createElement('div');
  toolbar.className =
    'flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]';

  const title = document.createElement('p');
  title.className = 'text-sm font-semibold text-gray-900';
  title.textContent = 'Waybill';

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2';

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white';
  printBtn.textContent = 'Print / Save';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700';
  closeBtn.textContent = 'Close';

  const iframe = document.createElement('iframe');
  iframe.title = 'Waybill document';
  iframe.className = 'min-h-0 flex-1 w-full border-0';
  iframe.srcdoc = html;

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const close = () => {
    document.body.style.overflow = prevOverflow;
    overlay.remove();
  };

  printBtn.addEventListener('click', () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      /* print may be unavailable in some embedded contexts */
    }
  });
  closeBtn.addEventListener('click', close);

  actions.append(printBtn, closeBtn);
  toolbar.append(title, actions);
  overlay.append(toolbar, iframe);
  document.body.appendChild(overlay);
}

function writeHtmlToWindow(win: Window, html: string, autoPrint = false): void {
  win.document.open();
  win.document.write(html);
  win.document.close();
  if (autoPrint) {
    win.addEventListener(
      'load',
      () => {
        try {
          win.focus();
          win.print();
        } catch {
          /* user can print manually */
        }
      },
      { once: true },
    );
  }
}

/** Fetch an authenticated waybill HTML page and open it for printing. */
export async function openWaybillPrint(params: WaybillParams, accessToken?: string | null): Promise<void> {
  // Must open synchronously on the user click — async fetch first breaks mobile pop-up rules.
  const popup = window.open('about:blank', '_blank');
  if (popup) {
    writeHtmlToWindow(popup, LOADING_HTML);
  }

  let token = accessToken;
  if (!token) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    token = session?.access_token;
  }
  if (!token) {
    popup?.close();
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
    popup?.close();
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

  if (popup && !popup.closed) {
    writeHtmlToWindow(popup, html, true);
    return;
  }

  showInPageWaybill(html);
}
