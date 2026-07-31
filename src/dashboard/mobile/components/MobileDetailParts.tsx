import type { ReactNode } from 'react';
import { ArrowRight, MapPin, Phone } from 'lucide-react';

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-wide text-gray-400">{children}</p>;
}

export function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <span className="shrink-0 text-sm text-gray-500">{label}</span>
      <span className={`truncate text-right text-sm font-medium text-gray-900 ${mono ? 'tabular-nums' : ''}`}>{value}</span>
    </div>
  );
}

export function ContactSection({
  title,
  name,
  lines,
  phone,
}: {
  title: string;
  name: string;
  lines: string[];
  phone?: string | null;
}) {
  return (
    <>
      <SectionLabel>{title}</SectionLabel>
      <div className="mx-4 overflow-hidden rounded-xl bg-white">
        <div className="flex gap-3 px-4 py-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
            <MapPin className="h-4 w-4 text-gray-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">{name}</p>
            {lines.filter(Boolean).map((line) => (
              <p key={line} className="text-xs leading-relaxed text-gray-500">
                {line}
              </p>
            ))}
          </div>
        </div>
        {phone && (
          <a href={`tel:${phone}`} className="flex items-center gap-3 border-t border-gray-100 px-4 py-3.5 active:bg-gray-50">
            <Phone className="h-4 w-4 shrink-0 text-primary-600" />
            <span className="flex-1 text-sm font-medium text-primary-600">{phone}</span>
            <ArrowRight className="h-4 w-4 text-gray-300" />
          </a>
        )}
      </div>
    </>
  );
}
