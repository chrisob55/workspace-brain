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
      ['scala-source', ['.scala']],
      ['play-routes', ['.routes']],
      ['hocon', ['.conf']],
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

  it('versions processors for immutable architectural extraction context', () => {
    expect(
      documentProcessors.map(({ id, version }) => [id, version]),
    ).toContainEqual(['typescript', 3]);
    expect(documentProcessors.map(({ id, version }) => [id, version])).toEqual(
      expect.arrayContaining([
        ['scala-source', 2],
        ['play-routes', 1],
        ['hocon', 1],
      ]),
    );
    expect(processDocument('entry.ts', 'const a = 1;').processorVersion).toBe(
      3,
    );
    expect(processDocument('README.md', '# A').processorVersion).toBe(3);
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

  it('preserves Play route set, declared handler, comments, and mounts as separate facts', () => {
    const evidence = processDocument(
      'app.routes',
      [
        '# GET /ignored controllers.IgnoredController.index',
        'GET     /items/:id    controllers.ItemsController.get(id: Id)',
        '->      /prefix       app.routes',
      ].join('\n'),
      'conf/app.routes',
    ).evidence;

    expect(evidence.map(({ excerpt, locator }) => [excerpt, locator])).toEqual([
      [
        'GET     /items/:id    controllers.ItemsController.get(id: Id)',
        {
          kind: 'play-route',
          routeSet: 'app',
          method: 'GET',
          declaredPath: '/items/:id',
          handlerExpression: 'controllers.ItemsController.get(id: Id)',
          lineStart: 2,
          lineEnd: 2,
        },
      ],
      [
        '->      /prefix       app.routes',
        {
          kind: 'play-route',
          routeSet: 'app',
          mountPrefix: '/prefix',
          includeTarget: 'app.routes',
          lineStart: 3,
          lineEnd: 3,
        },
      ],
    ]);
  });

  it('classifies route sets without promoting unknown or test routes', () => {
    const routes = processDocument(
      'testOnly.routes',
      'GET /health controllers.HealthController.check\n',
      'conf/testOnly.routes',
    );
    expect(routes.evidence[0]?.locator).toMatchObject({
      kind: 'play-route',
      routeSet: 'test-only',
    });

    const unknown = processDocument(
      'custom.routes',
      'GET /health controllers.HealthController.check\n',
      'conf/custom.routes',
    );
    expect(unknown.evidence[0]?.locator).toMatchObject({
      kind: 'play-route',
      routeSet: 'other',
    });
  });

  it('extracts nested HOCON literals and substitutions without exposing secret values', () => {
    const evidence = processDocument(
      'application.conf',
      [
        'microservice {',
        '  services {',
        '    agent {',
        '      host = ${AGENT_HOST}',
        '      port = 1234',
        '      password = "must-not-escape"',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      'conf/application.conf',
    ).evidence;

    expect(evidence.map(({ excerpt, locator }) => [excerpt, locator])).toEqual([
      [
        'microservice.services.agent.host = ${AGENT_HOST}',
        {
          kind: 'hocon-key',
          key: 'microservice.services.agent.host',
          valueKind: 'substitution',
          substitutions: ['AGENT_HOST'],
          lineStart: 4,
          lineEnd: 4,
        },
      ],
      [
        'microservice.services.agent.port = 1234',
        {
          kind: 'hocon-key',
          key: 'microservice.services.agent.port',
          valueKind: 'number',
          literalValue: '1234',
          lineStart: 5,
          lineEnd: 5,
        },
      ],
      [
        'microservice.services.agent.password = <redacted>',
        {
          kind: 'hocon-key',
          key: 'microservice.services.agent.password',
          valueKind: 'redacted',
          lineStart: 6,
          lineEnd: 6,
        },
      ],
    ]);
  });

  it('retains unsupported HOCON values without resolving or exposing URI credentials', () => {
    const evidence = processDocument(
      'application.conf',
      [
        'items = [one, two]',
        'joined = "first" "second"',
        'mongodb.uri = "mongodb://user:password@db.example/items"',
      ].join('\n'),
    ).evidence;

    expect(evidence.map(({ excerpt, locator }) => [excerpt, locator])).toEqual([
      [
        'items = <unsupported>',
        {
          kind: 'hocon-key',
          key: 'items',
          valueKind: 'unsupported',
          lineStart: 1,
          lineEnd: 1,
        },
      ],
      [
        'joined = <unsupported>',
        {
          kind: 'hocon-key',
          key: 'joined',
          valueKind: 'unsupported',
          lineStart: 2,
          lineEnd: 2,
        },
      ],
      [
        'mongodb.uri = <redacted>',
        {
          kind: 'hocon-key',
          key: 'mongodb.uri',
          valueKind: 'redacted',
          lineStart: 3,
          lineEnd: 3,
        },
      ],
    ]);
  });

  it('extracts Scala declarations and direct calls, excluding comments and strings', () => {
    const evidence = processDocument(
      'ExampleController.scala',
      [
        'package uk.gov.hmrc.example',
        'class ExampleController(service: ExampleService) {',
        '  def get(id: String) = {',
        '    // service.ignored(id)',
        '    val message = "service.ignored(id)"',
        '    if (valid(id)) service.find(id).map(value => service.normalize(value)) else fallback()',
        '  }',
        '}',
      ].join('\n'),
      'app/uk/gov/hmrc/example/ExampleController.scala',
    ).evidence;

    const locators = evidence.map(({ locator }) => locator);
    expect(locators).toEqual(
      expect.arrayContaining([
        {
          kind: 'scala-symbol',
          packageName: 'uk.gov.hmrc.example',
          symbolKind: 'class',
          symbolName: 'uk.gov.hmrc.example.ExampleController',
          signature: 'class ExampleController(service: ExampleService) {',
          lineStart: 2,
          lineEnd: 2,
        },
        {
          kind: 'scala-symbol',
          packageName: 'uk.gov.hmrc.example',
          symbolKind: 'constructor-parameter',
          symbolName: 'service',
          enclosingSymbol: 'uk.gov.hmrc.example.ExampleController',
          signature: 'ExampleService',
          lineStart: 2,
          lineEnd: 2,
        },
        expect.objectContaining({
          kind: 'scala-symbol',
          packageName: 'uk.gov.hmrc.example',
          symbolKind: 'method',
          symbolName: 'uk.gov.hmrc.example.ExampleController.get',
          enclosingSymbol: 'uk.gov.hmrc.example.ExampleController',
        }),
        expect.objectContaining({
          kind: 'scala-call-site',
          targetText: 'service.find',
          methodName: 'find',
          receiver: 'service',
          branchContext: 'if',
        }),
        expect.objectContaining({
          kind: 'scala-call-site',
          targetText: 'fallback',
          methodName: 'fallback',
          branchContext: 'else',
        }),
        expect.objectContaining({
          kind: 'scala-call-site',
          targetText: 'service.normalize',
          methodName: 'normalize',
          receiver: 'service',
          asyncGroup: 'map',
        }),
      ]),
    );
    expect(
      locators.filter(
        (locator) =>
          locator.kind === 'scala-call-site' &&
          locator.targetText.includes('ignored'),
      ),
    ).toEqual([]);
  });

  it('extracts constructor parameters after Scala injection annotations', () => {
    const evidence = processDocument(
      'InjectedController.scala',
      [
        'package uk.gov.hmrc.example.controllers',
        'import javax.inject.Inject',
        'class InjectedController @Inject() (private val service: ExampleService) {',
        '  def get() = service.find()',
        '}',
      ].join('\n'),
    ).evidence;

    expect(
      evidence
        .map(({ locator }) => locator)
        .filter(
          (locator) =>
            locator.kind === 'scala-symbol' &&
            locator.symbolKind === 'constructor-parameter',
        ),
    ).toEqual([
      {
        kind: 'scala-symbol',
        packageName: 'uk.gov.hmrc.example.controllers',
        symbolKind: 'constructor-parameter',
        symbolName: 'service',
        enclosingSymbol: 'uk.gov.hmrc.example.controllers.InjectedController',
        signature: 'ExampleService',
        lineStart: 3,
        lineEnd: 3,
      },
    ]);
  });

  it('keeps Scala methods separate across nested blocks and default arguments', () => {
    const evidence = processDocument(
      'Example.scala',
      [
        'class Example {',
        '  def first(limit: Int = 1) = if (limit > 0) {',
        '    service.first(limit)',
        '  } else service.empty()',
        '  def second() = service.second()',
        '}',
      ].join('\n'),
    ).evidence;

    const calls = evidence.flatMap(({ locator }) =>
      locator.kind === 'scala-call-site' ? [locator] : [],
    );
    expect(
      calls.map(({ enclosingSymbol, targetText }) => [
        enclosingSymbol,
        targetText,
      ]),
    ).toEqual([
      ['Example.first', 'service.first'],
      ['Example.first', 'service.empty'],
      ['Example.second', 'service.second'],
    ]);
  });

  it('bounds oversized structured evidence and rejects unbalanced Scala comments', () => {
    expect(() =>
      processDocument(
        'routes.routes',
        Array.from(
          { length: 300 },
          (_, index) => `GET /${index} ${'x'.repeat(2048)}`,
        ).join('\n'),
      ),
    ).toThrow('Structured parser evidence exceeds');
    expect(() =>
      processDocument('invalid.scala', 'class Example { /* not closed'),
    ).toThrow('Unterminated Scala block comment');
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
