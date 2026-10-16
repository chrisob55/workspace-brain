import type { EvidenceLocator } from '@workspace-brain/domain';
import type { NormalizedBlock } from './index.js';

const maxFactsPerDocument = 2_000;
const maxEvidenceText = 2_000;
const maxEvidencePayloadBytes = 500_000;

type Token = {
  readonly text: string;
  readonly kind: 'identifier' | 'string' | 'symbol';
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
};

export function normalizePlayRoutes(
  content: string,
  relativePath: string,
): NormalizedBlock[] {
  const lines = normalizedLines(content);
  const routeSet = classifyRouteSet(relativePath);
  const blocks: NormalizedBlock[] = [];
  const duplicateRoutes = new Map<string, number>();

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const lineNumber = index + 1;
    const mount = /^->\s+(\S+)\s+(\S+)\s*$/.exec(trimmed);
    if (mount) {
      const prefix = mount[1] ?? '';
      const target = mount[2] ?? '';
      const locator: EvidenceLocator = {
        kind: 'play-route',
        routeSet,
        mountPrefix: prefix,
        includeTarget: target,
        lineStart: lineNumber,
        lineEnd: lineNumber,
      };
      blocks.push(
        structuredBlock(
          `mount:${relativePath}:${lineNumber}:${prefix}:${target}`,
          trimmed,
          locator,
        ),
      );
      return;
    }

    const route = /^\s*([A-Z]+)\s+(\S+)(?:\s+(.+?))?\s*$/.exec(line);
    if (!route) return;
    const method = route[1] ?? '';
    const declaredPath = route[2] ?? '';
    const handlerExpression = route[3]?.trim() ?? '';
    const base = `${method}\u0000${declaredPath}\u0000${handlerExpression}`;
    const duplicate = (duplicateRoutes.get(base) ?? 0) + 1;
    duplicateRoutes.set(base, duplicate);
    const locator: EvidenceLocator = {
      kind: 'play-route',
      routeSet,
      method,
      declaredPath,
      ...(handlerExpression ? { handlerExpression } : {}),
      lineStart: lineNumber,
      lineEnd: lineNumber,
    };
    blocks.push(
      structuredBlock(
        `route:${relativePath}:${routeSet}:${base}:${duplicate}`,
        trimmed,
        locator,
      ),
    );
  });

  return boundedBlocks(blocks, relativePath);
}

export function normalizeHocon(
  content: string,
  relativePath: string,
): NormalizedBlock[] {
  const lines = normalizedLines(content);
  const scopes: string[] = [];
  const blocks: NormalizedBlock[] = [];

  lines.forEach((line, index) => {
    const uncommented = stripHoconComment(line).trim();
    if (!uncommented) return;
    const lineNumber = index + 1;

    if (/^}/.test(uncommented)) {
      const closes = uncommented.match(/^}+/)?.[0].length ?? 0;
      for (let count = 0; count < closes; count += 1) scopes.pop();
      return;
    }

    const object = /^("(?:[^"\\]|\\.)*"|[^\s{}=:]+)\s*(?:=)?\s*\{\s*$/.exec(
      uncommented,
    );
    if (object) {
      scopes.push(unquote(object[1] ?? ''));
      return;
    }

    const assignment =
      /^("(?:[^"\\]|\\.)*"|[^\s{}=:]+)\s*(?:=|:)\s*(.*?)\s*$/.exec(uncommented);
    if (!assignment) return;
    const rawKey = unquote(assignment[1] ?? '');
    const rawValue = assignment[2] ?? '';
    if (!rawKey) return;
    const key = [...scopes, ...rawKey.split('.')].filter(Boolean).join('.');
    const substitutions = [...rawValue.matchAll(/\$\{([?]?)([^}]+)\}/g)].map(
      (match) => `${match[1] ?? ''}${match[2] ?? ''}`,
    );
    const sensitive =
      /(?:password|secret|token|credential|api[-_.]?key|private[-_.]?key|authorization)/i.test(
        key,
      ) ||
      /(?:^|\.)uri(?:$|\.)/i.test(key) ||
      /:\/\/[^/\s@]+:[^/\s@]+@/.test(rawValue);
    const unsupported =
      rawValue.startsWith('{') ||
      rawValue.startsWith('[') ||
      rawValue.startsWith('"""') ||
      rawValue.length === 0 ||
      hasTrailingAfterQuotedLiteral(rawValue) ||
      (substitutions.length > 0 &&
        rawValue.replace(/\$\{([?]?)([^}]+)\}/g, '').trim().length > 0) ||
      (!rawValue.startsWith('"') &&
        !rawValue.startsWith("'") &&
        rawValue.trim().split(/\s+/).length > 1);
    const literalValue =
      substitutions.length === 0 &&
      !sensitive &&
      !unsupported &&
      rawValue.length <= maxEvidenceText
        ? unquote(rawValue)
        : undefined;
    const valueKind = sensitive
      ? 'redacted'
      : rawValue.length > maxEvidenceText
        ? 'unsupported'
        : unsupported
          ? 'unsupported'
          : substitutions.length > 0
            ? 'substitution'
            : rawValue.startsWith('"') || rawValue.startsWith("'")
              ? 'string'
              : rawValue === 'true' || rawValue === 'false'
                ? 'boolean'
                : /^-?\d+(?:\.\d+)?$/.test(rawValue)
                  ? 'number'
                  : 'unquoted';
    const locator: EvidenceLocator = {
      kind: 'hocon-key',
      key,
      valueKind,
      ...(literalValue === undefined ? {} : { literalValue }),
      ...(substitutions.length === 0 ? {} : { substitutions }),
      lineStart: lineNumber,
      lineEnd: lineNumber,
    };
    blocks.push(
      structuredBlock(
        `hocon:${relativePath}:${key}:${lineNumber}`,
        `${key} = ${sensitive ? '<redacted>' : unsupported ? '<unsupported>' : rawValue}`,
        locator,
      ),
    );
  });

  return boundedBlocks(blocks, relativePath);
}

