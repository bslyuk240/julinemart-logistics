import { supabase } from '../contexts/AuthContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type ShipmentDocParams = {
  subOrderId?: string;
  returnShipmentId?: string;
  shipmentId?: string;
};

export type WaybillParams = ShipmentDocParams;
export type LabelParams = Pick<ShipmentDocParams, 'subOrderId' | 'shipmentId'>;

const LOADING_HTML =
  '<!DOCTYPE html><html><head><title>Loading</title></head><body style="font-family:sans-serif;padding:2rem;text-align:center;color:#64748b"><p>Loading…</p></body></html>';

function isMobilePreview(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

function showInPagePrintPreview(html: string, title: string, overlayId: string): void {
  const existing = document.getElementById(overlayId);
  existing?.remove();

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${title} preview`);
  overlay.className = 'fixed inset-0 z-[200] flex flex-col bg-slate-100';

  const toolbar = document.createElement('div');
  toolbar.className =
    'flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]';

  const titleEl = document.createElement('p');
  titleEl.className = 'text-sm font-semibold text-gray-900';
  titleEl.textContent = title;

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2';

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white';
  printBtn.textContent = 'Print / Save';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700';
  closeBtn.textContent = 'Close';

  const frameWrap = document.createElement('div');
  frameWrap.className = 'min-h-0 flex-1 overflow-auto px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]';

  const iframe = document.createElement('iframe');
  iframe.title = `${title} document`;
  iframe.className = 'mx-auto block w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-sm';
  iframe.style.minHeight = 'calc(100dvh - 8rem)';
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
  toolbar.append(titleEl, actions);
  frameWrap.append(iframe);
  overlay.append(toolbar, frameWrap);
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

async function openShippingDocument(
  endpoint: 'generate-waybill' | 'generate-label',
  params: ShipmentDocParams,
  title: string,
  overlayId: string,
  accessToken?: string | null,
): Promise<void> {
  const mobile = isMobilePreview();
  const popup = mobile ? null : window.open('about:blank', '_blank');
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
    throw new Error(`Sign in required to print ${title.toLowerCase()}s.`);
  }

  const qs = new URLSearchParams({ print: mobile ? 'false' : 'true' });
  if (params.subOrderId) qs.set('subOrderId', params.subOrderId);
  if (params.returnShipmentId) qs.set('returnShipmentId', params.returnShipmentId);
  if (params.shipmentId) qs.set('shipmentId', params.shipmentId);

  const res = await fetch(`${functionsBase}/${endpoint}?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    popup?.close();
    let message = `Could not generate ${title.toLowerCase()}.`;
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

  showInPagePrintPreview(html, title, overlayId);
}

/** Fetch an authenticated waybill HTML page and open it for printing. */
export async function openWaybillPrint(params: WaybillParams, accessToken?: string | null): Promise<void> {
  return openShippingDocument('generate-waybill', params, 'Waybill', 'waybill-print-overlay', accessToken);
}

/** Fetch an authenticated shipping label and open it for printing. */
export async function openLabelPrint(params: LabelParams, accessToken?: string | null): Promise<void> {
  return openShippingDocument('generate-label', params, 'Shipping label', 'label-print-overlay', accessToken);
}
