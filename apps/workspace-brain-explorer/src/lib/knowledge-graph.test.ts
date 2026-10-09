import { describe, expect, it } from 'vitest';

import {
  buildKnowledgeGraph,
  describeLocator,
  displayPath,
  findFact,
  neighbours,
  relationshipBreakdown,
  repositoryOfPath,
  searchEntities,
} from './knowledge-graph';
import { packContributions, packOf } from './parser-packs';
import type {
  EvidenceLocator,
  ProvenanceItem,
  PublicationPackage,
} from './types';

function provenance(
  documentPath: string,
  extractorId: string,
  processorId: string,
  locator: EvidenceLocator = {
    kind: 'markdown-lines',
    lineStart: 1,
    lineEnd: 1,
  },
): ProvenanceItem {
  return {
    contentFingerprint: 'sha256:abc',
    documentId: `doc:${documentPath}`,
    documentPath,
    documentVersionId: 'ver',
    evidenceId: `ev:${documentPath}:${extractorId}`,
    extractionRuleId: extractorId,
    extractionRuleVersion: 1,
    knowledgeExtractorId: extractorId,
    knowledgeExtractorVersion: 1,
    locator,
    processorId,
    processorVersion: 1,
    sourceId: 'src',
  };
}

function entity(
  id: string,
  name: string,
  type: string,
  prov: ProvenanceItem[],
) {
  return {
    entity: {
      id,
      knowledgeModelId: 'km',
      name,
      type,
      lifecycleStatus: 'observed',
      provenance: prov,
      sourceEvidenceIds: prov.map((p) => p.evidenceId),
      createdAt: '',
      updatedAt: '',
    },
  };
}

const readme = provenance(
  'ROOT/workspace-brain/README.md',
  'markdown-references',
  'markdown',
  {
    kind: 'markdown-lines',
    lineStart: 8,
    lineEnd: 27,
  },
);
const adr = provenance(
  'ROOT/workspace-brain/docs/adr/ADR-026.md',
  'architectural-decisions',
  'markdown',
);
const openapi = provenance(
  'ROOT/workspace-brain/openapi.json',
  'openapi-operations',
  'json',
  {
    kind: 'json-pointer',
    pointer: '/paths/~1api/get/operationId',
  },
);

const pkg = {
  format: 'test',
  formatVersion: 1,
  metadata: {
    publicationId: 'pub',
    knowledgeModelId: 'km',
    publicationVersion: 7,
    schemaVersion: 2,
    contentHash: 'hash',
    createdAt: '',
    entityCount: 4,
    relationshipCount: 2,
  },
  entities: [
    entity('e1', 'workspace-brain/README.md', 'document', [readme]),
    entity('e2', 'ADR-026', 'architectural-decision', [adr]),
    entity('e3', 'Workspace Brain API', 'api', [openapi]),
    entity('e4', 'listDocuments', 'operation', [openapi]),
  ],
  relationships: [
    {
      relationship: {
        id: 'r1',
        knowledgeModelId: 'km',
        type: 'REFERENCES',
        sourceEntityId: 'e1',
        targetEntityId: 'e2',
        confidence: 1,
        lifecycleStatus: 'observed',
        provenance: [readme],
        sourceEvidenceIds: [readme.evidenceId],
        createdAt: '',
        updatedAt: '',
      },
    },
    {
      relationship: {
        id: 'r2',
        knowledgeModelId: 'km',
        type: 'EXPOSES',
        sourceEntityId: 'e3',
        targetEntityId: 'e4',
        confidence: 1,
        lifecycleStatus: 'observed',
        provenance: [openapi],
        sourceEvidenceIds: [openapi.evidenceId],
        createdAt: '',
        updatedAt: '',
      },
    },
  ],
} as unknown as PublicationPackage;

const graph = buildKnowledgeGraph(pkg);

describe('knowledge graph', () => {
  it('indexes publication metadata, entities and relationships', () => {
    expect(graph.meta.version).toBe(7);
    expect(graph.entityById.get('e2')?.name).toBe('ADR-026');
    expect(neighbours(graph, 'e1').map((r) => r.id)).toEqual(['r1']);
    expect(neighbours(graph, 'e3', new Set(['REFERENCES']))).toEqual([]);
  });

  it('strips the opaque source root from document paths', () => {
    expect(displayPath('ROOT/workspace-brain/README.md')).toBe(
      'workspace-brain/README.md',
    );
    expect(repositoryOfPath('ROOT/ai-os/docs/x.md')).toBe('ai-os');
  });

  it('describes evidence locators', () => {
    expect(describeLocator(readme)).toBe('lines 8–27');
    expect(describeLocator(openapi)).toBe(
      'JSON pointer /paths/~1api/get/operationId',
    );
  });

  it('breaks relationships down by type', () => {
    expect(relationshipBreakdown(graph)).toEqual({
      DEPENDS_ON: 0,
      CONTAINS: 0,
      EXPOSES: 1,
      REFERENCES: 1,
    });
  });

  it('finds facts by name and supporting evidence', () => {
    expect(
      findFact(graph, 'workspace-brain/README.md', 'REFERENCES', 'ADR-026')
        ?.relationship.id,
    ).toBe('r1');
    expect(
      findFact(
        graph,
        'workspace-brain/README.md',
        'REFERENCES',
        'ADR-026',
        'other.md',
      ),
    ).toBeUndefined();
  });

  it('ranks exact search matches first', () => {
    expect(searchEntities(graph, 'adr-026').map((e) => e.id)).toEqual(['e2']);
    expect(
      searchEntities(graph, '', new Set(['operation'])).map((e) => e.id),
    ).toEqual(['e4']);
  });
});

describe('parser packs', () => {
  it('maps extractors and legacy JSON pointers to packs', () => {
    expect(packOf(readme)).toBe('markdown');
    expect(packOf(adr)).toBe('adr');
    expect(packOf(openapi)).toBe('openapi');
    const legacy = {
      ...openapi,
      knowledgeExtractorId: undefined,
      extractionRuleId: 'deterministic-knowledge-extractors',
      locator: { kind: 'json-pointer', pointer: '/dependencies/react' },
    } as ProvenanceItem;
    expect(packOf(legacy)).toBe('typescript');
  });

  it('counts the facts each pack supports', () => {
    const byPack = Object.fromEntries(
      packContributions(graph).map((c) => [c.pack.id, c]),
    );
    expect(byPack.openapi).toMatchObject({
      entities: 2,
      relationships: 1,
      evidence: 1,
    });
    expect(byPack.markdown).toMatchObject({ entities: 1, relationships: 1 });
    expect(byPack.adr?.extractorIds).toEqual(['architectural-decisions']);
  });
});
