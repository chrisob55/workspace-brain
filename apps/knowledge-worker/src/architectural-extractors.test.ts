import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createRepositoryId,
  createSourceId,
  type KnowledgeInputEvidence,
  type KnowledgeExtractionContext,
} from '@workspace-brain/domain';
import { processDocument } from '@workspace-brain/processing-core';
import { describe, expect, it } from 'vitest';
import {
  extractKnowledgeCandidates,
  extractKnowledgeReport,
  knowledgeExtractors,
} from './knowledge-extractors.js';
import {
  CandidateBuilder,
  type KnowledgeExtractor,
} from './extractors/framework.js';
import { repositoryExtractor } from './extractors/repositories.js';

const sourceId = createSourceId();
function inputs(
  path: string,
  content: string,
  context?: KnowledgeExtractionContext,
): KnowledgeInputEvidence[] {
  const filename = path.split('/').at(-1) ?? '';
  const processed = processDocument(filename, content);
  const documentId = createDocumentId();
  const versionId = createDocumentVersionId();
  return processed.evidence.map((evidence) => ({
    evidence: {
      ...evidence,
      id: createEvidenceId(),
      documentVersionId: versionId,
    },
    documentVersion: {
      id: versionId,
      documentId,
      contentHash: 'a'.repeat(64),
      hashAlgorithm: 'sha256',
      discoveredAt: '2026-10-08T15:00:00.000Z',
      processorId: processed.processorId,
      processorVersion: processed.processorVersion,
      extractionRuleId: processed.extractionRuleId,
      extractionRuleVersion: processed.extractionRuleVersion,
      evidenceCount: processed.evidence.length,
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
      processorId: processed.processorId,
      processorVersion: processed.processorVersion,
      extractionRuleId: processed.extractionRuleId,
      extractionRuleVersion: processed.extractionRuleVersion,
    },
    ...(context ? { extractionContext: context } : {}),
  }));
}
const document = (path: string) => ({
  id: createDocumentId(),
  path,
  filename: path.split('/').at(-1) ?? '',
  fingerprint: 'b'.repeat(64),
});
const context: KnowledgeExtractionContext = {
  repositories: [
    {
      id: createRepositoryId(),
      path: 'root/project',
      fingerprint: 'c'.repeat(64),
    },
    {
      id: createRepositoryId(),
      path: 'root/project/nested',
      fingerprint: 'd'.repeat(64),
    },
  ],
  documents: [
    document('root/project/src/entry.ts'),
    document('root/project/nested/entry.ts'),
    document('root/project/docs/architecture.md'),
    document('root/project/README.md'),
    document('root/project/docs/ADR-001-first.md'),
    document('root/project/docs/ADR-002-second.md'),
  ],
};

