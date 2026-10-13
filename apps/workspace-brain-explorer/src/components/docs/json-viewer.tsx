import { ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '../ui/button';

const PAGE = 50;

function summary(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).length} keys}`;
  return '';
}

function Scalar({ value }: { value: unknown }) {
  if (value === null)
    return <span className="text-muted-foreground">null</span>;
  if (typeof value === 'string')
    return (
      <span className="break-all text-emerald-600 dark:text-emerald-400">
        "{value}"
      </span>
    );
  if (typeof value === 'number')
    return <span className="text-sky-600 dark:text-sky-400">{value}</span>;
  if (typeof value === 'boolean')
    return (
      <span className="text-violet-600 dark:text-violet-400">
        {String(value)}
      </span>
    );
  return <span className="text-muted-foreground">undefined</span>;
}

function Node({
  name,
  value,
  depth,
  expandDepth,
}: {
  name?: string;
  value: unknown;
  depth: number;
  expandDepth: number;
}) {
  const composite = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < expandDepth);
  const [limit, setLimit] = useState(PAGE);
  const label = name !== undefined && (
    <span className="text-foreground/80">{name}: </span>
  );
  if (!composite)
    return (
      <div className="py-px pl-5">
        {label}
        <Scalar value={value} />
      </div>
    );
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 py-px text-left hover:text-primary"
      >
        <ChevronRight
          className={cn(
            'size-4 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
        />
        {label}
        <span className="text-muted-foreground">{summary(value)}</span>
      </button>
      {open && (
        <div className="ml-2 border-l pl-2">
          {entries.slice(0, limit).map(([key, item]) => (
            <Node
              key={key}
              name={key}
              value={item}
              depth={depth + 1}
              expandDepth={expandDepth}
            />
          ))}
          {entries.length > limit && (
            <button
              type="button"
              className="pl-5 text-primary hover:underline"
              onClick={() => setLimit((current) => current + PAGE)}
            >
              Show {Math.min(PAGE, entries.length - limit)} more of{' '}
              {entries.length - limit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function JsonViewer({
  value,
  expandDepth = 1,
  className,
}: {
  value: unknown;
  expandDepth?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative rounded-lg border bg-muted/40 p-3 font-mono text-[12px] leading-5',
        className,
      )}
    >
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-1 top-1 size-7"
        title="Copy JSON"
        onClick={() =>
          void navigator.clipboard?.writeText(JSON.stringify(value, null, 2))
        }
      >
        <Copy />
      </Button>
      <div className="overflow-x-auto pr-8">
        <Node value={value} depth={0} expandDepth={expandDepth} />
      </div>
    </div>
  );
}