export function normalizeScala(content: string): NormalizedBlock[] {
  const tokens = tokenizeScala(content);
  const blocks: NormalizedBlock[] = [];
  const packageNames: string[] = [];
  const symbolTokens = new Set<number>();
  const methodTokens = new Map<number, { fullName: string; end: number }>();
  const classTokens = new Map<
    number,
    { fullName: string; end: number; declarationEnd: number }
  >();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.kind !== 'identifier') continue;
    if (token.text === 'package') {
      const parts: string[] = [];
      let cursor = index + 1;
      while (cursor < tokens.length) {
        const next = tokens[cursor];
        if (next?.line !== token.line) break;
        if (
          next?.kind === 'identifier' ||
          (next?.kind === 'symbol' && next.text === '.')
        ) {
          parts.push(next.text);
          cursor += 1;
        } else {
          break;
        }
      }
      const packageName = parts.join('');
      if (packageName) {
        packageNames.push(packageName);
        blocks.push(
          structuredBlock(
            `scala:package:${packageName}:${token.line}`,
            `package ${packageName}`,
            {
              kind: 'scala-symbol',
              packageName,
              symbolKind: 'package',
              symbolName: packageName,
              lineStart: token.line,
              lineEnd: tokens[Math.max(index, cursor - 1)]?.line ?? token.line,
            },
          ),
        );
      }
    }
  }

  const currentPackage = packageNames.at(-1) ?? '';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.kind !== 'identifier') continue;
    if (token.text === 'import') {
      const end = lineEndToken(tokens, index);
      const importText = content.slice(
        token.start,
        tokens[end]?.end ?? token.end,
      );
      const imported = importText.replace(/^import\s+/, '').replace(/\s+/g, '');
      if (imported) {
        blocks.push(
          structuredBlock(
            `scala:import:${currentPackage}:${imported}:${token.line}`,
            importText,
            {
              kind: 'scala-symbol',
              packageName: currentPackage,
              symbolKind: 'import',
              symbolName: imported,
              lineStart: token.line,
              lineEnd: tokens[end]?.line ?? token.line,
            },
          ),
        );
      }
      continue;
    }
    if (!['class', 'object', 'trait'].includes(token.text)) continue;
    const nameToken = tokens[index + 1];
    if (!nameToken || nameToken.kind !== 'identifier') continue;
    const declarationEnd = findDeclarationHeaderEnd(tokens, index + 2);
    const signature = content.slice(
      token.start,
      tokens[declarationEnd]?.end ?? nameToken.end,
    );
    const fullName = qualify(currentPackage, nameToken.text);
    const extendsType = extractExtendsType(signature);
    classTokens.set(index, {
      fullName,
      end: matchingBraceIndex(tokens, declarationEnd),
      declarationEnd,
    });
    symbolTokens.add(index + 1);
    blocks.push(
      structuredBlock(
        `scala:${token.text}:${fullName}:${token.line}`,
        signature.slice(0, maxEvidenceText),
        {
          kind: 'scala-symbol',
          packageName: currentPackage,
          symbolKind: token.text as 'class' | 'object' | 'trait',
          symbolName: fullName,
          ...(extendsType ? { extendsType } : {}),
          signature: signature.slice(0, maxEvidenceText),
          lineStart: token.line,
          lineEnd: tokens[declarationEnd]?.line ?? nameToken.line,
        },
      ),
    );

    const parameterOpen = findHeaderParameterOpen(
      tokens,
      index + 2,
      declarationEnd,
    );
    if (parameterOpen !== undefined) {
      const parameterClose = matchingPair(tokens, parameterOpen, '(', ')');
      if (parameterClose !== undefined) {
        for (const range of splitTopLevel(
          tokens,
          parameterOpen + 1,
          parameterClose,
          ',',
        )) {
          const colon = tokens.findIndex(
            (item, itemIndex) =>
              itemIndex >= range.start &&
              itemIndex < range.end &&
              item.text === ':',
          );
          const parameterIndex = colon - 1;
          const parameter = tokens[parameterIndex];
          const typeToken = colon >= 0 ? tokens[colon + 1] : undefined;
          if (!parameter || parameter.kind !== 'identifier' || !typeToken)
            continue;
          const typeText = content.slice(
            typeToken.start,
            tokens[range.end - 1]?.end ?? typeToken.end,
          );
          blocks.push(
            structuredBlock(
              `scala:constructor-parameter:${fullName}:${parameter.text}:${typeText}:${parameter.line}`,
              content.slice(
                tokens[range.start]?.start ?? parameter.start,
                tokens[range.end - 1]?.end ?? parameter.end,
              ),
              {
                kind: 'scala-symbol',
                packageName: currentPackage,
                symbolKind: 'constructor-parameter',
                symbolName: parameter.text,
                enclosingSymbol: fullName,
                signature: typeText,
                lineStart: parameter.line,
                lineEnd: tokens[range.end - 1]?.line ?? parameter.line,
              },
            ),
          );
        }
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.text !== 'def') continue;
    const name = tokens[index + 1];
    if (!name || name.kind !== 'identifier') continue;
    const classDeclaration = nearestEnclosingClass(classTokens, index);
    if (!classDeclaration) continue;
    const headerEnd = findMethodHeaderEnd(tokens, index + 2);
    const methodEnd = findMethodEnd(
      tokens,
      headerEnd,
      classDeclaration.end,
      token.column,
    );
    const fullName = `${classDeclaration.fullName}.${name.text}`;
    methodTokens.set(index, { fullName, end: methodEnd });
    symbolTokens.add(index + 1);
    const signature = content.slice(
      token.start,
      tokens[headerEnd]?.end ?? name.end,
    );
    blocks.push(
      structuredBlock(
        `scala:method:${fullName}:${token.line}:${signature.replace(/\s+/g, ' ').trim()}`,
        signature.slice(0, maxEvidenceText),
        {
          kind: 'scala-symbol',
          packageName: currentPackage,
          symbolKind: 'method',
          symbolName: fullName,
          enclosingSymbol: classDeclaration.fullName,
          signature: signature.slice(0, maxEvidenceText),
          lineStart: token.line,
          lineEnd: tokens[headerEnd]?.line ?? name.line,
        },
      ),
    );
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const name = tokens[index + 1];
    if (token?.text !== 'val' || name?.kind !== 'identifier') continue;
    const owner = nearestEnclosingClass(classTokens, index);
    const method = nearestEnclosingMethod(methodTokens, index);
    if (!owner || index <= owner.declarationEnd) continue;
    const nesting = tokens
      .slice(owner.declarationEnd, index)
      .reduce(
        (depth, item) =>
          depth + (item.text === '{' ? 1 : item.text === '}' ? -1 : 0),
        0,
      );
    if (!method) {
      const bodyStart = tokens[owner.declarationEnd];
      if (bodyStart?.text === ':') {
        let memberStart = index;
        while (memberStart > 0 && tokens[memberStart - 1]?.line === token.line)
          memberStart -= 1;
        if (
          nesting !== 0 ||
          tokens[memberStart]?.column !==
            tokens[owner.declarationEnd + 1]?.column
        )
          continue;
      } else if (nesting !== 1) continue;
    }
    let cursor = index + 2;
    while (
      cursor < owner.end &&
      tokens[cursor]?.line === name.line &&
      tokens[cursor]?.text !== '='
    )
      cursor += 1;
    if (tokens[cursor]?.text !== '=') continue;
    const start = cursor + 1;
    const first = tokens[start];
    if (!first) continue;
    let depth = 0;
    cursor = start;
    while (cursor < owner.end) {
      const next = tokens[cursor];
      if (
        !next ||
        (depth === 0 &&
          (next.line > first.line || next.text === ';' || next.text === '}'))
      )
        break;
      if (next.text === '(' || next.text === '[') depth += 1;
      if (next.text === ')' || next.text === ']') depth -= 1;
      if (depth < 0 || next.text === '{') break;
      cursor += 1;
    }
    if (depth !== 0 || cursor === start) continue;
    const expression = tokens
      .slice(start, cursor)
      .map(({ text }) => text)
      .join('');
    blocks.push(
      structuredBlock(
        `scala:value:${method?.fullName ?? owner.fullName}.${name.text}:${token.line}`,
        expression.slice(0, maxEvidenceText),
        {
          kind: 'scala-symbol',
          packageName: currentPackage,
          symbolKind: 'value',
          symbolName: `${method?.fullName ?? owner.fullName}.${name.text}`,
          enclosingSymbol: method?.fullName ?? owner.fullName,
          signature: expression.slice(0, maxEvidenceText),
          lineStart: token.line,
          lineEnd: tokens[cursor - 1]?.line ?? token.line,
        },
        expression.length > maxEvidenceText,
      ),
    );
  }

  const callOrdinals = new Map<string, number>();
  for (let index = 0; index < tokens.length; index += 1) {
    const enclosing = nearestEnclosingMethod(methodTokens, index);
    if (!enclosing) continue;
    const call = directCallAt(tokens, index);
    if (!call || symbolTokens.has(call.nameIndex)) continue;
    if (tokens[call.nameIndex - 1]?.text === 'def') continue;
    if (tokens[call.nameIndex - 1]?.text === 'new') continue;
    const startToken = tokens[call.startIndex];
    const nameToken = tokens[call.nameIndex];
    const endToken = tokens[call.endIndex];
    if (!startToken || !nameToken || !endToken) continue;
    const occurrenceKey = `${enclosing.fullName}:${startToken.line}`;
    const callIndex = (callOrdinals.get(occurrenceKey) ?? 0) + 1;
    callOrdinals.set(occurrenceKey, callIndex);
    const expression = content.slice(startToken.start, endToken.end);
    const context = callContext(tokens, call.startIndex, enclosing.end);
    blocks.push(
      structuredBlock(
        `scala:call:${enclosing.fullName}:${startToken.line}:${callIndex}:${call.targetText}`,
        expression.slice(0, maxEvidenceText),
        {
          kind: 'scala-call-site',
          packageName: currentPackage,
          enclosingSymbol: enclosing.fullName,
          targetText: call.targetText,
          methodName: nameToken.text,
          ...(call.receiver ? { receiver: call.receiver } : {}),
          ...(context.branch ? { branchContext: context.branch } : {}),
          ...(context.asyncGroup ? { asyncGroup: context.asyncGroup } : {}),
          callIndex,
          lineStart: startToken.line,
          lineEnd: endToken.line,
        },
        expression.length > maxEvidenceText,
      ),
    );
    index = call.nameIndex;
  }

  return boundedBlocks(blocks, 'Scala source');
}

