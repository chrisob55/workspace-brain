import { ArrowLeft, Braces, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { EvidencePanel } from '../evidence-panel';
import { Button } from '../ui/button';
import { AdrView } from './adr-view';
import { ApiOperationView } from './api-operation-view';
import { codeRefLabel } from './code-ref-link';
import { CodeViewer } from './code-viewer';
import {
  InspectorContext,
  useInspector,
  type InspectorTarget,
} from './inspector-context';
import { JsonViewer } from './json-viewer';
import { SchemaViewer } from './schema-viewer';

function titleOf(target: InspectorTarget): { eyebrow: string; title: string } {
  switch (target.kind) {
    case 'code':
      return { eyebrow: 'Implementation', title: codeRefLabel(target.ref) };
    case 'schema':
      return { eyebrow: 'Schema · OpenAPI', title: target.name };
    case 'json':
      return { eyebrow: 'JSON', title: target.title };
    case 'adr':
      return {
        eyebrow: 'Architecture decision',
        title: `ADR-${String(target.number).padStart(3, '0')}`,
      };
    case 'api':
      return { eyebrow: 'API operation', title: target.operationId };
    case 'evidence':
      return { eyebrow: 'Evidence & provenance', title: target.title };
  }
}

function SchemaLink({ name }: { name: string }) {
  const inspector = useInspector();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => inspector.open({ kind: 'schema', name })}
    >
      <Braces />
      Conforms to {name}
    </Button>
  );
}

function Body({ target }: { target: InspectorTarget }) {
  switch (target.kind) {
    case 'code':
      return <CodeViewer codeRef={target.ref} />;
    case 'schema':
      return <SchemaViewer name={target.name} />;
    case 'json':
      return (
        <div className="space-y-3">
          {target.schema && <SchemaLink name={target.schema} />}
          <JsonViewer value={target.value} expandDepth={2} />
        </div>
      );
    case 'adr':
      return <AdrView number={target.number} />;
    case 'api':
      return <ApiOperationView operationId={target.operationId} />;
    case 'evidence':
      return <EvidencePanel provenance={target.provenance} />;
  }
}

/** A side drawer that every documentation link opens into, with a back stack. */
export function InspectorProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<InspectorTarget[]>([]);
  const open = useCallback(
    (target: InspectorTarget) => setStack((current) => [...current, target]),
    [],
  );
  const close = useCallback(() => setStack([]), []);
  const back = useCallback(
    () => setStack((current) => current.slice(0, -1)),
    [],
  );
  const value = useMemo(() => ({ open }), [open]);
  const current = stack.at(-1);

  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, close]);

  const heading = current && titleOf(current);
  return (
    <InspectorContext.Provider value={value}>
      {children}
      {current &&
        heading &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
              onClick={close}
              aria-hidden
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-label={heading.title}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l bg-background shadow-2xl"
            >
              <header className="flex items-center gap-2 border-b px-4 py-3">
                {stack.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={back}
                    title="Back"
                  >
                    <ArrowLeft />
                  </Button>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    {heading.eyebrow}
                  </p>
                  <h2 className="truncate font-mono text-base font-semibold">
                    {heading.title}
                  </h2>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={close}
                  title="Close (Esc)"
                >
                  <X />
                </Button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <Body key={stack.length} target={current} />
              </div>
            </aside>
          </>,
          document.body,
        )}
    </InspectorContext.Provider>
  );
}
