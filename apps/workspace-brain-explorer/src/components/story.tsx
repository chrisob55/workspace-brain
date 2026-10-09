import { Quote } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function ScreenHeader({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {title}
        </h1>
        {lead && (
          <p className="mt-3 text-base text-muted-foreground md:text-lg">
            {lead}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}

export function KeyMessage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-primary/30 bg-primary/8 px-6 py-5',
        className,
      )}
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-cyan-400" />
      <div className="flex items-start gap-3">
        <Quote className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-lg font-medium leading-snug md:text-xl">
          {children}
        </p>
      </div>
    </div>
  );
}

export function SectionTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      {aside}
    </div>
  );
}