function tokenizeScala(content: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  let column = 1;
  while (index < content.length) {
    const character = content[index] ?? '';
    if (character === '\n') {
      index += 1;
      line += 1;
      column = 1;
      continue;
    }
    if (/\s/.test(character)) {
      index += 1;
      column += 1;
      continue;
    }
    if (content.startsWith('//', index)) {
      while (index < content.length && content[index] !== '\n') {
        index += 1;
        column += 1;
      }
      continue;
    }
    if (content.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      column += 2;
      while (index < content.length && depth > 0) {
        if (content.startsWith('/*', index)) {
          depth += 1;
          index += 2;
          column += 2;
        } else if (content.startsWith('*/', index)) {
          depth -= 1;
          index += 2;
          column += 2;
        } else if (content[index] === '\n') {
          index += 1;
          line += 1;
          column = 1;
        } else {
          index += 1;
          column += 1;
        }
      }
      if (depth !== 0) throw new Error('Unterminated Scala block comment');
      continue;
    }
    const start = index;
    const startLine = line;
    const startColumn = column;
    if (character === '"') {
      const tripleQuoted = content.startsWith('"""', index);
      const prefix = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(
        content.slice(0, index),
      )?.[1];
      const end = findScalaStringEnd(
        content,
        index,
        tripleQuoted,
        prefix !== undefined,
        prefix === 'raw',
      );
      index = end;
      for (const consumedCharacter of content.slice(start, end)) {
        if (consumedCharacter === '\n') {
          line += 1;
          column = 1;
        } else {
          column += 1;
        }
      }
      tokens.push({
        text: content.slice(start, end),
        kind: 'string',
        start,
        end,
        line: startLine,
        column: startColumn,
      });
      continue;
    }
    if (character === "'") {
      if (!hasClosingQuote(content, index, character)) {
        index += 1;
        column += 1;
        tokens.push({
          text: character,
          kind: 'symbol',
          start,
          end: index,
          line: startLine,
          column: startColumn,
        });
        continue;
      }
      const quote = character;
      index += 1;
      column += 1;
      let closed = false;
      while (index < content.length) {
        if (content[index] === '\\') {
          index += 2;
          column += 2;
        } else if (content[index] === quote) {
          index += 1;
          column += 1;
          closed = true;
          break;
        } else if (content[index] === '\n') {
          break;
        } else {
          index += 1;
          column += 1;
        }
      }
      if (!closed) throw new Error('Unterminated Scala character literal');
      tokens.push({
        text: content.slice(start, index),
        kind: 'string',
        start,
        end: index,
        line: startLine,
        column: startColumn,
      });
      continue;
    }
    if (isIdentifierStart(character)) {
      index += 1;
      column += 1;
      while (index < content.length && isIdentifierPart(content[index] ?? '')) {
        index += 1;
        column += 1;
      }
      tokens.push({
        text: content.slice(start, index),
        kind: 'identifier',
        start,
        end: index,
        line: startLine,
        column: startColumn,
      });
      continue;
    }
    index += 1;
    column += 1;
    tokens.push({
      text: character,
      kind: 'symbol',
      start,
      end: index,
      line: startLine,
      column: startColumn,
    });
  }
  return tokens;
}

