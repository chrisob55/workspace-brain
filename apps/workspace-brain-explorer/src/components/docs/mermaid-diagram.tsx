import { Code2, Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '../ui/button';

let mermaidModule: Promise<(typeof import('mermaid'))['default']> | undefined;

function loadMermaid() {
  mermaidModule ??= import('mermaid').then((module) => module.default);
  return mermaidModule;
}

function isDark() {
  return document.documentElement.classList.contains('dark');
}

export function MermaidDiagram({
  chart,
  title,
  className,
}: {
  chart: string;
  title?: string;
  className?: string;
}) {
  const id = `mermaid-${useId().replace(/[^\w-]/g, '')}`;
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();
  const [showSource, setShowSource] = useState(false);
  const [dark, setDark] = useState(isDark);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? 'dark' : 'neutral',
          securityLevel: 'strict',
          fontFamily: 'inherit',
        });
        const rendered = await mermaid.render(
          `${id}-${dark ? 'd' : 'l'}`,
          chart,
        );
        if (!cancelled) {
          setSvg(rendered.svg);
          setError(undefined);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError((reason as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [chart, dark, id]);

  return (
    <figure className={cn('relative rounded-xl border bg-card p-4', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        {title ? (
          <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </figcaption>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowSource((current) => !current)}
        >
          <Code2 />
          {showSource ? 'Diagram' : 'Mermaid source'}
        </Button>
      </div>
      {showSource ? (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          {chart}
        </pre>
      ) : error ? (
        <p className="text-sm text-rose-600">
          Diagram failed to render: {error}
        </p>
      ) : svg ? (
        <div
          className="flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
          // Mermaid output is generated locally from trusted chart text with securityLevel strict.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="animate-spin" />
        </div>
      )}
    </figure>
  );
}
