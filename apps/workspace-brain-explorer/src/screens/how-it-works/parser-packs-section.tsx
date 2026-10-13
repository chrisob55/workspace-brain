import { FlaskConical, Info } from 'lucide-react';

import { MermaidDiagram } from '@/components/docs/mermaid-diagram';
import { Card, CardContent } from '@/components/ui/card';
import { NEW_PACK_CHECKLIST, PARSER_PACKS } from '@/lib/how-it-works/catalogue';
import { cn } from '@/lib/utils';

import {
  Callout,
  DocSection,
  ImplementedBy,
  StatusBadge,
  useDeepLink,
} from './shared';

function List({
  title,
  items,
  mono,
}: {
  title: string;
  items: string[];
  mono?: boolean;
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li
              key={item}
              className={cn('flex gap-2', mono && 'font-mono text-[13px]')}
            >
              <span className="text-primary">•</span>
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CHECKLIST_DIAGRAM = [
  'flowchart LR',
  ...NEW_PACK_CHECKLIST.map(
    (item, index) => `  s${index}["${index + 1}. ${item.title}"]`,
  ),
  ...NEW_PACK_CHECKLIST.slice(1).map(
    (_, index) => `  s${index} --> s${index + 1}`,
  ),
].join('\n');

export function ParserPacksSection() {
  const { item, select } = useDeepLink('parser-packs');
  const pack =
    PARSER_PACKS.find((entry) => entry.id === item) ?? PARSER_PACKS[0]!;
  return (
    <DocSection
      id="parser-packs"
      lead="Parser packs teach Workspace Brain how a particular organisation structures its software: which files matter, how to read them and what knowledge they imply. The processor and extractor lists below are read from the implementation registries."
    >
      <div role="tablist" className="flex flex-wrap gap-2">
        {PARSER_PACKS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={entry.id === pack.id}
            onClick={() => select(entry.id)}
            className={cn(
              'flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors hover:border-primary/60',
              entry.id === pack.id &&
                'border-primary bg-primary/10 font-medium text-primary',
            )}
          >
            {entry.name}
            <StatusBadge status={entry.status} />
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-5 py-5">
          <div>
            <h3 className="text-xl font-semibold">{pack.name}</h3>
            <p className="mt-1 text-sm">{pack.summary}</p>
          </div>
          <Callout icon={<Info />}>{pack.statusNote}</Callout>
          <div className="grid gap-5 md:grid-cols-2">
            <List title="What it recognises" items={pack.recognises} />
            <List title="Files inspected" items={pack.files} mono />
            <List title="Evidence emitted" items={pack.evidence} mono />
            <List title="Knowledge generated" items={pack.knowledge} mono />
          </div>
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Example rules
            </h4>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Then</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.rules.map((rule) => (
                    <tr
                      key={`${rule.rule}-${rule.effect}`}
                      className="border-t align-top"
                    >
                      <td className="px-3 py-2 font-mono text-[13px]">
                        {rule.rule}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {rule.effect}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="border-t pt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Implemented by
            </h4>
            <ImplementedBy refs={pack.refs} adrs={pack.adrs} />
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <FlaskConical className="size-5 text-primary" />
          What gets added when a new parser pack is created?
        </h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Every pack adds the same five things. Each card links to the code you
          would copy or extend.
        </p>
        <MermaidDiagram chart={CHECKLIST_DIAGRAM} className="mb-4" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {NEW_PACK_CHECKLIST.map((entry, index) => (
            <Card key={entry.id} id={`hiw-pack-${entry.id}`}>
              <CardContent className="space-y-2 py-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Step {index + 1}
                </p>
                <h4 className="font-semibold">{entry.title}</h4>
                <p className="text-sm text-muted-foreground">
                  {entry.description}
                </p>
                <ImplementedBy refs={entry.refs} className="sm:grid-cols-1" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DocSection>
  );
}
