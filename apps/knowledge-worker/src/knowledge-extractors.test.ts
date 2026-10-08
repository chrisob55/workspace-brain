import {
  createKnowledgeEntityKey,
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createSourceId,
} from '@workspace-brain/domain';
import { processDocument } from '@workspace-brain/processing-core';
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

const moduleDocumentPath = 'root/apps/service/src/entry.ts';

function processedTypeScriptInputs(
  content: string,
  context = {
    documentId: createDocumentId(),
    documentVersionId: createDocumentVersionId(),
    sourceId: createSourceId(),
  },
) {
  const processed = processDocument('entry.ts', content);
  return processed.evidence.map((candidate) => {
    const base = evidenceInput(
      'entry.ts',
      moduleDocumentPath,
      candidate.key,
      candidate.excerpt,
      context,
    );
    return {
      ...base,
      evidence: {
        ...base.evidence,
        kind: candidate.kind,
        truncated: candidate.truncated,
        locator: candidate.locator,
      },
    };
  });
}

function dependencyTargets(content: string): string[] {
  const candidates = extractKnowledgeCandidates(
    processedTypeScriptInputs(content),
  );
  const names = new Map(
    candidates.entities.map(({ key, name }) => [key, name]),
  );
  return candidates.relationships
    .map(({ targetEntityKey }) => names.get(targetEntityKey) ?? '')
    .sort();
}

