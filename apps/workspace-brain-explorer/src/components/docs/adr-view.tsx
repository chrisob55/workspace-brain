import { adr } from '@/lib/implementation-metadata';

import { Badge } from '../ui/badge';
import { CodeViewer } from './code-viewer';

export function AdrView({ number }: { number: number }) {
  const record = adr(number);
  if (!record)
    return (
      <p className="text-sm text-amber-600">ADR {number} was not found.</p>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{record.id}</Badge>
        {record.status && <Badge variant="secondary">{record.status}</Badge>}
      </div>
      <h3 className="text-lg font-semibold">{record.title}</h3>
      {record.decision && (
        <blockquote className="border-l-4 border-primary/50 pl-3 text-sm">
          {record.decision}
        </blockquote>
      )}
      <CodeViewer
        codeRef={{
          path: record.path,
          symbol: record.decisionHeading,
          kind: 'doc',
          label: record.id,
        }}
      />
    </div>
  );
}
