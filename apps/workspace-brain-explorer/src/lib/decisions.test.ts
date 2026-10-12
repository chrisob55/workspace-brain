import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { collectDecisions, decisionTitle, filterDecisions } from './decisions';
import { buildKnowledgeGraph } from './knowledge-graph';
import type {
  KnowledgeEntity,
  ProvenanceItem,
  PublicationPackage,
} from './types';

const snapshot = JSON.parse(
  readFileSync(
    new URL('../../public/snapshot/publication.json', import.meta.url),
    'utf8',
  ),
) as PublicationPackage;
const graph = buildKnowledgeGraph(snapshot);
const decisions = collectDecisions(graph);
const example = decisions.find(
  (decision) =>
    decision.repository === 'workspace-brain' &&
    decision.entity.name === 'ADR-001',
)!;

function entityWithPaths(paths: string[]): KnowledgeEntity {
  const provenance: ProvenanceItem[] = paths.map((documentPath) => ({
    ...example.entity.provenance[0]!,
    documentPath,
    locator: { kind: 'markdown-lines', lineStart: 1, lineEnd: 2 },
  }));
  return { ...example.entity, name: 'ADR-001', provenance };
}

describe('decision browser', () => {
  it('uses the ADR source filename, not an index or reference document', () => {
    expect(example.title).toBe('Workspace brain product boundary');
    expect(
      decisionTitle(entityWithPaths(['root/repo/README.md'])),
    ).toBeUndefined();
    expect(
      decisionTitle(
        entityWithPaths([
          'root/repo/ADR-001.md',
          'root/repo/ADR-001-local-first-ai.md',
        ]),
      ),
    ).toBe('Local first ai');
  });

  it('prefers a recorded source heading when present', () => {
    const entity = entityWithPaths(['root/repo/ADR-001-local-first-ai.md']);
    entity.provenance[0]!.locator = {
      kind: 'markdown-lines',
      lineStart: 1,
      lineEnd: 2,
      headingPath: ['ADR-001: Local-first AI'],
    };
    expect(decisionTitle(entity)).toBe('Local-first AI');
  });

  it('shows all repositories by default and distinguishes duplicate ADR numbers', () => {
    const all = filterDecisions(decisions, '', '');
    expect(all).toHaveLength(decisions.length);
    expect(
      new Set(all.map((decision) => decision.repository)).size,
    ).toBeGreaterThan(1);
    const matches = filterDecisions(decisions, '', 'ADR-001');
    expect(new Set(matches.map((decision) => decision.entity.id)).size).toBe(
      matches.length,
    );
    expect(
      new Set(matches.map((decision) => decision.repository)).size,
    ).toBeGreaterThan(1);
  });

  it('combines repository and case-insensitive number, title and path searches', () => {
    expect(
      filterDecisions(decisions, 'workspace-brain', '  ADR-001 PRODUCT  '),
    ).toEqual([example]);
    expect(
      filterDecisions(decisions, '', 'docs/adr/ADR-001-workspace'),
    ).toEqual([example]);
    expect(
      filterDecisions(decisions, 'AI-OS', 'workspace brain product'),
    ).toEqual([]);
    expect(filterDecisions(decisions, '', 'no-such-decision')).toEqual([]);
    expect(filterDecisions([], '', '')).toEqual([]);
  });

  it('only collects explicit incoming references and retains unreferenced ADRs', () => {
    for (const decision of decisions) {
      expect(decision.referencedBy).toEqual(
        graph.relationships.filter(
          (rel) =>
            rel.type === 'REFERENCES' &&
            rel.targetEntityId === decision.entity.id,
        ),
      );
    }
    expect(decisions.some((decision) => !decision.referencedBy.length)).toBe(
      true,
    );
  });
});
