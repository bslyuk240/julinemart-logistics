/** Normalize a raw QR / barcode scan before lookup. */
export function normalizeScanCode(raw: string): string {
  let code = String(raw ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .trim();

  if (!code) return '';

  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code);
      const param =
        url.searchParams.get('trackingNumber') ||
        url.searchParams.get('tracking') ||
        url.searchParams.get('code') ||
        url.searchParams.get('waybill');
      if (param) code = param.trim();
      else {
        const segment = url.pathname.split('/').filter(Boolean).pop();
        if (segment) code = segment;
      }
    } catch {
      /* keep original */
    }
  }

  return code.trim();
}
