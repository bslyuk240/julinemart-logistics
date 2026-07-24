import QRCode from 'qrcode';

// INT-504 — QR generation. Each campaign can have several trackable channel
// variants (poster, flyer, Instagram bio, etc.), all pointing at the same
// campaign slug but tagged with a distinct ?qr_source= so scans attribute to
// the right physical/digital placement (campaign_qr_variants.tracking_slug).

export function slugifyChannel(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCampaignTrackingUrl(baseUrl: string, campaignSlug: string, trackingSlug: string): string {
  const url = new URL(`/campaigns/${campaignSlug}`, baseUrl);
  url.searchParams.set('qr_source', trackingSlug);
  return url.toString();
}

export async function generateQrPngDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
}

export async function generateQrSvgMarkup(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadSvgMarkup(svg: string, filename: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  URL.revokeObjectURL(url);
}
