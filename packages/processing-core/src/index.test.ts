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

  it('versions the TypeScript processor independently of other processors', () => {
    expect(
      documentProcessors.map(({ id, version }) => [id, version]),
    ).toContainEqual(['typescript', 2]);
    expect(processDocument('entry.ts', 'const a = 1;').processorVersion).toBe(
      2,
    );
    expect(processDocument('README.md', '# A').processorVersion).toBe(1);
  });

  it('captures complete multi-line TypeScript import and re-export statements', () => {
    const source = [
      "import { single } from './single.js';",
      'import {',
      '  first,',
      '  type Second,',
      "} from '@workspace-brain/domain';",
      'import type {',
      '  OnlyType,',
      "} from '@workspace-brain/catalogue';",
      'export {',
      '  reExported,',
      "} from './re-export.js';",
      'export const name = "entry";',
    ].join('\n');

    const evidence = processDocument('entry.ts', source).evidence;

    expect(
      evidence.map(({ key, excerpt, locator }) => [key, excerpt, locator]),
    ).toEqual([
      [
        'typescript:1:module:1',
        "import { single } from './single.js';",
        { kind: 'text-lines', lineStart: 1, lineEnd: 1 },
      ],
      [
        'typescript:2:module:1',
        "import {\n  first,\n  type Second,\n} from '@workspace-brain/domain';",
        { kind: 'text-lines', lineStart: 2, lineEnd: 5 },
      ],
      [
        'typescript:6:module:1',
        "import type {\n  OnlyType,\n} from '@workspace-brain/catalogue';",
        { kind: 'text-lines', lineStart: 6, lineEnd: 8 },
      ],
      [
        'typescript:9:module:1',
        "export {\n  reExported,\n} from './re-export.js';",
        { kind: 'text-lines', lineStart: 9, lineEnd: 11 },
      ],
      [
        'typescript:12:declaration',
        'export const name = "entry";',
        { kind: 'text-lines', lineStart: 12, lineEnd: 12 },
      ],
    ]);
  });

  it('ignores declaration-like text inside TypeScript comments and string literals', () => {
    const source = [
      "// import { commented } from 'commented-package';",
      '/*',
      "import { blockCommented } from 'block-commented-package';",
      '*/',
      'const template = `',
      "import { templated } from 'templated-package';",
      'const inner = 1;',
      '`;',
      "import { real } from 'real-package';",
    ].join('\n');

    const evidence = processDocument('entry.ts', source).evidence;

    expect(evidence.map(({ excerpt }) => excerpt)).toEqual([
      'const template = `',
      "import { real } from 'real-package';",
    ]);
  });

  it('processes the remainder of a TypeScript file containing malformed syntax', () => {
    const source = [
      "import { ok } from 'ok-package';",
      'export const broken = ;',
      'function (',
      "import { after } from 'after-package';",
    ].join('\n');

    const evidence = processDocument('entry.ts', source).evidence;

    expect(evidence.map(({ excerpt }) => excerpt)).toEqual(
      expect.arrayContaining([
        "import { ok } from 'ok-package';",
        "import { after } from 'after-package';",
      ]),
    );
    expect(new Set(evidence.map(({ key }) => key)).size).toBe(evidence.length);
  });

  it('keeps the module specifier when an oversized import statement is truncated', () => {
    const names = Array.from(
      { length: 400 },
      (_, index) => `  importedName${index},`,
    );
    const source = ['import {', ...names, "} from 'oversized-package';"].join(
      '\n',
    );

    const [evidence] = processDocument('entry.ts', source).evidence;

    expect(evidence?.truncated).toBe(true);
    expect(evidence?.excerpt.length).toBeLessThanOrEqual(4_000);
    expect(evidence?.excerpt.startsWith('import {\n  importedName0,')).toBe(
      true,
    );
    expect(evidence?.excerpt).toContain('/* … */');
    expect(evidence?.excerpt.endsWith("} from 'oversized-package';")).toBe(
      true,
    );
    expect(evidence?.locator).toEqual({
      kind: 'text-lines',
      lineStart: 1,
      lineEnd: 402,
    });
  });

  it('keeps the module specifier when comments make an import oversized', () => {
    const source = `import type { Only /* ${'x'.repeat(5_000)} */ } from 'commented-package';`;

    const [evidence] = processDocument('entry.ts', source).evidence;

    expect(evidence?.truncated).toBe(true);
    expect(evidence?.excerpt).toBe(
      "import type { /* … */ } from 'commented-package';",
    );
    expect(evidence?.locator).toEqual({
      kind: 'text-lines',
      lineStart: 1,
      lineEnd: 1,
    });
  });

  it('records each statement that shares a line with an import separately', () => {
    const evidence = processDocument(
      'entry.ts',
      [
        "import { x } from 'x'; export const y = 1;",
        "export const z = 2; import { w } from 'w'; import 'v';",
      ].join('\n'),
    ).evidence;

    expect(evidence.map(({ key, excerpt }) => [key, excerpt])).toEqual([
      ['typescript:1:declaration', 'export const y = 1;'],
      ['typescript:1:module:1', "import { x } from 'x';"],
      ['typescript:2:declaration', 'export const z = 2;'],
      ['typescript:2:module:1', "import { w } from 'w';"],
      ['typescript:2:module:2', "import 'v';"],
    ]);
  });

  it('keeps the type modifier when an oversized type-only star export is truncated', () => {
    const source = `export type * as Types /* ${'x'.repeat(5_000)} */ from './types.js'; export type * /* ${'x'.repeat(5_000)} */ from './more.js';`;

    const evidence = processDocument('entry.ts', source).evidence;

    expect(
      evidence.map(({ excerpt, truncated }) => [excerpt, truncated]),
    ).toEqual([
      ["export type * as Types /* … */ from './types.js';", true],
      ["export type * /* … */ from './more.js';", true],
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
