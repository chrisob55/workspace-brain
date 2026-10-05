import { describe, expect, it } from 'vitest';

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

  it('rejects malformed structured documents and unsupported formats', () => {
    expect(() => processDocument('invalid.json', '{')).toThrow();
    expect(() => processDocument('invalid.yaml', 'key: [')).toThrow(
      'YAML document is invalid',
    );
    expect(() => processDocument('script.ts', 'run()')).toThrow(
      'Unsupported document extension: .ts',
    );
  });
});
