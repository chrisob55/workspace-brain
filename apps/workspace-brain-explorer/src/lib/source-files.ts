/**
 * Index of the repository's own implementation assets. Documentation links
 * resolve against these files at runtime, so a renamed symbol or deleted file is
 * reported as unresolved instead of silently pointing at the wrong place.
 */
const IMPORTER_DIRECTORY = 'apps/workspace-brain-explorer/src/lib';

/** Vite keys globbed files relative to this module; normalise to repository paths. */
export function toRepositoryPath(key: string): string {
  const parts = IMPORTER_DIRECTORY.split('/');
  for (const segment of key.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

const loaders = import.meta.glob(
  [
    '../../../../apps/*/src/**/*.{ts,tsx}',
    '../../../../packages/*/src/**/*.ts',
    '../../../../infrastructure/*/src/**/*.ts',
    '../../../../infrastructure/duckdb/migrations/*.sql',
    '../../../../services/*/src/**/*.ts',
    '../../../../test/**/*.ts',
    '../../../../docs/**/*.md',
    '../../../../openapi/openapi.json',
    '../../../../config/*.yaml',
    '../../../../deploy/compose/*.yaml',
    '../../../../scripts/*.{mjs,sh}',
    '../../../../package.json',
    '../../../../README.md',
  ],
  { query: '?raw', import: 'default' },
) as Record<string, () => Promise<string>>;

const loaderByPath = new Map(
  Object.entries(loaders).map(([key, load]) => [toRepositoryPath(key), load]),
);

export const SOURCE_PATHS: readonly string[] = [...loaderByPath.keys()].sort();

export function hasSource(path: string): boolean {
  return loaderByPath.has(path);
}

export async function loadSource(path: string): Promise<string> {
  const load = loaderByPath.get(path);
  if (!load) throw new Error(`${path} is not part of the indexed repository`);
  return load();
}

export interface SymbolLocation {
  line: number;
  endLine: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineOfIndex(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1)
    if (content.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Best-effort end of the block that starts at `start`, by bracket balance. */
function blockEnd(content: string, start: number): number {
  const openers = '{([';
  const closers = '})]';
  let depth = 0;
  let opened = false;
  const limit = Math.min(content.length, start + 40_000);
  for (let i = start; i < limit; i += 1) {
    const char = content[i]!;
    if (openers.includes(char)) {
      depth += 1;
      opened = true;
    } else if (closers.includes(char)) {
      depth -= 1;
      if (opened && depth <= 0) {
        // A parameter list closes before the body (or arrow) that follows it.
        const rest = content.slice(i + 1, i + 400);
        if (char === ')' && /^\s*(?::[^;{}]*?)?(?:=>)?\s*\{|^\s*=>/.test(rest))
          continue;
        return lineOfIndex(content, i);
      }
    } else if (!opened && char === ';') {
      return lineOfIndex(content, i);
    }
  }
  return lineOfIndex(content, start);
}

/**
 * Locates a symbol in source text. Plain identifiers match declarations
 * (functions, classes, types, constants, methods, SQL tables, OpenAPI schema
 * keys or Markdown headings); a `text:` prefix matches literal text.
 */
export function locateSymbol(
  content: string,
  symbol: string,
): SymbolLocation | undefined {
  if (symbol.startsWith('text:')) {
    const index = content.indexOf(symbol.slice(5));
    if (index === -1) return undefined;
    const line = lineOfIndex(content, index);
    return { line, endLine: Math.max(line, blockEnd(content, index)) };
  }
  const name = escapeRegExp(symbol);
  const patterns = [
    new RegExp(
      `^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:declare[ \\t]+)?(?:async[ \\t]+)?(?:function\\*?|const|let|var|class|interface|type|enum)[ \\t]+${name}\\b`,
      'm',
    ),
    new RegExp(
      `^[ \\t]+(?:public[ \\t]+|private[ \\t]+|static[ \\t]+|async[ \\t]+)*${name}[ \\t]*[(<]`,
      'm',
    ),
    new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${name}\\b`, 'mi'),
    new RegExp(`^[ \\t]*"${name}"[ \\t]*:[ \\t]*\\{`, 'm'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (!match) continue;
    const line = lineOfIndex(content, match.index);
    return { line, endLine: Math.max(line, blockEnd(content, match.index)) };
  }
  const heading = new RegExp(`^(#{1,6})[ \\t]+${name}(?![\\w-])`, 'm').exec(
    content,
  );
  if (heading) {
    const line = lineOfIndex(content, heading.index);
    const level = heading[1]!.length;
    const lines = content.split('\n');
    let endLine = lines.length;
    for (let i = line; i < lines.length; i += 1) {
      const next = /^(#{1,6})[ \t]/.exec(lines[i]!);
      if (next && next[1]!.length <= level) {
        endLine = i;
        break;
      }
    }
    while (endLine > line && !lines[endLine - 1]!.trim()) endLine -= 1;
    return { line, endLine };
  }
  return undefined;
}

export const REPOSITORY_URL =
  (import.meta.env.VITE_WORKSPACE_BRAIN_REPOSITORY_URL as string | undefined) ??
  'https://github.com/chrisob55/workspace-brain';
export const REPOSITORY_REF =
  (import.meta.env.VITE_WORKSPACE_BRAIN_REPOSITORY_REF as string | undefined) ??
  'main';

export function githubUrl(path: string, location?: SymbolLocation): string {
  const anchor = location
    ? location.endLine > location.line
      ? `#L${location.line}-L${location.endLine}`
      : `#L${location.line}`
    : '';
  return `${REPOSITORY_URL}/blob/${REPOSITORY_REF}/${path}${anchor}`;
}

/** Opens the file in a local VS Code; only available from the dev server. */
export function editorUrl(
  path: string,
  location?: SymbolLocation,
): string | undefined {
  const root =
    typeof __WORKSPACE_BRAIN_REPOSITORY_ROOT__ === 'string'
      ? __WORKSPACE_BRAIN_REPOSITORY_ROOT__
      : '';
  if (!root) return undefined;
  return `vscode://file/${root}/${path}${location ? `:${location.line}` : ''}`;
}