function hasClosingQuote(
  content: string,
  start: number,
  quote: string,
): boolean {
  let escaped = false;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index];
    if (character === '\n') return false;
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === quote) {
      return true;
    }
  }
  return false;
}

function directCallAt(
  tokens: readonly Token[],
  index: number,
):
  | {
      startIndex: number;
      nameIndex: number;
      endIndex: number;
      receiver: string | undefined;
      targetText: string;
    }
  | undefined {
  const token = tokens[index];
  if (!token || token.kind !== 'identifier' || scalaKeywords.has(token.text)) {
    return undefined;
  }
  let nameIndex = index;
  let startIndex = index;
  let receiver: string | undefined;
  if (tokens[index - 1]?.text === '.') {
    nameIndex = index;
    const receiverStart = memberReceiverStart(tokens, index - 2);
    if (receiverStart === undefined) return undefined;
    const candidateReceiver = tokens
      .slice(receiverStart, index - 1)
      .map(({ text }) => text)
      .join('');
    if (candidateReceiver.length <= 512) {
      startIndex = receiverStart;
      receiver = candidateReceiver;
    } else {
      startIndex = index;
    }
  }
  let open = nameIndex + 1;
  if (tokens[open]?.text === '[') {
    const close = matchingPair(tokens, open, '[', ']');
    if (close === undefined) return undefined;
    open = close + 1;
  }
  const delimiter = tokens[open]?.text;
  if (delimiter !== '(' && delimiter !== '{') return undefined;
  const close = matchingPair(
    tokens,
    open,
    delimiter,
    delimiter === '(' ? ')' : '}',
  );
  if (close === undefined) return undefined;
  const name = tokens[nameIndex]?.text ?? '';
  const targetText = receiver ? `${receiver}.${name}` : name;
  return {
    startIndex,
    nameIndex,
    endIndex: close,
    receiver,
    targetText,
  };
}

