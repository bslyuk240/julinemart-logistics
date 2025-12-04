import type { ComponentType, SVGProps } from 'react';

interface Props {
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  selected?: boolean;
  onClick?: () => void;
  helperText?: string;
}

export function ReturnMethodCard({
  title,
  description,
  icon: Icon,
  selected = false,
  onClick,
  helperText,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-5 transition-all ${
        selected
          ? 'border-primary-500 bg-primary-50 shadow-md'
          : 'border-gray-200 hover:border-primary-200'
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-lg ${
            selected ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-700'
          }`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                selected
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {selected ? 'Selected' : 'Choose'}
            </span>
          </div>
          <p className="text-sm text-gray-600">{description}</p>
          {helperText ? (
            <p className="text-xs font-medium text-primary-600">{helperText}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}
