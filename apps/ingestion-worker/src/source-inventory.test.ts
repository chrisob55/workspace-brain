import {
  createSourceId,
  type DocumentCandidate,
  type RepositoryCandidate,
  type ScanResult,
} from '@workspace-brain/domain';
import { describe, expect, it } from 'vitest';

import {
  createSourceInventoryTransfer,
  InventoryPayloadBudgetExceededError,
  serializedSize,
} from './source-inventory.js';

const startedAt = '2026-10-19T09:00:00.000Z';
const scanId = 'scan-123';
const payloadBudgetBytes = 8_000;

describe('source inventory transfer chunking', () => {
  it('orders records deterministically and returns the same plan for identical input', () => {
    const sourceId = createSourceId();
    const scan = createScan(
      [repository('z-repository'), repository('a-repository')],
      [document('z-document'), document('a-document')],
      sourceId,
    );
    const reversedScan = createScan(
      [...scan.repositories].reverse(),
      [...scan.documents].reverse(),
      sourceId,
    );

    const first = plan(scan, payloadBudgetBytes);
    const second = plan(reversedScan, payloadBudgetBytes);

    expect(first.chunks).toEqual(second.chunks);
    expect(first.inventoryChecksum).toBe(second.inventoryChecksum);
    expect(
      first.chunks
        .flatMap((chunk) => chunk.payload.repositories)
        .map(({ path }) => path),
    ).toEqual(['a-repository', 'z-repository']);
    expect(
      first.chunks
        .flatMap((chunk) => chunk.payload.documents)
        .map(({ path }) => path),
    ).toEqual(['a-document', 'z-document']);
  });

  it('measures UTF-8 bytes for the complete serialized event envelope', () => {
    const scan = createScan([], [document('root/🧠.md')]);
    const initial = plan(scan, 20_000);
    const event = initial.chunks[0];
    if (event === undefined) {
      throw new Error('Expected one inventory chunk');
    }
    const exactBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');

    expect(serializedSize(event)).toBe(exactBytes);
    expect(exactBytes).toBeGreaterThan(JSON.stringify(event).length);
    expect(plan(scan, exactBytes).chunks).toHaveLength(1);
    expect(() => plan(scan, exactBytes - 1)).toThrow(
      InventoryPayloadBudgetExceededError,
    );
  });

  it('chunks differently sized document entries by complete event byte size', () => {
    const scan = createScan(
      [],
      [
        document(`root/${'a'.repeat(1_500)}/a.md`),
        document(`root/${'b'.repeat(3_000)}/b.md`),
        document(`root/${'c'.repeat(700)}/c.md`),
      ],
    );

    const transfer = plan(scan, 5_000);

    expect(transfer.chunks.length).toBeGreaterThan(1);
    expect(
      transfer.chunks.every((chunk) => serializedSize(chunk) <= 5_000),
    ).toBe(true);
    expect(
      transfer.chunks
        .flatMap((chunk) => chunk.payload.documents)
        .map(({ path }) => path),
    ).toEqual(scan.documents.map(({ path }) => path).sort());
  });

  it('rejects one record that cannot fit without splitting its metadata', () => {
    const scan = createScan(
      [],
      [document(`root/${'x'.repeat(20_000)}/too-large.md`)],
    );

    expect(() => plan(scan, 8_000)).toThrow(
      expect.objectContaining({
        name: 'InventoryPayloadBudgetExceededError',
        entryTooLarge: true,
      }),
    );
  });

  it('verifies chunk and whole-inventory checksums and changes them when content changes', () => {
    const scan = createScan([], [document('root/a.md')]);
    const original = plan(scan, payloadBudgetBytes);
    const changed = plan(
      createScan(
        [],
        [{ ...scan.documents[0]!, fingerprint: 'd'.repeat(64) }],
        scan.sourceId,
      ),
      payloadBudgetBytes,
    );

    expect(original.chunks[0]?.payload.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(original.inventoryChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(changed.inventoryChecksum).not.toBe(original.inventoryChecksum);
    expect(changed.chunks[0]?.payload.checksum).not.toBe(
      original.chunks[0]?.payload.checksum,
    );
    expect(plan(scan, payloadBudgetBytes).chunks).toEqual(original.chunks);
  });

  it('splits the representative 21-repository, 3,952-document inventory below 1 MiB', () => {
    const scan = createLargeScan();
    const completeBytes = Buffer.byteLength(JSON.stringify(scan), 'utf8');
    const transfer = plan(scan, 838_860);

    expect(scan.repositories).toHaveLength(21);
    expect(scan.documents).toHaveLength(3_952);
    expect(completeBytes).toBeGreaterThan(1_048_576);
    expect(transfer.chunks.length).toBeGreaterThan(1);
    expect(transfer.largestEventBytes).toBeLessThanOrEqual(838_860);
    expect(
      transfer.chunks.every((chunk) => serializedSize(chunk) <= 838_860),
    ).toBe(true);
    expect(transfer.chunks.flatMap((chunk) => chunk.payload.documents)).toEqual(
      [...scan.documents].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    );
  }, 30_000);
});

function plan(scan: ScanResult, payloadBudgetBytes: number) {
  return createSourceInventoryTransfer(scan, {
    scanId,
    correlationId: scanId,
    startedAt,
    completedAt: '2026-10-19T09:00:03.000Z',
    durationMilliseconds: 3_000,
    payloadBudgetBytes,
  });
}

function createScan(
  repositories: readonly RepositoryCandidate[],
  documents: readonly DocumentCandidate[],
  sourceId = createSourceId(),
): ScanResult {
  return {
    sourceId,
    discoveredAt: startedAt,
    repositories,
    documents,
  };
}

function repository(path: string): RepositoryCandidate {
  return {
    path,
    repositoryType: 'git',
    fingerprint: 'a'.repeat(64),
    discoveryMethod: 'filesystem',
  };
}

function document(path: string): DocumentCandidate {
  return {
    path,
    filename: path.split('/').at(-1) ?? path,
    extension: '.md',
    sizeBytes: 1024,
    modifiedAt: startedAt,
    fingerprint: 'b'.repeat(64),
    discoveryMethod: 'filesystem',
  };
}

function createLargeScan(): ScanResult {
  const repositories = Array.from({ length: 21 }, (_, index) =>
    repository(`root/repository-${String(index).padStart(2, '0')}`),
  );
  const documents = Array.from({ length: 3_952 }, (_, index) => {
    const repositoryIndex = index % repositories.length;
    return document(
      `root/repository-${String(repositoryIndex).padStart(2, '0')}/document-${String(index).padStart(4, '0')}-${'x'.repeat(240)}.md`,
    );
  });
  return createScan(repositories, documents);
}