describe('TypeScript module dependency extraction', () => {
  const singleLineStatements = [
    "import { single } from './single.js';",
    "import { multiOne, multiTwo } from '@workspace-brain/domain';",
    "import type { OnlyType } from './types.js';",
    "import type { FirstType, SecondType } from '@workspace-brain/catalogue';",
    "import defaultThing from 'default-package';",
    "import * as namespaceThing from 'namespace-package';",
    "import './side-effect.js';",
    "import mixedDefault, { mixedNamed } from 'mixed-package';",
    "export { reExported } from './re-export.js';",
    "export type { ReExportedType } from './re-export-types.js';",
    "export { first, second } from '../multi-re-export.js';",
    "export * from './star.js';",
    "import { createHash } from 'node:crypto';",
    "import { z } from 'zod';",
  ].join('\n');

  const multiLineStatements = [
    "import { single } from './single.js';",
    'import {',
    '  multiOne,',
    '  multiTwo,',
    "} from '@workspace-brain/domain';",
    "import type { OnlyType } from './types.js';",
    'import type {',
    '  FirstType,',
    '  SecondType,',
    "} from '@workspace-brain/catalogue';",
    "import defaultThing from 'default-package';",
    'import * as namespaceThing from',
    "  'namespace-package';",
    "import './side-effect.js';",
    'import mixedDefault, {',
    '  mixedNamed,',
    "} from 'mixed-package';",
    "export { reExported } from './re-export.js';",
    'export type {',
    '  ReExportedType,',
    "} from './re-export-types.js';",
    'export {',
    '  first,',
    '  second,',
    "} from '../multi-re-export.js';",
    "export * from './star.js';",
    "import { createHash } from 'node:crypto';",
    'import {',
    '  z,',
    "} from 'zod';",
  ].join('\n');

  const expectedTargets = [
    '@workspace-brain/catalogue',
    '@workspace-brain/domain',
    'apps/service/multi-re-export',
    'apps/service/src/re-export',
    'apps/service/src/re-export-types',
    'apps/service/src/side-effect',
    'apps/service/src/single',
    'apps/service/src/star',
    'apps/service/src/types',
    'default-package',
    'mixed-package',
    'namespace-package',
    'node:crypto',
    'zod',
  ];

  it('links every supported single-line import and re-export form', () => {
    expect(dependencyTargets(singleLineStatements)).toEqual(expectedTargets);
  });

  it('links multi-line imports and re-exports identically to single-line equivalents', () => {
    expect(dependencyTargets(multiLineStatements)).toEqual(expectedTargets);
  });

  it('records the complete statement and its starting line as relationship provenance', () => {
    const candidates = extractKnowledgeCandidates(
      processedTypeScriptInputs(multiLineStatements),
    );
    const domain = candidates.entities.find(
      ({ name }) => name === '@workspace-brain/domain',
    );
    const relationship = candidates.relationships.find(
      ({ targetEntityKey }) => targetEntityKey === domain?.key,
    );

    expect(relationship).toMatchObject({
      type: 'DEPENDS_ON',
      sourceEntityKey: createKnowledgeEntityKey(
        'module',
        relationship?.provenance[0]?.sourceId ?? '',
        'root/apps/service/src/entry',
        'apps/service/src/entry',
      ),
      confidence: 1,
      lifecycleStatus: 'related',
    });
    expect(relationship?.provenance).toEqual([
      expect.objectContaining({
        documentPath: moduleDocumentPath,
        locator: { kind: 'text-lines', lineStart: 2, lineEnd: 5 },
      }),
    ]);
    const inputs = processedTypeScriptInputs(multiLineStatements);
    expect(
      inputs.find(
        ({ evidence }) =>
          evidence.locator.kind === 'text-lines' &&
          evidence.locator.lineStart === 2,
      )?.evidence.excerpt,
    ).toBe(
      "import {\n  multiOne,\n  multiTwo,\n} from '@workspace-brain/domain';",
    );
  });

  it('does not link modules named only in comments, strings or unrelated uses of from', () => {
    const source = [
      "// import { commented } from 'commented-package';",
      '/*',
      "import { blockCommented } from 'block-commented-package';",
      '*/',
      'const quoted = "import { quoted } from \'quoted-package\';";',
      'const template = `',
      "import { templated } from 'templated-package';",
      "export { templatedExport } from 'templated-export-package';",
      '`;',
      "export const label = 'data from \\'label-package\\'';",
      'function describeSource(from: string) { return from; }',
      "const from = 'not-a-module';",
      "import { real } from 'real-package'; // from 'trailing-comment-package'",
      'import {',
      "  // from 'inner-comment-package'",
      '  inner,',
      "} from 'inner-real-package';",
    ].join('\n');

    expect(dependencyTargets(source)).toEqual([
      'inner-real-package',
      'real-package',
    ]);
  });

  it('keeps extracting dependencies after malformed or unsupported syntax', () => {
    const source = [
      "import { ok } from 'ok-package';",
      'export const broken = ;',
      'function (',
      "import legacy = require('legacy-package');",
      "const lazy = import('lazy-package');",
      "import { after } from 'after-package';",
    ].join('\n');

    const targets = dependencyTargets(source);

    expect(targets).toEqual(
      expect.arrayContaining(['after-package', 'ok-package']),
    );
    expect(targets).not.toContain('legacy-package');
    expect(targets).not.toContain('lazy-package');
  });

  it('links each statement when several imports share a line', () => {
    expect(
      dependencyTargets(
        "import { a } from './a.js'; import { b } from './b.js';",
      ),
    ).toEqual(['apps/service/src/a', 'apps/service/src/b']);
  });

  it('links oversized imports and re-exports whose specifier lies beyond the excerpt limit', () => {
    const names = Array.from({ length: 400 }, (_, index) => `  name${index},`);
    const source = [
      'import {',
      ...names,
      "} from 'oversized-import';",
      'export {',
      ...names,
      "} from './oversized-export.js';",
    ].join('\n');

    expect(dependencyTargets(source)).toEqual([
      'apps/service/src/oversized-export',
      'oversized-import',
    ]);
  });

  it('links every same-line module statement when trivia between them is oversized', () => {
    const comment = `/* ${'x'.repeat(5_000)} */`;
    const source = `import { a } from 'first-package'; ${comment} export { b } from 'second-package';`;

    expect(dependencyTargets(source)).toEqual([
      'first-package',
      'second-package',
    ]);
  });

  it('links every module statement on a line whose combined length exceeds the excerpt limit', () => {
    const imports = Array.from(
      { length: 400 },
      (_, index) => `import './side-effect-${index}.js';`,
    );

    const targets = dependencyTargets(imports.join(' '));

    expect(targets).toHaveLength(400);
    expect(targets).toContain('apps/service/src/side-effect-399');
  });

  it('links oversized module statements whose length comes from comments', () => {
    const comment = `/* ${'x'.repeat(5_000)} */`;
    const source = [
      `import { only ${comment} } from 'commented-import';`,
      `import type ${comment} { Only } from 'commented-type-import';`,
      `import ${comment} 'commented-side-effect';`,
      `export * ${comment} from './commented-star.js';`,
      `export { only } ${comment} from './commented-export.js';`,
    ].join('\n');

    expect(dependencyTargets(source)).toEqual([
      'apps/service/src/commented-export',
      'apps/service/src/commented-star',
      'commented-import',
      'commented-side-effect',
      'commented-type-import',
    ]);
  });
});