describe('architectural extractor registry', () => {
  it('produces valid source locators when Markdown skips heading levels', () => {
    const result = processDocument(
      'README.md',
      '# Root\n#### Detail\n\nSome text.\n',
    );
    const paragraph = result.evidence.find((item) => item.kind === 'paragraph');
    expect(paragraph?.locator).toEqual({
      kind: 'markdown-lines',
      lineStart: 4,
      lineEnd: 4,
      headingPath: ['Root', 'Detail'],
    });
  });
  it('adds a plugin independently and produces identical candidates with registry order reversed', () => {
    const plugin: KnowledgeExtractor = {
      id: 'play-routes',
      version: 1,
      supports: () => true,
      extract(evidence) {
        const output = new CandidateBuilder(this.id, this.version);
        const first = evidence[0];
        if (!first) throw new Error('Fixture evidence missing');
        output.entity('api', 'Play API', first.document.path, [first]);
        return output.result();
      },
    };
    const evidence = inputs('root/project/README.md', '# Project', context);
    const registry = [...knowledgeExtractors, plugin];
    expect(extractKnowledgeCandidates(evidence, registry)).toEqual(
      extractKnowledgeCandidates(evidence, [...registry].reverse()),
    );
    expect(
      extractKnowledgeCandidates(evidence, registry).entities.some(
        (entity) => entity.name === 'Play API',
      ),
    ).toBe(true);
    expect(() =>
      extractKnowledgeCandidates(evidence, [plugin, plugin]),
    ).toThrow('Duplicate');
  });

  it('does not assign ownership to another plugin package with the same name', () => {
    const evidence = inputs(
      'root/project/package.json',
      '{"name":"owner"}',
      context,
    );
    const declared = extractKnowledgeCandidates(evidence).entities.filter(
      (entity) => entity.type === 'package',
    );
    const first = evidence[0];
    if (!first) throw new Error('Fixture evidence missing');
    const other = new CandidateBuilder('other-package-plugin', 1);
    const unrelated = other.entity(
      'package',
      'owner',
      'root/other/package.json',
      [first],
    );
    const result = repositoryExtractor.extract(evidence, {
      entities: [...other.result().entities, ...declared],
      relationships: [],
    });
    expect(result.relationships).toHaveLength(1);
    expect(
      result.relationships.some((item) => item.targetEntityKey === unrelated),
    ).toBe(false);
  });

  it('rejects conflicting relationship metadata rather than overwriting another plugin', () => {
    const first = inputs('root/project/README.md', '# Project')[0];
    if (!first) throw new Error('Fixture evidence missing');
    const output = new CandidateBuilder('fixture', 1);
    const source = output.entity('document', 'README', first.document.path, [
      first,
    ]);
    const target = output.entity('document', 'Other', 'root/project/other.md', [
      first,
    ]);
    output.relationship('REFERENCES', source, target, [first]);
    const relationship = output.result().relationships[0];
    if (!relationship) throw new Error('Fixture relationship missing');
    expect(() =>
      output.merge({
        entities: [],
        relationships: [{ ...relationship, targetEntityKey: source }],
      }),
    ).toThrow('Conflicting relationship candidate');
  });

  it('uses the nearest discovered Git boundary and only explicit manifest ownership', () => {
    const result = extractKnowledgeReport(
      inputs(
        'root/project/package.json',
        JSON.stringify({
          name: 'owner',
          files: ['src/entry.ts', 'nested/entry.ts', 'src/*.ts'],
        }),
        context,
      ),
    );
    expect(
      result.candidates.entities
        .filter((entity) => entity.type === 'repository')
        .map((entity) => entity.identityScope),
    ).toEqual(['root/project']);
    expect(
      result.candidates.relationships.filter(
        (item) => item.type === 'CONTAINS',
      ),
    ).toHaveLength(2);
    expect(
      result.diagnostics.filter((item) => item.disposition === 'rejected'),
    ).toHaveLength(2);
    const nested = extractKnowledgeCandidates(
      inputs(
        'root/project/nested/entry.ts',
        'export const child = 1;',
        context,
      ),
    );
    expect(
      nested.entities.find((entity) => entity.type === 'repository')
        ?.identityScope,
    ).toBe('root/project/nested');
    expect(
      nested.entities.some(
        (entity) =>
          entity.type === 'repository' &&
          entity.identityScope === 'root/project',
      ),
    ).toBe(false);
    const unowned = extractKnowledgeCandidates(
      inputs('root/no-git/entry.ts', 'export const value = 1;', context),
    );
    expect(
      unowned.entities.some((entity) => entity.type === 'repository'),
    ).toBe(false);
    const configuration = extractKnowledgeCandidates(
      inputs('root/project/config.json', '{"name":"not-a-package"}', context),
    );
    expect(configuration.entities.map((entity) => entity.type)).toEqual([
      'repository',
    ]);
    expect(configuration.relationships).toEqual([]);
  });

  it.each(['json', 'yaml'])(
    'recognises OpenAPI 3 with exact path, method, operationId and version evidence (%s)',
    (format) => {
      const spec = {
        openapi: '3.1.0',
        info: { title: 'Fixture API', version: '1.2' },
        paths: {
          '/publication/export': { get: { operationId: 'exportPublication' } },
        },
      };
      const content =
        format === 'json'
          ? JSON.stringify(spec)
          : 'openapi: 3.1.0\ninfo:\n  title: Fixture API\n  version: "1.2"\npaths:\n  /publication/export:\n    get:\n      operationId: exportPublication\n';
      const result = extractKnowledgeCandidates(
        inputs(
          `root/project/api.${format === 'yaml' ? 'yaml' : 'json'}`,
          content,
        ),
      );
      expect(result.entities.map((entity) => entity.type).sort()).toEqual([
        'api',
        'operation',
      ]);
      expect(result.relationships[0]?.type).toBe('EXPOSES');
      expect(
        result.relationships[0]?.provenance.find((item) => item.facts)?.facts,
      ).toEqual({
        operationId: 'exportPublication',
        path: '/publication/export',
        method: 'GET',
        version: '1.2',
      });
    },
  );

  it('rejects unsupported OpenAPI, missing fields, non-string titles and duplicate operation IDs', () => {
    const spec = {
      openapi: '3.0.3',
      info: { title: 'API', version: '1' },
      paths: {
        '/one': { get: { operationId: 'same' } },
        '/two': { post: { operationId: 'same' } },
      },
    };
    const result = extractKnowledgeReport(
      inputs('root/project/openapi.json', JSON.stringify(spec)),
    );
    expect(result.candidates.relationships).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    for (const invalid of [
      { ...spec, openapi: '2.0' },
      { ...spec, info: { title: 'API' } },
      { ...spec, info: { title: true, version: '1' } },
      { info: spec.info, paths: spec.paths },
    ])
      expect(
        extractKnowledgeCandidates(
          inputs('root/project/openapi.json', JSON.stringify(invalid)),
        ).entities,
      ).toEqual([]);
    expect(
      extractKnowledgeCandidates(
        inputs(
          'root/project/package.json',
          '{"name":true,"dependencies":{"x":false}}',
        ),
      ).entities,
    ).toEqual([]);
  });

  it('resolves Markdown links, not prose, comments, images, inline code or fenced examples', () => {
    const content = [
      '# README',
      '[Architecture](docs/architecture.md#overview)',
      '[Reference][ref]',
      '',
      '[ref]: docs/ADR-001-first.md',
      '',
      'ADR-002 is mentioned, but is not linked.',
      '`[inline](docs/ADR-002-second.md)`',
      '![image](docs/ADR-002-second.md)',
      '<!-- [comment](docs/ADR-002-second.md) -->',
      '```markdown',
      '[example](docs/ADR-002-second.md)',
      '```',
      '[missing](missing.md)',
      '[escape](../../outside.md)',
      '[remote](https://example.com/doc.md)',
    ].join('\n');
    const result = extractKnowledgeReport(
      inputs('root/project/README.md', content, context),
    );
    expect(
      result.candidates.relationships.filter(
        (item) => item.type === 'REFERENCES',
      ),
    ).toHaveLength(2);
    expect(
      result.candidates.relationships
        .map((item) => item.provenance[0]?.resolvedDocument?.filename)
        .sort(),
    ).toEqual(['ADR-001-first.md', 'architecture.md']);
    expect(
      result.diagnostics.filter((item) => item.disposition === 'unresolved'),
    ).toHaveLength(3);
  });

  it('retains ADR metadata and explicit references without inferring from prose', () => {
    const content =
      '# ADR-002: Second\n\n- **Status:** Accepted\n- **Supersedes:** ADR-001\n\nADR-999 is only prose.\n';
    const result = extractKnowledgeCandidates(
      inputs('root/project/docs/ADR-002-second.md', content, context),
    );
    expect(
      result.entities
        .find((entity) => entity.name === 'ADR-002')
        ?.provenance.some((item) => item.facts?.status === 'Accepted'),
    ).toBe(true);
    expect(result.relationships).toHaveLength(1);
    expect(result.relationships[0]?.provenance[0]?.facts?.referenceKind).toBe(
      'supersedes',
    );
    const explicit = extractKnowledgeCandidates(
      inputs(
        'root/project/docs/decision.md',
        '# Decision\n\n- **ADR-ID:** ADR-003\n- **Status:** Proposed\n',
        context,
      ),
    );
    const decisions = explicit.entities.filter(
      (entity) => entity.type === 'architectural-decision',
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      type: 'architectural-decision',
      name: 'ADR-003',
    });
    const commented = extractKnowledgeCandidates(
      inputs(
        'root/project/docs/ADR-002-second.md',
        '# ADR-002: Second\n\n<!--\n- **References:** ADR-001\n-->\n\n```\n- **References:** ADR-001\n```\n',
        context,
      ),
    );
    expect(commented.relationships).toEqual([]);
  });
});
