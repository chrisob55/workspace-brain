import {
  FileSearch,
  Fingerprint,
  Layers,
  Loader2,
  ScrollText,
  Workflow,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { useKnowledgeState } from '@/app-context';
import {
  describeLocator,
  displayPath,
  extractorOf,
} from '@/lib/knowledge-graph';
import { useEvidence } from '@/lib/queries';
import type { ProvenanceItem } from '@/lib/types';
import { cn, shortHash } from '@/lib/utils';

export function EvidenceExcerpt({
  item,
  className,
}: {
  item: ProvenanceItem;
  className?: string;
}) {
  const { source } = useKnowledgeState();
  const evidence = useEvidence(item.evidenceId, source === 'live');
  const firstLine =
    item.locator.kind === 'json-pointer' ? undefined : item.locator.lineStart;

  let body: ReactNode;
  if (source !== 'live') {
    body = (
      <span className="text-muted-foreground">
        Evidence excerpts are served by the live API
        (/api/v1/evidence/…/explanation).
      </span>
    );
  } else if (evidence.isPending) {
    body = (
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Fetching evidence…
      </span>
    );
  } else if (evidence.isError) {
    body = (
      <span className="text-muted-foreground">
        This evidence version is no longer retrievable from the catalogue.
      </span>
    );
  } else {
    const lines = evidence.data.evidence.excerpt.split('\n');
    body = (
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              {firstLine !== undefined && (
                <td className="select-none pr-3 text-right align-top text-muted-foreground/60 tabular-nums">
                  {firstLine + i}
                </td>
              )}
              <td className="whitespace-pre-wrap break-words">{line || ' '}</td>
            </tr>
          ))}
          {evidence.data.evidence.truncated && (
            <tr>
              <td colSpan={2} className="pt-1 text-muted-foreground">
                … excerpt truncated
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  return (
    <div
      className={cn(
        'max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed',
        className,
      )}
    >
      {body}
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Layers;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.25rem_7rem_1fr] items-start gap-2 py-1.5 text-sm">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** Explains one fact's supporting evidence; tabs switch between provenance records. */
export function EvidencePanel({
  provenance,
  compact = false,
}: {
  provenance: ProvenanceItem[];
  compact?: boolean;
}) {
  const { graph } = useKnowledgeState();
  const [index, setIndex] = useState(0);
  const item = provenance[Math.min(index, provenance.length - 1)];
  if (!item) {
    return (
      <p className="text-sm text-muted-foreground">No provenance recorded.</p>
    );
  }

  return (
    <div className="space-y-3">
      {provenance.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {provenance.slice(0, 12).map((prov, i) => (
            <button
              key={prov.evidenceId}
              type="button"
              onClick={() => setIndex(i)}
              className={cn(
                'rounded-md border px-2 py-0.5 text-xs transition-colors',
                i === index
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              Evidence {i + 1}
            </button>
          ))}
          {provenance.length > 12 && (
            <span className="px-1 text-xs text-muted-foreground">
              +{provenance.length - 12} more
            </span>
          )}
        </div>
      )}
      <div className="divide-y rounded-lg border bg-card px-3">
        <Row icon={ScrollText} label="Source file">
          <span className="font-mono text-xs">
            {displayPath(item.documentPath)}
          </span>
        </Row>
        <Row icon={FileSearch} label="Source location">
          {describeLocator(item)}
          {item.locator.kind !== 'json-pointer' &&
          item.locator.headingPath?.length ? (
            <span className="text-muted-foreground">
              {' '}
              · {item.locator.headingPath.join(' › ')}
            </span>
          ) : null}
        </Row>
        <Row icon={Workflow} label="Extractor">
          <span className="font-mono text-xs">
            {extractorOf(item)}
            {item.knowledgeExtractorVersion !== undefined &&
              ` v${item.knowledgeExtractorVersion}`}
          </span>
          <span className="block text-xs text-muted-foreground">
            processor {item.processorId} v{item.processorVersion} · rule{' '}
            {item.extractionRuleId} v{item.extractionRuleVersion}
          </span>
        </Row>
        {!compact && (
          <Row icon={Fingerprint} label="Fingerprint">
            <span className="font-mono text-xs">
              sha256:{shortHash(item.contentFingerprint, 20)}…
            </span>
          </Row>
        )}
        <Row icon={Layers} label="Publication">
          v{graph.meta.version}{' '}
          <span className="font-mono text-xs text-muted-foreground">
            {graph.meta.publicationId}
          </span>
        </Row>
      </div>
      <EvidenceExcerpt item={item} />
    </div>
  );
}
