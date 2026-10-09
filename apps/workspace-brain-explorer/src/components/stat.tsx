import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn, formatNumber } from '@/lib/utils';

export function Stat({
  label,
  value,
  icon: Icon,
  color,
  hint,
  loading = false,
  className,
}: {
  label: string;
  value: number | string | undefined;
  icon: LucideIcon;
  color: string;
  hint?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border bg-card p-5',
        className,
      )}
    >
      <div
        className="absolute -right-6 -top-6 size-24 rounded-full opacity-20 blur-2xl"
        style={{ background: color }}
      />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" style={{ color }} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight md:text-4xl">
        {loading ? (
          <span className="inline-block h-9 w-20 animate-pulse rounded bg-muted" />
        ) : typeof value === 'number' ? (
          formatNumber(value)
        ) : (
          (value ?? '—')
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
