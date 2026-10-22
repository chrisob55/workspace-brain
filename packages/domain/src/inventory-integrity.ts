import { createHash } from 'node:crypto';

import type { DocumentCandidate, RepositoryCandidate } from './index.js';

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) {
    throw new Error('Inventory content cannot be serialized as JSON');
  }
  return serialized;
}

export function inventoryChunkChecksum(
  repositories: readonly RepositoryCandidate[],
  documents: readonly DocumentCandidate[],
): string {
  return sha256({
    repositories: sortByPath(repositories),
    documents: sortByPath(documents),
  });
}

export function completeInventoryChecksum(
  sourceId: string,
  discoveredAt: string,
  repositories: readonly RepositoryCandidate[],
  documents: readonly DocumentCandidate[],
): string {
  return sha256({
    sourceId,
    discoveredAt,
    repositories: sortByPath(repositories),
    documents: sortByPath(documents),
  });
}

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function sortByPath<T extends { readonly path: string }>(
  items: readonly T[],
): readonly T[] {
  return [...items].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
