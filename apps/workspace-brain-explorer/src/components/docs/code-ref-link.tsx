import {
  BookMarked,
  Box,
  Braces,
  FileCode2,
  FileText,
  FlaskConical,
  FunctionSquare,
  Settings2,
  Table2,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import type { CodeRef, CodeRefKind } from '@/lib/how-it-works/concepts';
import { hasSource } from '@/lib/source-files';
import { cn } from '@/lib/utils';

import { useInspector } from './inspector-context';

const KIND_ICON: Record<CodeRefKind, LucideIcon> = {
  function: FunctionSquare,
  method: FunctionSquare,
  class: Box,
  type: Braces,
  constant: Braces,
  table: Table2,
  test: FlaskConical,
  config: Settings2,
  doc: FileText,
  script: Terminal,
  component: BookMarked,
  file: FileCode2,
};

export function codeRefLabel(ref: CodeRef): string {
  if (ref.label) return ref.label;
  if (ref.symbol && !ref.symbol.startsWith('text:')) return ref.symbol;
  return ref.path.split('/').pop() ?? ref.path;
}

export function CodeRefLink({
  codeRef,
  className,
  showPath = true,
}: {
  codeRef: CodeRef;
  className?: string;
  showPath?: boolean;
}) {
  const inspector = useInspector();
  const Icon = KIND_ICON[codeRef.kind];
  const exists = hasSource(codeRef.path);
  return (
    <button
      type="button"
      onClick={() => inspector.open({ kind: 'code', ref: codeRef })}
      className={cn(
        'group flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
        className,
      )}
      title={
        codeRef.description ??
        `${codeRef.path}${codeRef.symbol ? ` · ${codeRef.symbol}` : ''}`
      }
    >
      {exists ? (
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
      )}
      <span className="min-w-0">
        <span className="block truncate font-mono text-[13px] font-medium group-hover:text-primary">
          {codeRefLabel(codeRef)}
        </span>
        {showPath && (
          <span className="block truncate text-xs text-muted-foreground">
            {codeRef.description ?? codeRef.path}
          </span>
        )}
      </span>
      <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {codeRef.kind}
      </span>
    </button>
  );
}
