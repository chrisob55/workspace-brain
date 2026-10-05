import {
  createKnowledgeEntityKey,
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createSourceId,
} from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';

import { extractKnowledgeCandidates } from './knowledge-extractors.js';

function evidenceInput(
  filename: string,
  path: string,
  key: string,
  excerpt: string,
  context = {
    documentId: createDocumentId(),
    documentVersionId: createDocumentVersionId(),
    sourceId: createSourceId(),
  },
) {
  const { documentId, documentVersionId, sourceId } = context;
  const evidenceId = createEvidenceId();
  return {
    evidence: {
      id: evidenceId,
      documentVersionId,
      key,
      kind: 'structured-value' as const,
      excerpt,
      truncated: false,
      locator: key.startsWith('json:')
        ? ({
            kind: 'json-pointer',
            pointer: key.slice(key.indexOf(':') + 1),
          } as const)
        : key.startsWith('yaml:')
          ? ({ kind: 'yaml-lines', lineStart: 1, lineEnd: 1 } as const)
          : ({
              kind: 'text-lines',
              lineStart: 1,
              lineEnd: 1,
            } as const),
    },
    documentVersion: {
      id: documentVersionId,
      documentId,
      contentHash: 'a'.repeat(64),
      hashAlgorithm: 'sha256' as const,
      discoveredAt: '2026-10-05T08:00:00.000Z',
      processorId: 'json',
      processorVersion: 1,
      extractionRuleId: 'json-scalar-values',
      extractionRuleVersion: 1,
      evidenceCount: 1,
    },
    document: {
      id: documentId,
      sourceId,
      path,
      filename,
      fingerprint: 'a'.repeat(64),
    },
    provenance: {
      documentPath: path,
      contentFingerprint: 'a'.repeat(64),
      processorId: 'json',
      processorVersion: 1,
      extractionRuleId: 'json-scalar-values',
      extractionRuleVersion: 1,
    },
  };
}

describe('deterministic knowledge extractors', () => {
  it('extracts package entities and evidence-backed dependency relationships', () => {
    const context = {
      documentId: createDocumentId(),
      documentVersionId: createDocumentVersionId(),
      sourceId: createSourceId(),
    };
    const owner = evidenceInput(
      'package.json',
      'root/service/package.json',
      'json:/name',
      '@workspace/service',
      context,
    );
    const dependency = evidenceInput(
      'package.json',
      'root/service/package.json',
      'json:/dependencies/lodash',
      '^4.0.0',
      context,
    );

    const candidates = extractKnowledgeCandidates([owner, dependency]);

    expect(candidates.entities.map(({ type, name }) => [type, name])).toEqual([
      ['package', '@workspace/service'],
      ['package', 'lodash'],
    ]);
    expect(candidates.relationships).toMatchObject([
      {
        type: 'DEPENDS_ON',
        sourceEntityKey: createKnowledgeEntityKey(
          'package',
          context.sourceId,
          'root/service/package.json',
          '@workspace/service',
        ),
        targetEntityKey: createKnowledgeEntityKey(
          'package',
          context.sourceId,
          'root/service/package.json',
          'lodash',
        ),
        confidence: 1,
        lifecycleStatus: 'related',
        sourceEvidenceIds: [dependency.evidence.id],
      },
    ]);
    expect(candidates.entities[0]?.provenance[0]).toMatchObject({
      evidenceId: owner.evidence.id,
      documentVersionId: owner.documentVersion.id,
      knowledgeExtractorId: 'deterministic-knowledge-extractors',
      knowledgeExtractorVersion: 1,
      locator: owner.evidence.locator,
    });
  });

  it('extracts container and API entities from deterministic source evidence', () => {
    const dockerfile = evidenceInput(
      'Dockerfile',
      'root/service/Dockerfile',
      'dockerfile:1:from',
      'FROM node:22-alpine AS base',
    );
    const openApi = evidenceInput(
      'openapi.yaml',
      'root/service/openapi.yaml',
      'yaml:/info/title',
      'Service API',
    );

    expect(extractKnowledgeCandidates([dockerfile]).entities).toMatchObject([
      { type: 'container', name: 'node:22-alpine' },
    ]);
    expect(extractKnowledgeCandidates([openApi]).entities).toMatchObject([
      { type: 'api', name: 'Service API' },
    ]);
  });

  it('links TypeScript module imports using the approved relationship vocabulary', () => {
    const declaration = evidenceInput(
      'service.ts',
      'root/service/src/service.ts',
      'typescript:1:declaration',
      "import { app } from './app.js';",
    );

    const candidates = extractKnowledgeCandidates([declaration]);

    expect(candidates.entities.map(({ name }) => name)).toEqual([
      'service/src/app',
      'service/src/service',
    ]);
    expect(candidates.relationships).toMatchObject([
      {
        type: 'DEPENDS_ON',
        sourceEntityKey: createKnowledgeEntityKey(
          'module',
          declaration.document.sourceId,
          'root/service/src/service',
          'service/src/service',
        ),
        targetEntityKey: createKnowledgeEntityKey(
          'module',
          declaration.document.sourceId,
          'root/service/src/app',
          'service/src/app',
        ),
      },
    ]);
  });

  it('projects a complete TypeScript import set after an import is removed', () => {
    const context = {
      documentId: createDocumentId(),
      documentVersionId: createDocumentVersionId(),
      sourceId: createSourceId(),
    };
    const firstVersion = [
      evidenceInput(
        'service.ts',
        'root/service/src/service.ts',
        'typescript:1:import',
        "import './first.js';",
        context,
      ),
      evidenceInput(
        'service.ts',
        'root/service/src/service.ts',
        'typescript:2:import',
        "import './second.js';",
        context,
      ),
    ];
    const first = extractKnowledgeCandidates(firstVersion);
    const modified = evidenceInput(
      'service.ts',
      'root/service/src/service.ts',
      'typescript:1:import',
      "import './second.js';",
      {
        ...context,
        documentVersionId: createDocumentVersionId(),
      },
    );
    const reconciled = extractKnowledgeCandidates([modified]);

    expect(first.relationships).toHaveLength(2);
    expect(reconciled.relationships).toHaveLength(1);
    expect(reconciled.entities.map(({ name }) => name)).toEqual([
      'service/src/second',
      'service/src/service',
    ]);
  });

  it('rejects mixed-document evidence input', () => {
    const first = evidenceInput(
      'package.json',
      'root/service/package.json',
      'json:/name',
      'service',
    );
    const second = evidenceInput(
      'package.json',
      'root/other/package.json',
      'json:/name',
      'other',
    );

    expect(() => extractKnowledgeCandidates([first, second])).toThrow(
      'Knowledge extraction inputs must belong to one document',
    );
  });
});
