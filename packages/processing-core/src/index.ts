import { isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';

import { processingDefinitionRegistry } from '@workspace-brain/domain';

export type EvidenceLocator =
  | {
      readonly kind: 'markdown-lines' | 'text-lines' | 'yaml-lines';
      readonly lineStart: number;
      readonly lineEnd: number;
      readonly headingPath?: readonly string[];
    }
  | {
      readonly kind: 'json-pointer';
      readonly pointer: string;
    };

export type EvidenceCandidate = {
  readonly key: string;
  readonly kind:
    | 'heading'
    | 'paragraph'
    | 'list-item'
    | 'table-row'
    | 'code-block'
    | 'structured-value';
  readonly excerpt: string;
  readonly truncated: boolean;
  readonly locator: EvidenceLocator;
};

export type NormalizedBlock = {
  readonly key: string;
  readonly kind: EvidenceCandidate['kind'];
  readonly text: string;
  readonly locator: EvidenceLocator;
};

export type NormalizedDocument = {
  readonly blocks: readonly NormalizedBlock[];
};

export type DocumentProcessor = {
  readonly id: string;
  readonly version: 1;
  readonly supportedExtensions: readonly string[];
  supports(filename: string): boolean;
  process(content: string): NormalizedDocument;
  readonly extractionRuleId: string;
  readonly extractionRuleVersion: 1;
};

export type ProcessedDocument = {
  readonly processorId: string;
  readonly processorVersion: 1;
  readonly extractionRuleId: string;
  readonly extractionRuleVersion: 1;
  readonly evidence: readonly EvidenceCandidate[];
};

const maximumExcerptCharacters = 4_000;
function definitionFor(processorId: string) {
  const definition = processingDefinitionRegistry.find(
    ({ processorId: registeredProcessorId }) =>
      registeredProcessorId === processorId,
  );
  if (definition === undefined) {
    throw new Error(`No processing definition registered for ${processorId}`);
  }
  return definition;
}

function extensionsFor(processorId: string): readonly string[] {
  return processingDefinitionRegistry
    .filter(
      (definition) =>
        definition.processorId === processorId &&
        definition.filenameMatchKind === 'suffix',
    )
    .map(({ filenameMatch }) => filenameMatch);
}

export const documentProcessors: readonly DocumentProcessor[] = [
  createProcessor(
    'markdown',
    extensionsFor('markdown'),
    definitionFor('markdown').extractionRuleId,
    normalizeMarkdown,
  ),
  createProcessor(
    'yaml',
    extensionsFor('yaml'),
    definitionFor('yaml').extractionRuleId,
    (text) => normalizeYaml(text),
  ),
  createProcessor(
    'json',
    extensionsFor('json'),
    definitionFor('json').extractionRuleId,
    (text) => normalizeJson(text),
  ),
  createProcessor(
    'plain-text',
    extensionsFor('plain-text'),
    definitionFor('plain-text').extractionRuleId,
    (text) => normalizeText(text),
  ),
  createProcessor(
    'typescript',
    extensionsFor('typescript'),
    definitionFor('typescript').extractionRuleId,
    normalizeTypeScript,
  ),
  createProcessor(
    'dockerfile',
    extensionsFor('dockerfile'),
    definitionFor('dockerfile').extractionRuleId,
    normalizeDockerfile,
  ),
];

export function processDocument(
  filename: string,
  content: string,
): ProcessedDocument {
  const processor = documentProcessors.find(({ supports }) =>
    supports(filename),
  );
  if (processor === undefined) {
    throw new Error(
      `Unsupported document extension: ${extensionOf(filename) || '(none)'}`,
    );
  }
  const normalized = processor.process(content);
  return {
    processorId: processor.id,
    processorVersion: processor.version,
    extractionRuleId: processor.extractionRuleId,
    extractionRuleVersion: processor.extractionRuleVersion,
    evidence: extractEvidence(normalized),
  };
}

function createProcessor(
  id: string,
  extensions: readonly string[],
  extractionRuleId: string,
  normalize: (content: string) => readonly NormalizedBlock[],
): DocumentProcessor {
  return {
    id,
    version: 1,
    supportedExtensions: extensions,
    supports: (filename) =>
      extensions.includes(extensionOf(filename)) ||
      (id === 'dockerfile' &&
        filename.toLocaleLowerCase('en-US') === 'dockerfile'),
    process: (content) => ({ blocks: normalize(content) }),
    extractionRuleId,
    extractionRuleVersion: 1,
  };
}

function extractEvidence(document: NormalizedDocument): EvidenceCandidate[] {
  return document.blocks.map((block) =>
    makeEvidence(block.key, block.kind, block.text, block.locator),
  );
}

function extensionOf(filename: string): string {
  const name = filename.toLocaleLowerCase('en-US');
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot);
}

