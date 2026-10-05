import { describe, expect, it } from 'vitest';

import { processingDefinitionRegistry } from '@workspace-brain/domain';

import { documentProcessors, processDocument } from './index.js';

describe('deterministic document processing', () => {
  it('registers processors with explicit supported extensions and process methods', () => {
    expect(
      documentProcessors.map(({ id, supportedExtensions }) => [
        id,
        supportedExtensions,
      ]),
    ).toEqual([
      ['markdown', ['.md', '.markdown']],
      ['yaml', ['.yaml', '.yml']],
      ['json', ['.json']],
      ['plain-text', ['.txt']],
      ['typescript', ['.ts']],
      ['dockerfile', ['.dockerfile']],
    ]);
    expect(
      documentProcessors.every(
        (processor) => typeof processor.process === 'function',
      ),
    ).toBe(true);
    const markdownProcessor = documentProcessors.find(
      ({ id }) => id === 'markdown',
    );
    expect(markdownProcessor?.supports('README.MD')).toBe(true);
    expect(markdownProcessor?.process('# Overview').blocks).toEqual([
      expect.objectContaining({
        key: 'markdown:1:heading',
        text: 'Overview',
        locator: { kind: 'markdown-lines', lineStart: 1, lineEnd: 1 },
      }),
    ]);
    expect(
      documentProcessors
        .find(({ id }) => id === 'dockerfile')
        ?.supports('Dockerfile'),
    ).toBe(true);
  });

  it('keeps registered processor identity and filename matching aligned with catalogue authority', () => {
    for (const definition of processingDefinitionRegistry) {
      const processor = documentProcessors.find(
        ({ id }) => id === definition.processorId,
      );
      expect(processor).toBeDefined();
      expect(processor?.extractionRuleId).toBe(definition.extractionRuleId);
      const filename =
        definition.filenameMatchKind === 'exact'
          ? definition.filenameMatch
          : `fixture${definition.filenameMatch}`;
      expect(processor?.supports(filename)).toBe(true);
    }
  });

  it('extracts Markdown blocks with line and heading provenance', () => {
    const result = processDocument(
      'README.md',
      '# Overview\n\nWorkspace Brain records evidence.\n\n- Read only\n',
    );

    expect(result.processorId).toBe('markdown');
    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'heading',
        excerpt: 'Overview',
        locator: { kind: 'markdown-lines', lineStart: 1, lineEnd: 1 },
      }),
      expect.objectContaining({
        kind: 'paragraph',
        excerpt: 'Workspace Brain records evidence.',
        locator: {
          kind: 'markdown-lines',
          lineStart: 3,
          lineEnd: 3,
          headingPath: ['Overview'],
        },
      }),
      expect.objectContaining({
        kind: 'list-item',
        excerpt: '- Read only',
        locator: {
          kind: 'markdown-lines',
          lineStart: 5,
          lineEnd: 5,
          headingPath: ['Overview'],
        },
      }),
    ]);
  });

  it('extracts JSON scalar leaves in stable pointer order', () => {
    const result = processDocument('openapi.json', '{"z":true,"a":["x",2]}');
    expect(
      result.evidence.map(({ locator, excerpt }) => [locator, excerpt]),
    ).toEqual([
      [{ kind: 'json-pointer', pointer: '/a/0' }, 'x'],
      [{ kind: 'json-pointer', pointer: '/a/1' }, '2'],
      [{ kind: 'json-pointer', pointer: '/z' }, 'true'],
    ]);
  });

  it('extracts YAML scalar leaves with deterministic ordering and source lines', () => {
    const result = processDocument('config.yaml', 'z: true\na:\n  - hello\n');
    expect(
      result.evidence.map(({ excerpt, locator }) => [excerpt, locator]),
    ).toEqual([
      ['hello', { kind: 'yaml-lines', lineStart: 3, lineEnd: 3 }],
      ['true', { kind: 'yaml-lines', lineStart: 1, lineEnd: 1 }],
    ]);
  });

  it('extracts plain-text paragraphs and bounds evidence excerpts', () => {
    const result = processDocument('notes.txt', `${'x'.repeat(4_100)}\n`);
    expect(result.evidence[0]?.excerpt).toHaveLength(4_000);
    expect(result.evidence[0]?.truncated).toBe(true);
    expect(result.evidence[0]?.locator).toEqual({
      kind: 'text-lines',
      lineStart: 1,
      lineEnd: 1,
    });
  });

  it('extracts TypeScript declarations and Dockerfile base-image evidence', () => {
    const typescript = processDocument(
      'entry.ts',
      "import { app } from './app.js';\nexport const name = 'entry';",
    );
    expect(
      typescript.evidence.map(({ excerpt, locator }) => [excerpt, locator]),
    ).toEqual([
      [
        "import { app } from './app.js';",
        { kind: 'text-lines', lineStart: 1, lineEnd: 1 },
      ],
      [
        "export const name = 'entry';",
        { kind: 'text-lines', lineStart: 2, lineEnd: 2 },
      ],
    ]);

    const dockerfile = processDocument(
      'Dockerfile',
      'FROM node:22-alpine AS base\nRUN npm install\nFROM base AS app',
    );
    expect(dockerfile.evidence.map(({ excerpt }) => excerpt)).toEqual([
      'FROM node:22-alpine AS base',
      'FROM base AS app',
    ]);
  });

  it('rejects malformed structured documents and unsupported formats', () => {
    expect(() => processDocument('invalid.json', '{')).toThrow();
    expect(() => processDocument('invalid.yaml', 'key: [')).toThrow(
      'YAML document is invalid',
    );
    expect(() => processDocument('script.py', 'run()')).toThrow(
      'Unsupported document extension: .py',
    );
  });
});