function memberReceiverStart(
  tokens: readonly Token[],
  end: number,
): number | undefined {
  const token = tokens[end];
  if (!token) return undefined;
  if (token.kind === 'identifier') {
    return tokens[end - 1]?.text === '.'
      ? memberReceiverStart(tokens, end - 2)
      : end;
  }
  const closingPairs: Record<string, [string, string]> = {
    ')': ['(', ')'],
    ']': ['[', ']'],
    '}': ['{', '}'],
  };
  const pair = closingPairs[token.text];
  if (!pair) return undefined;
  const open = matchingOpeningPair(tokens, end, pair[0], pair[1]);
  if (open === undefined) return undefined;
  const callable = tokens[open - 1];
  if (!callable || callable.kind !== 'identifier') return undefined;
  return tokens[open - 2]?.text === '.'
    ? memberReceiverStart(tokens, open - 3)
    : open - 1;
}

function matchingOpeningPair(
  tokens: readonly Token[],
  end: number,
  open: string,
  close: string,
): number | undefined {
  let depth = 0;
  for (let index = end; index >= 0; index -= 1) {
    if (tokens[index]?.text === close) depth += 1;
    if (tokens[index]?.text === open) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function findDeclarationHeaderEnd(
  tokens: readonly Token[],
  start: number,
): number {
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) break;
    if (
      (token.text === '{' || token.text === ':') &&
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0
    ) {
      return index;
    }
    if (
      token.text === ';' &&
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0
    ) {
      return index;
    }
    if (token.text === '(') parentheses += 1;
    else if (token.text === ')' && parentheses > 0) parentheses -= 1;
    else if (token.text === '[') brackets += 1;
    else if (token.text === ']' && brackets > 0) brackets -= 1;
    else if (token.text === '{') braces += 1;
    else if (token.text === '}' && braces > 0) braces -= 1;
    if (
      index > start &&
      token.line > (tokens[index - 1]?.line ?? token.line) + 1
    ) {
      return index - 1;
    }
  }
  return Math.max(start - 1, 0);
}

function findMethodHeaderEnd(tokens: readonly Token[], start: number): number {
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) break;
    if (
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0 &&
      (token.text === '=' || token.text === '{' || token.text === ';')
    ) {
      return index;
    }
    if (token.text === '(') parentheses += 1;
    else if (token.text === ')' && parentheses > 0) parentheses -= 1;
    else if (token.text === '[') brackets += 1;
    else if (token.text === ']' && brackets > 0) brackets -= 1;
    else if (token.text === '{') braces += 1;
    else if (token.text === '}' && braces > 0) braces -= 1;
    if (
      index > start &&
      parentheses === 0 &&
      brackets === 0 &&
      braces === 0 &&
      token.line > (tokens[index - 1]?.line ?? token.line) + 1
    ) {
      return index - 1;
    }
  }
  return Math.max(start - 1, 0);
}

