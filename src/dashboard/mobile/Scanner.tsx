import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { X, ZapOff } from 'lucide-react';

interface ScannerProps {
  onDetect: (value: string) => void;
  onClose: () => void;
}

type CameraState = 'requesting' | 'active' | 'denied' | 'unsupported';

// jsQR (not the native BarcodeDetector) so this works the same on every
// browser — BarcodeDetector isn't available on iOS Safari or in some Android
// webviews, and this app can't assume which one a hub worker's phone has.
export function Scanner({ onDetect, onClose }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectedRef = useRef(false);
  const [state, setState] = useState<CameraState>('requesting');
  const [manualValue, setManualValue] = useState('');

  useEffect(() => {
    detectedRef.current = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }

    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setState('active');
        tick();
      })
      .catch(() => {
        if (!cancelled) setState('denied');
      });

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || detectedRef.current) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });
          if (result?.data) {
            detectedRef.current = true;
            onDetect(result.data);
            return;
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div
        className="flex items-center justify-between px-4 pb-3"
        style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}
      >
        <span className="text-sm font-medium text-white">Scan waybill</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scanner"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {state === 'active' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-56 w-56 rounded-2xl border-2 border-white/80" />
          </div>
        )}

        {state === 'requesting' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Requesting camera…
          </div>
        )}

        {(state === 'denied' || state === 'unsupported') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <ZapOff className="h-8 w-8 text-white/50" />
            <p className="text-sm text-white/70">
              {state === 'denied'
                ? 'Camera access was denied. Enable it in your browser settings, or enter the tracking number manually.'
                : "This browser can't access the camera. Enter the tracking number manually."}
            </p>
            <form
              className="flex w-full max-w-xs gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (manualValue.trim()) onDetect(manualValue.trim());
              }}
            >
              <input
                type="text"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                placeholder="Tracking number"
                autoFocus
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/40"
                style={{ fontSize: '16px' }}
              />
              <button
                type="submit"
                disabled={!manualValue.trim()}
                className="shrink-0 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:opacity-40"
              >
                Find
              </button>
            </form>
          </div>
        )}
      </div>

      <p className="px-4 pb-6 pt-4 text-center text-xs text-white/50" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
        Point the camera at the QR code on the shipping label
      </p>
    </div>
  );
}
