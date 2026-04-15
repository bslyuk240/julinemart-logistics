/** Text wordmark — SVG text in img src often renders blank; real typography always works. */
type Variant = 'onGradient' | 'onLight';

export function JulineMartWordmark({
  variant = 'onGradient',
  className = '',
}: {
  variant?: Variant;
  className?: string;
}) {
  if (variant === 'onLight') {
    return (
      <div
        className={`font-bold tracking-tight select-none ${className}`}
        aria-label="JulineMart"
      >
        <span className="text-primary-600">Juline</span>
        <span className="text-gray-900">Mart</span>
      </div>
    );
  }
  return (
    <div
      className={`font-bold tracking-tight text-white select-none ${className}`}
      aria-label="JulineMart"
    >
      JulineMart
    </div>
  );
}
