import {
  Braces,
  FileJson2,
  Landmark,
  Link2,
  Plug,
  ScrollText,
} from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { CodeRefLink } from '@/components/docs/code-ref-link';
import {
  useInspector,
  type InspectorTarget,
} from '@/components/docs/inspector-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CodeRef, CodeRefKind } from '@/lib/how-it-works/concepts';
import {
  deepLinkHash,
  sectionElementId,
  SECTIONS,
} from '@/lib/how-it-works/sections';
import { adr } from '@/lib/implementation-metadata';
import { apiOperation } from '@/lib/openapi-contract';
import { cn } from '@/lib/utils';

export interface DeepLinkState {
  section?: string;
  item?: string;
  select: (section: string, item?: string) => void;
}

export const DeepLinkContext = createContext<DeepLinkState>({
  select: () => undefined,
});

/**
 * A section's selected item. It follows the URL whenever the URL targets this
 * section, and otherwise keeps its own selection so that navigating elsewhere
 * on the page does not reset it.
 */
export function useDeepLink(section: string) {
  const state = useContext(DeepLinkContext);
  const [item, setItem] = useState(() =>
    state.section === section ? state.item : undefined,
  );
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.section === section && state.item !== undefined)
      setItem(state.item);
  }
  return {
    item,
    select: (next?: string) => {
      setItem(next);
      state.select(section, next);
    },
  };
}

export function DocSection({
  id,
  lead,
  children,
}: {
  id: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  const index = SECTIONS.findIndex((section) => section.id === id);
  const meta = SECTIONS[index]!;
  return (
    <section
      id={sectionElementId(id)}
      data-section={id}
      className="scroll-mt-6 border-t pt-10 first:border-t-0 first:pt-0"
    >
      <div className="mb-6">
        <a
          href={deepLinkHash(id)}
          className="group inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"
        >
          Section {index + 1} · {meta.question}
          <Link2 className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        </a>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
          {meta.title}
        </h2>
        {lead && <p className="mt-2 max-w-3xl text-muted-foreground">{lead}</p>}
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'implemented' || status === 'published' || status === 'modelled'
      ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
      : status === 'planned' ||
          status === 'illustrative' ||
          status === 'not-modelled'
        ? 'border-slate-400/50 text-muted-foreground'
        : 'border-amber-500/40 text-amber-700 dark:text-amber-400';
  return (
    <Badge variant="outline" className={cn('capitalize', tone)}>
      {status.replace('-', ' ')}
    </Badge>
  );
}

export function InspectButton({
  target,
  icon,
  children,
  className,
}: {
  target: InspectorTarget;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const inspector = useInspector();
  return (
    <Button
      size="sm"
      variant="outline"
      className={className}
      onClick={() => inspector.open(target)}
    >
      {icon}
      {children}
    </Button>
  );
}

export const JsonButton = ({
  title,
  value,
  label = 'View JSON',
}: {
  title: string;
  value: unknown;
  label?: string;
}) => (
  <InspectButton target={{ kind: 'json', title, value }} icon={<FileJson2 />}>
    {label}
  </InspectButton>
);

export const SchemaButton = ({
  name,
  label,
}: {
  name: string;
  label?: string;
}) => (
  <InspectButton target={{ kind: 'schema', name }} icon={<Braces />}>
    {label ?? name}
  </InspectButton>
);

const GROUPS: { title: string; kinds: CodeRefKind[] }[] = [
  { title: 'Classes', kinds: ['class'] },
  { title: 'Functions', kinds: ['function', 'method', 'component'] },
  { title: 'Types & constants', kinds: ['type', 'constant'] },
  { title: 'Tables', kinds: ['table'] },
  { title: 'Files', kinds: ['file', 'config', 'script', 'doc'] },
  { title: 'Tests', kinds: ['test'] },
];

/** "Implemented by" for any concept: code grouped by kind, plus schemas, ADRs and APIs. */
export function ImplementedBy({
  refs,
  schemas = [],
  adrs = [],
  apis = [],
  className,
}: {
  refs: CodeRef[];
  schemas?: string[];
  adrs?: number[];
  apis?: string[];
  className?: string;
}) {
  const inspector = useInspector();
  const groups = GROUPS.map((group) => ({
    ...group,
    refs: refs.filter((ref) => group.kinds.includes(ref.kind)),
  })).filter((group) => group.refs.length > 0);
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0',
        className,
      )}
    >
      {groups.map((group) => (
        <div key={group.title}>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.title}
          </h4>
          <div className="space-y-0.5">
            {group.refs.map((ref) => (
              <CodeRefLink
                key={`${ref.path}#${ref.symbol ?? ''}`}
                codeRef={ref}
              />
            ))}
          </div>
        </div>
      ))}
      {schemas.length > 0 && (
        <LinkGroup title="Schemas">
          {schemas.map((name) => (
            <LinkRow
              key={name}
              icon={<Braces />}
              onClick={() => inspector.open({ kind: 'schema', name })}
            >
              {name}
            </LinkRow>
          ))}
        </LinkGroup>
      )}
      {apis.length > 0 && (
        <LinkGroup title="APIs">
          {apis.map((operationId) => {
            const operation = apiOperation(operationId);
            return (
              <LinkRow
                key={operationId}
                icon={<Plug />}
                detail={
                  operation
                    ? `${operation.method} ${operation.path}`
                    : 'missing from contract'
                }
                onClick={() => inspector.open({ kind: 'api', operationId })}
              >
                {operationId}
              </LinkRow>
            );
          })}
        </LinkGroup>
      )}
      {adrs.length > 0 && (
        <LinkGroup title="ADRs">
          {adrs.map((number) => {
            const record = adr(number);
            return (
              <LinkRow
                key={number}
                icon={<Landmark />}
                detail={record?.title}
                onClick={() => inspector.open({ kind: 'adr', number })}
              >
                {record?.id ?? `ADR-${number}`}
              </LinkRow>
            );
          })}
        </LinkGroup>
      )}
    </div>
  );
}

function LinkGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function LinkRow({
  icon,
  detail,
  onClick,
  children,
}: {
  icon: ReactNode;
  detail?: string | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-primary"
    >
      {icon}
      <span className="min-w-0">
        <span className="block truncate font-mono text-[13px] font-medium group-hover:text-primary">
          {children}
        </span>
        {detail && (
          <span className="block truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </button>
  );
}

export function Callout({
  children,
  icon = <ScrollText />,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      <div>{children}</div>
    </div>
  );
}