function normalizeMarkdown(content: string): NormalizedBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: NormalizedBlock[] = [];
  const headings: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const heading = /^( {0,3})(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      const depth = heading[2]?.length ?? 1;
      const text = (heading[3] ?? '').trim();
      headings.splice(depth - 1);
      headings[depth - 1] = text;
      blocks.push(
        makeBlock(`markdown:${index + 1}:heading`, 'heading', text, {
          kind: 'markdown-lines',
          lineStart: index + 1,
          lineEnd: index + 1,
        }),
      );
      index += 1;
      continue;
    }

    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      const marker = fence[1]?.[0];
      const blockStart = index;
      const block = [line];
      index += 1;
      while (index < lines.length) {
        const codeLine = lines[index] ?? '';
        block.push(codeLine);
        index += 1;
        if (
          marker !== undefined &&
          new RegExp(`^\\s*${marker}{3,}\\s*$`).test(codeLine)
        ) {
          break;
        }
      }
      blocks.push(
        makeBlock(
          `markdown:${blockStart + 1}:code`,
          'code-block',
          block.join('\n'),
          {
            kind: 'markdown-lines',
            lineStart: blockStart + 1,
            lineEnd: index,
            headingPath: [...headings],
          },
        ),
      );
      continue;
    }

    if (/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)) {
      blocks.push(
        makeBlock(`markdown:${index + 1}:list`, 'list-item', line.trim(), {
          kind: 'markdown-lines',
          lineStart: index + 1,
          lineEnd: index + 1,
          headingPath: [...headings],
        }),
      );
      index += 1;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      blocks.push(
        makeBlock(`markdown:${index + 1}:table`, 'table-row', line.trim(), {
          kind: 'markdown-lines',
          lineStart: index + 1,
          lineEnd: index + 1,
          headingPath: [...headings],
        }),
      );
      index += 1;
      continue;
    }

    const blockStart = index;
    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? '').trim().length > 0 &&
      !isMarkdownBlockStart(lines[index] ?? '')
    ) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push(
      makeBlock(
        `markdown:${blockStart + 1}:paragraph`,
        'paragraph',
        paragraph.join(' '),
        {
          kind: 'markdown-lines',
          lineStart: blockStart + 1,
          lineEnd: index,
          headingPath: [...headings],
        },
      ),
    );
  }
  return blocks;
}