function findMethodEnd(
  tokens: readonly Token[],
  headerEnd: number,
  classEnd: number,
  declarationColumn: number,
): number {
  const bodyOpen =
    tokens[headerEnd]?.text === '{'
      ? headerEnd
      : tokens[headerEnd]?.text === '=' && tokens[headerEnd + 1]?.text === '{'
        ? headerEnd + 1
        : undefined;
  if (bodyOpen !== undefined) {
    return matchingPair(tokens, bodyOpen, '{', '}') ?? classEnd;
  }
  const bodyStart = headerEnd + 1;
  const start = tokens[bodyStart];
  if (!start) return headerEnd;
  let end = bodyStart;
  let nestedBraces = 0;
  for (
    let index = bodyStart + 1;
    index <= classEnd && index < tokens.length;
    index += 1
  ) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    if (!token || !previous) break;
    if (token.text === '{') nestedBraces += 1;
    if (token.text === '}') {
      if (nestedBraces === 0) return index - 1;
      nestedBraces -= 1;
    }
    if (
      nestedBraces === 0 &&
      token.line > previous.line &&
      token.column <= declarationColumn &&
      [
        'def',
        'val',
        'var',
        'lazy',
        'override',
        'private',
        'protected',
        'final',
        '@',
      ].includes(token.text)
    ) {
      return index - 1;
    }
    end = index;
  }
  return end;
}

function nearestEnclosingClass(
  classes: ReadonlyMap<
    number,
    { fullName: string; end: number; declarationEnd: number }
  >,
  index: number,
): { fullName: string; end: number; declarationEnd: number } | undefined {
  return [...classes.entries()]
    .filter(([start, item]) => start < index && item.end >= index)
    .sort((a, b) => b[0] - a[0])[0]?.[1];
}

function nearestEnclosingMethod(
  methods: ReadonlyMap<number, { fullName: string; end: number }>,
  index: number,
): { fullName: string; end: number } | undefined {
  return [...methods.entries()]
    .filter(([start, item]) => start < index && item.end >= index)
    .sort((a, b) => b[0] - a[0])[0]?.[1];
}

function callContext(
  tokens: readonly Token[],
  callIndex: number,
  methodEnd: number,
): { branch?: string; asyncGroup?: string } {
  const callLine = tokens[callIndex]?.line;
  let branch: string | undefined;
  let asyncGroup: string | undefined;

  for (let index = callIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token || token.line !== callLine) break;
    if (token.text === 'else') {
      branch = 'else';
      break;
    }
    if (['match', 'try', 'catch', 'case'].includes(token.text)) {
      branch = token.text;
      break;
    }
    if (token.text === 'if') {
      let conditionOpen = index + 1;
      while (conditionOpen < callIndex && tokens[conditionOpen]?.text !== '(') {
        conditionOpen += 1;
      }
      const conditionClose = matchingPair(tokens, conditionOpen, '(', ')');
      if (conditionClose !== undefined && conditionClose < callIndex) {
        branch = 'if';
        break;
      }
    }
  }

  const asyncNames = new Set(['flatMap', 'map', 'sequence', 'zip', 'traverse']);
  for (let index = 0; index < callIndex && index <= methodEnd; index += 1) {
    const token = tokens[index];
    if (!token || !asyncNames.has(token.text)) continue;
    let open = index + 1;
    if (tokens[open]?.text === '[') {
      const typeArgumentsEnd = matchingPair(tokens, open, '[', ']');
      if (typeArgumentsEnd === undefined) continue;
      open = typeArgumentsEnd + 1;
    }
    const delimiter = tokens[open]?.text;
    if (delimiter !== '(' && delimiter !== '{') continue;
    const close = matchingPair(
      tokens,
      open,
      delimiter,
      delimiter === '(' ? ')' : '}',
    );
    if (close === undefined || callIndex >= close) continue;
    asyncGroup = token.text;
  }
  return {
    ...(branch ? { branch } : {}),
    ...(asyncGroup ? { asyncGroup } : {}),
  };
}

function matchingBraceIndex(tokens: readonly Token[], start: number): number {
  if (tokens[start]?.text === '{')
    return matchingPair(tokens, start, '{', '}') ?? tokens.length - 1;
  return tokens.length - 1;
}

