import type { LucideIcon } from 'lucide-react';
import { Fragment } from 'react';

import { cn } from '@/lib/utils';

export interface PipelineStep {
  label: string;
  caption?: string;
  icon: LucideIcon;
  color?: string;
  muted?: boolean;
}

/** An animated left-to-right (or top-to-bottom on small screens) flow of steps. */
export function Pipeline({
  steps,
  active,
  onSelect,
  compact = false,
  vertical = false,
}: {
  steps: PipelineStep[];
  active?: number | undefined;
  onSelect?: (index: number) => void;
  compact?: boolean;
  vertical?: boolean;
}) {
  return (
    <ol
      className={cn(
        'flex items-stretch gap-0',
        vertical ? 'flex-col' : 'flex-col md:flex-row',
      )}
    >
      {steps.map((step, i) => {
        const Icon = step.icon;
        const color = step.color ?? 'var(--primary)';
        const selected = active === i;
        return (
          <Fragment key={step.label}>
            {i > 0 && (
              <Connector
                vertical={vertical}
                muted={step.muted ?? false}
                color={color}
              />
            )}
            <li className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(i)}
                style={{ animationDelay: `${i * 90}ms` }}
                className={cn(
                  'animate-fade-up group relative flex h-full w-full flex-col items-center gap-2 rounded-xl border bg-card text-center transition-all',
                  compact ? 'p-3' : 'p-4',
                  onSelect &&
                    'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg',
                  step.muted && 'border-dashed bg-transparent',
                )}
              >
                <span
                  className={cn(
                    'flex items-center justify-center rounded-lg',
                    compact ? 'size-9' : 'size-11',
                  )}
                  style={{
                    background: `color-mix(in oklch, ${color} 18%, transparent)`,
                    color,
                  }}
                >
                  <Icon className={compact ? 'size-4.5' : 'size-5'} />
                </span>
                <span
                  className={cn(
                    'font-semibold',
                    compact ? 'text-sm' : 'text-base',
                  )}
                >
                  {step.label}
                </span>
                {step.caption && (
                  <span className="text-xs leading-snug text-muted-foreground">
                    {step.caption}
                  </span>
                )}
                {selected && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-xl"
                    style={{
                      boxShadow: `0 0 0 2px ${color}, 0 8px 30px -8px ${color}`,
                    }}
                  />
                )}
              </button>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function Connector({
  vertical,
  muted,
  color,
}: {
  vertical: boolean;
  muted: boolean;
  color: string;
}) {
  const horizontal = (
    <svg
      className="h-6 w-full"
      viewBox="0 0 40 24"
      preserveAspectRatio="none"
      aria-hidden
    >
      <line
        x1="2"
        y1="12"
        x2="34"
        y2="12"
        stroke={color}
        strokeWidth="2"
        className="flow-line"
        opacity={muted ? 0.4 : 0.9}
      />
      <path
        d="M32 7 L38 12 L32 17"
        fill="none"
        stroke={color}
        strokeWidth="2"
      />
    </svg>
  );
  const down = (
    <svg className="h-7 w-6" viewBox="0 0 24 28" aria-hidden>
      <line
        x1="12"
        y1="2"
        x2="12"
        y2="22"
        stroke={color}
        strokeWidth="2"
        className="flow-line"
        opacity={muted ? 0.4 : 0.9}
      />
      <path
        d="M7 20 L12 26 L17 20"
        fill="none"
        stroke={color}
        strokeWidth="2"
      />
    </svg>
  );
  if (vertical)
    return (
      <li className="flex justify-center" aria-hidden>
        {down}
      </li>
    );
  return (
    <li className="flex items-center justify-center" aria-hidden>
      <span className="md:hidden">{down}</span>
      <span className="hidden w-8 shrink-0 md:block lg:w-10">{horizontal}</span>
    </li>
  );
}
