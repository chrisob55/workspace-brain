import { Copy, ExternalLink, FileCode2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CodeRef } from '@/lib/how-it-works/concepts';
import {
  editorUrl,
  githubUrl,
  hasSource,
  loadSource,
  locateSymbol,
  type SymbolLocation,
} from '@/lib/source-files';
import { cn } from '@/lib/utils';

import { Button } from '../ui/button';

const CONTEXT_LINES = 12;
const MAX_FOCUS_LINES = 400;

function useSource(path: string) {
  const [state, setState] = useState<{
    path: string;
    content?: string;
    error?: string;
  }>({ path });
  useEffect(() => {
    let cancelled = false;
    if (!hasSource(path)) {
      setState({ path, error: 'This file is not in the indexed repository.' });
      return;
    }
    setState({ path });
    loadSource(path).then(
      (content) => !cancelled && setState({ path, content }),
      (error: Error) => !cancelled && setState({ path, error: error.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [path]);
  return state.path === path ? state : { path };
}

export function CodeViewer({ codeRef }: { codeRef: CodeRef }) {
  const { content, error } = useSource(codeRef.path);
  const [showAll, setShowAll] = useState(false);
  const highlightRef = useRef<HTMLDivElement>(null);

  const location: SymbolLocation | undefined = useMemo(
    () =>
      content && codeRef.symbol
        ? locateSymbol(content, codeRef.symbol)
        : undefined,
    [content, codeRef.symbol],
  );
  const lines = useMemo(() => content?.split('\n') ?? [], [content]);
  const unresolved = !!content && !!codeRef.symbol && !location;

  const [from, to] = useMemo(() => {
    if (showAll || !location) return [1, lines.length];
    const end = Math.min(location.endLine, location.line + MAX_FOCUS_LINES);
    return [
      Math.max(1, location.line - CONTEXT_LINES),
      Math.min(lines.length, end + CONTEXT_LINES),
    ];
  }, [showAll, location, lines.length]);

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: 'center' });
  }, [location, showAll]);

  const github = githubUrl(codeRef.path, location);
  const editor = editorUrl(codeRef.path, location);
  const extension = codeRef.path.split('.').pop();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <FileCode2 className="size-4 shrink-0" />
          <span className="break-all">{codeRef.path}</span>
          {location && (
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
              L{location.line}
              {location.endLine > location.line ? `–${location.endLine}` : ''}
            </span>
          )}
        </div>
        {codeRef.description && (
          <p className="text-sm text-muted-foreground">{codeRef.description}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={github} target="_blank" rel="noreferrer">
              <ExternalLink /> GitHub
            </a>
          </Button>
          {editor && (
            <Button asChild size="sm" variant="outline">
              <a href={editor}>
                <ExternalLink /> Open in VS Code
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard?.writeText(
                `${codeRef.path}${location ? `:${location.line}` : ''}`,
              )
            }
          >
            <Copy /> Copy path
          </Button>
          {location && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? 'Focus symbol' : 'Show whole file'}
            </Button>
          )}
        </div>
      </div>

      {(error || unresolved) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <span>
            {error ??
              `"${codeRef.symbol}" could not be located in this file. The code may have changed; showing the whole file.`}
          </span>
        </div>
      )}

      {content !== undefined ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/40 font-mono text-[12px] leading-5">
          <pre className="min-w-max py-2" data-language={extension}>
            {lines.slice(from - 1, to).map((text, index) => {
              const number = from + index;
              const highlighted =
                !!location &&
                number >= location.line &&
                number <= location.endLine;
              return (
                <div
                  key={number}
                  ref={number === location?.line ? highlightRef : undefined}
                  className={cn(
                    'flex pr-4',
                    highlighted && 'bg-primary/12',
                    number === location?.line &&
                      'shadow-[inset_3px_0_0_var(--color-primary)]',
                  )}
                >
                  <span className="w-12 shrink-0 select-none pr-3 text-right text-muted-foreground/60">
                    {number}
                  </span>
                  <code className="whitespace-pre">{text || ' '}</code>
                </div>
              );
            })}
          </pre>
        </div>
      ) : (
        !error && (
          <p className="text-sm text-muted-foreground">Loading source…</p>
        )
      )}
    </div>
  );
}