function matchingPair(
  tokens: readonly Token[],
  start: number,
  open: string,
  close: string,
): number | undefined {
  if (tokens[start]?.text !== open) return undefined;
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index]?.text === open) depth += 1;
    if (tokens[index]?.text === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function findHeaderParameterOpen(
  tokens: readonly Token[],
  start: number,
  end: number,
): number | undefined {
  for (let index = start; index < end; index += 1) {
    if (tokens[index]?.text === '(') {
      const close = matchingPair(tokens, index, '(', ')');
      if (close === undefined) return undefined;
      const hasTypedParameter = splitTopLevel(
        tokens,
        index + 1,
        close,
        ',',
      ).some(({ start: parameterStart, end: parameterEnd }) =>
        tokens
          .slice(parameterStart, parameterEnd)
          .some((token) => token.text === ':'),
      );
      if (hasTypedParameter) return index;
      index = close;
      continue;
    }
    if (tokens[index]?.text === '[') {
      const close = matchingPair(tokens, index, '[', ']');
      if (close === undefined) return undefined;
      index = close;
    }
  }
  return undefined;
}

function splitTopLevel(
  tokens: readonly Token[],
  start: number,
  end: number,
  delimiter: string,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let itemStart = start;
  const stack: string[] = [];
  const closers: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let index = start; index < end; index += 1) {
    const text = tokens[index]?.text;
    if (!text) continue;
    if (closers[text]) stack.push(closers[text] ?? '');
    else if (stack.at(-1) === text) stack.pop();
    else if (text === delimiter && stack.length === 0) {
      if (index > itemStart) ranges.push({ start: itemStart, end: index });
      itemStart = index + 1;
    }
  }
  if (end > itemStart) ranges.push({ start: itemStart, end });
  return ranges;
}

function lineEndToken(tokens: readonly Token[], start: number): number {
  let index = start;
  while (
    index + 1 < tokens.length &&
    tokens[index + 1]?.line === tokens[start]?.line
  ) {
    index += 1;
  }
  return index;
}

function extractExtendsType(signature: string): string | undefined {
  const match = /\bextends\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(
    signature,
  );
  return match?.[1];
}

function classifyRouteSet(path: string): string {
  const filename = path.split('/').at(-1)?.toLocaleLowerCase('en-US') ?? '';
  if (filename === 'app.routes') return 'app';
  if (filename === 'prod.routes') return 'production-mounts';
  if (filename.includes('testonly') || filename.includes('test-only')) {
    return 'test-only';
  }
  if (filename === 'definition.routes') return 'definition';
  return 'other';
}