function isMarkdownBlockStart(line: string): boolean {
  return (
    /^( {0,3}#{1,6})[ \t]+/.test(line) ||
    /^\s*(`{3,}|~{3,})/.test(line) ||
    /^\s*(?:[-+*]|\d+[.)])\s+/.test(line) ||
    /^\s*\|.*\|\s*$/.test(line)
  );
}

function normalizeText(content: string): NormalizedBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: NormalizedBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && (lines[index] ?? '').trim().length === 0) {
      index += 1;
    }
    if (index >= lines.length) {
      break;
    }
    const start = index;
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? '').trim().length > 0) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push(
      makeBlock(
        `text:${start + 1}:paragraph`,
        'paragraph',
        paragraph.join(' '),
        { kind: 'text-lines', lineStart: start + 1, lineEnd: index },
      ),
    );
  }
  return blocks;
}

function normalizeTypeScript(content: string): NormalizedBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: NormalizedBlock[] = [];
  for (const [index, line] of lines.entries()) {
    if (
      /^\s*(?:import|export)\b/.test(line) ||
      /^\s*(?:const|let|var|function|class|interface|type)\s+\w+/.test(line)
    ) {
      blocks.push(
        makeBlock(
          `typescript:${index + 1}:declaration`,
          'code-block',
          line.trim(),
          { kind: 'text-lines', lineStart: index + 1, lineEnd: index + 1 },
        ),
      );
    }
  }
  return blocks;
}

function normalizeDockerfile(content: string): NormalizedBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: NormalizedBlock[] = [];
  for (const [index, line] of lines.entries()) {
    if (/^\s*FROM\s+/i.test(line)) {
      blocks.push(
        makeBlock(`dockerfile:${index + 1}:from`, 'code-block', line.trim(), {
          kind: 'text-lines',
          lineStart: index + 1,
          lineEnd: index + 1,
        }),
      );
    }
  }
  return blocks;
}

function normalizeJson(content: string): NormalizedBlock[] {
  const value: unknown = JSON.parse(content);
  const blocks: NormalizedBlock[] = [];
  visitJson(value, '', blocks);
  return blocks;
}

function visitJson(
  value: unknown,
  pointer: string,
  blocks: NormalizedBlock[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitJson(item, `${pointer}/${index}`, blocks),
    );
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value).sort(compareOrdinal)) {
      visitJson(
        (value as Record<string, unknown>)[key],
        `${pointer}/${escapePointer(key)}`,
        blocks,
      );
    }
    return;
  }
  const excerpt = typeof value === 'string' ? value : String(value);
  blocks.push(
    makeBlock(`json:${pointer}`, 'structured-value', excerpt, {
      kind: 'json-pointer',
      pointer,
    }),
  );
}

function normalizeYaml(content: string): NormalizedBlock[] {
  const document = parseDocument(content, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error('YAML document is invalid');
  }
  const lines = lineOffsets(content);
  const blocks: NormalizedBlock[] = [];
  visitYaml(document.contents, '', lines, blocks);
  return blocks;
}

function visitYaml(
  node: Node | null,
  pointer: string,
  lines: readonly number[],
  blocks: NormalizedBlock[],
): void {
  if (node === null) {
    return;
  }
  if (isMap(node)) {
    const pairs = [...node.items].sort((left, right) =>
      compareOrdinal(String(left.key), String(right.key)),
    );
    for (const pair of pairs) {
      const key = isScalar(pair.key)
        ? String(pair.key.value)
        : String(pair.key);
      visitYaml(
        pair.value as Node | null,
        `${pointer}/${escapePointer(key)}`,
        lines,
        blocks,
      );
    }
    return;
  }
  if (isSeq(node)) {
    node.items.forEach((item, index) =>
      visitYaml(item as Node | null, `${pointer}/${index}`, lines, blocks),
    );
    return;
  }
  if (!isScalar(node)) {
    return;
  }

  const range = node.range;
  const startOffset = range?.[0] ?? 0;
  const endOffset = range?.[1] ?? startOffset;
  const value = node.value;
  const excerpt = value === null ? 'null' : String(value);
  const lineStart = lineAtOffset(lines, startOffset);
  const lineEnd = lineAtOffset(lines, Math.max(startOffset, endOffset - 1));
  blocks.push(
    makeBlock(`yaml:${pointer}`, 'structured-value', excerpt, {
      kind: 'yaml-lines',
      lineStart,
      lineEnd,
    }),
  );
}

function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function lineAtOffset(offsets: readonly number[], offset: number): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle] ?? 0) <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function makeEvidence(
  key: string,
  kind: EvidenceCandidate['kind'],
  text: string,
  locator: EvidenceLocator,
): EvidenceCandidate {
  const normalized = text.trim();
  const truncated = normalized.length > maximumExcerptCharacters;
  return {
    key,
    kind,
    excerpt: truncated
      ? normalized.slice(0, maximumExcerptCharacters)
      : normalized,
    truncated,
    locator,
  };
}

function makeBlock(
  key: string,
  kind: EvidenceCandidate['kind'],
  text: string,
  locator: EvidenceLocator,
): NormalizedBlock {
  return { key, kind, text, locator };
}
