import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface SignaturePadProps {
  title: string;
  hint: string;
  onCapture: (file: File) => void;
  onClose: () => void;
}

// Handed to the customer to sign directly on the rider's phone — canvas
// coordinates are mapped from both touch and mouse events so this works the
// same whether the phone is a touchscreen (always, in practice) or being
// tested on a desktop browser.
export function SignaturePad({ title, hint, onCapture, onClose }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111827';
    }
  }, []);

  const pointFromEvent = (canvas: HTMLCanvasElement, event: React.PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const ctx = canvas.getContext('2d');
    const { x, y } = pointFromEvent(canvas, event);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { x, y } = pointFromEvent(canvas, event);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    if (!hasStrokeRef.current) {
      hasStrokeRef.current = true;
      setHasStroke(true);
    }
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
    setHasStroke(false);
  };

  const handleDone = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture(new File([blob], 'signature.png', { type: 'image/png' }));
    }, 'image/png');
  }, [onCapture]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div
        className="flex items-center justify-between px-4 pb-3 border-b border-gray-100"
        style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}
      >
        <span className="text-sm font-medium text-gray-900">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close signature pad"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="px-4 pt-4 pb-2 text-center text-xs text-gray-500">{hint}</p>

      <div className="relative flex-1 mx-4 mb-4 rounded-2xl border-2 border-dashed border-gray-300 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {!hasStroke && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-300">
            Sign here
          </div>
        )}
      </div>

      <div
        className="flex gap-2 px-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
      >
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasStroke}
          className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleDone}
          disabled={!hasStroke}
          className="flex-[2] rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          Save Signature
        </button>
      </div>
    </div>
  );
}