function stripHoconComment(line: string): string {
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (
      (character === '"' || character === "'") &&
      (!quote || quote === character)
    ) {
      quote = quote ? undefined : character;
      continue;
    }
    if (!quote && (character === '#' || line.startsWith('//', index))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function findScalaStringEnd(
  content: string,
  start: number,
  tripleQuoted: boolean,
  interpolated: boolean,
  raw: boolean,
): number {
  const delimiterLength = tripleQuoted ? 3 : 1;
  let index = start + delimiterLength;
  let interpolationDepth = 0;

  while (index < content.length) {
    if (interpolationDepth === 0) {
      if (tripleQuoted && content.startsWith('"""', index)) {
        let quoteCount = 3;
        while (content[index + quoteCount] === '"') quoteCount += 1;
        return index + quoteCount;
      }
      if (!tripleQuoted && content[index] === '"') return index + 1;
      if (interpolated && content.startsWith('${', index)) {
        interpolationDepth = 1;
        index += 2;
        continue;
      }
      if (content[index] === '\n' && !tripleQuoted) {
        throw new Error('Unterminated Scala string');
      }
      if (content[index] === '\\' && !raw) {
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (content.startsWith('//', index)) {
      while (index < content.length && content[index] !== '\n') index += 1;
      continue;
    }
    if (content.startsWith('/*', index)) {
      let commentDepth = 1;
      index += 2;
      while (index < content.length && commentDepth > 0) {
        if (content.startsWith('/*', index)) {
          commentDepth += 1;
          index += 2;
        } else if (content.startsWith('*/', index)) {
          commentDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (commentDepth !== 0)
        throw new Error('Unterminated Scala block comment');
      continue;
    }
    if (content[index] === '"' || content[index] === "'") {
      const quote = content[index] ?? '';
      if (quote === "'" && !hasClosingQuote(content, index, quote)) {
        index += 1;
        continue;
      }
      const nestedTriple = quote === '"' && content.startsWith('"""', index);
      const prefix = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(
        content.slice(0, index),
      )?.[1];
      index =
        quote === '"'
          ? findScalaStringEnd(
              content,
              index,
              nestedTriple,
              prefix !== undefined,
              prefix === 'raw',
            )
          : consumeScalaCharacter(content, index);
      continue;
    }
    if (content.startsWith('${', index)) {
      interpolationDepth += 1;
      index += 2;
      continue;
    }
    if (content[index] === '{') interpolationDepth += 1;
    else if (content[index] === '}') interpolationDepth -= 1;
    index += 1;
  }

  throw new Error('Unterminated Scala interpolated string');
}

function consumeScalaCharacter(content: string, start: number): number {
  let index = start + 1;
  while (index < content.length && content[index] !== '\n') {
    if (content[index] === '\\') index += 2;
    else if (content[index] === "'") return index + 1;
    else index += 1;
  }
  throw new Error('Unterminated Scala character literal');
}

function hasTrailingAfterQuotedLiteral(value: string): boolean {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.length < 2) return false;
  let escaped = false;
  for (let index = 1; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === quote) {
      return index !== trimmed.length - 1;
    }
  }
  return false;
}

function normalizedLines(content: string): string[] {
  return content.replace(/\r\n?/g, '\n').split('\n');
}

function qualify(packageName: string, symbolName: string): string {
  return packageName ? `${packageName}.${symbolName}` : symbolName;
}

function structuredBlock(
  key: string,
  text: string,
  locator: EvidenceLocator,
  truncated = false,
): NormalizedBlock {
  return truncated
    ? { key, kind: 'structured-value', text, locator, truncated: true }
    : { key, kind: 'structured-value', text, locator };
}

function boundedBlocks(
  blocks: readonly NormalizedBlock[],
  sourceName: string,
): NormalizedBlock[] {
  if (blocks.length > maxFactsPerDocument) {
    throw new Error(
      `Structured parser evidence exceeds ${maxFactsPerDocument} facts in ${sourceName}`,
    );
  }
  const encoder = new TextEncoder();
  let payloadBytes = 0;
  for (const block of blocks) {
    validateLocatorBounds(block.locator, sourceName);
    payloadBytes += encoder.encode(JSON.stringify(block)).byteLength;
    if (payloadBytes > maxEvidencePayloadBytes) {
      throw new Error(
        `Structured parser evidence exceeds ${maxEvidencePayloadBytes} bytes in ${sourceName}`,
      );
    }
  }
  return [...blocks];
}

function validateLocatorBounds(
  locator: EvidenceLocator,
  sourceName: string,
): void {
  const within = (value: string | undefined, maximum: number) =>
    value === undefined || value.length <= maximum;
  const invalidField = (() => {
    switch (locator.kind) {
      case 'scala-symbol':
        if (!within(locator.packageName, 512)) return 'packageName';
        if (!within(locator.symbolName, 1_024)) return 'symbolName';
        if (!within(locator.enclosingSymbol, 1_024)) return 'enclosingSymbol';
        if (!within(locator.signature, maxEvidenceText)) return 'signature';
        if (!within(locator.extendsType, 1_024)) return 'extendsType';
        return undefined;
      case 'scala-call-site':
        if (!within(locator.packageName, 512)) return 'packageName';
        if (!within(locator.enclosingSymbol, 1_024)) return 'enclosingSymbol';
        if (!within(locator.targetText, 1_024)) return 'targetText';
        if (!within(locator.methodName, 256)) return 'methodName';
        if (!within(locator.receiver, 512)) return 'receiver';
        if (!within(locator.branchContext, 64)) return 'branchContext';
        if (!within(locator.asyncGroup, 64)) return 'asyncGroup';
        return undefined;
      case 'play-route':
        if (!within(locator.routeSet, 64)) return 'routeSet';
        if (!within(locator.method, 16)) return 'method';
        if (!within(locator.declaredPath, 4_096)) return 'declaredPath';
        if (!within(locator.handlerExpression, 2_048))
          return 'handlerExpression';
        if (!within(locator.mountPrefix, 4_096)) return 'mountPrefix';
        if (!within(locator.includeTarget, 1_024)) return 'includeTarget';
        return undefined;
      case 'hocon-key':
        if (!within(locator.key, 1_024)) return 'key';
        if (!within(locator.literalValue, maxEvidenceText))
          return 'literalValue';
        if ((locator.substitutions?.length ?? 0) > 50) return 'substitutions';
        if (
          !(locator.substitutions ?? []).every((value) => within(value, 1_024))
        ) {
          return 'substitutions';
        }
        return undefined;
      default:
        return undefined;
    }
  })();
  if (invalidField !== undefined) {
    throw new Error(
      `Structured parser locator field ${locator.kind}.${invalidField} exceeds supported bounds in ${sourceName}`,
    );
  }
}

function isIdentifierStart(value: string): boolean {
  return /[A-Za-z_$]/.test(value);
}

function isIdentifierPart(value: string): boolean {
  return /[A-Za-z0-9_$]/.test(value);
}

const scalaKeywords = new Set([
  'abstract',
  'case',
  'catch',
  'class',
  'def',
  'do',
  'else',
  'extends',
  'false',
  'final',
  'finally',
  'for',
  'forSome',
  'if',
  'implicit',
  'import',
  'lazy',
  'match',
  'new',
  'null',
  'object',
  'override',
  'package',
  'private',
  'protected',
  'return',
  'sealed',
  'super',
  'this',
  'throw',
  'trait',
  'try',
  'true',
  'type',
  'val',
  'var',
  'while',
  'with',
  'yield',
]);
