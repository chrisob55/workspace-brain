import type {
  PublicationDiffStore,
  PublicationSnapshot,
} from '@workspace-brain/catalogue';
import { CatalogueIntegrityError } from '@workspace-brain/catalogue';
import {
  createEntityVersionId,
  createKnowledgeEntityId,
  createKnowledgeModelId,
  createKnowledgePublicationId,
  createKnowledgeRelationshipId,
  createRelationshipVersionId,
  type EntityVersionId,
  type KnowledgeEntity,
  type KnowledgeEntityId,
  type KnowledgeModelId,
  type KnowledgeRelationship,
  type KnowledgeRelationshipId,
  type PublishedEntity,
  type PublishedRelationship,
  type RelationshipVersionId,
} from '@workspace-brain/domain';
import {
  publicationComparisonHeader,
  type PublicationComparison,
  type PublicationDiff,
} from '@workspace-brain/domain-evolution';
import { describe, expect, it } from 'vitest';

import {
  comparePublicationSnapshots,
  createPublicationDiffService,
  publicationDiffContent,
  PublicationDiffScopeError,
} from './index.js';

const modelId = createKnowledgeModelId();
const otherModelId = createKnowledgeModelId();
const [serviceId, lodashId, leftPadId, reactId, unchangedId] = sortedIds(
  5,
  createKnowledgeEntityId,
);
const [depLodashId, depLeftPadId, depReactId] = sortedIds(
  3,
  createKnowledgeRelationshipId,
);

describe('comparePublicationSnapshots', () => {
  it('classifies added, removed, modified and unchanged knowledge', () => {
    const { from, to } = evolvedPublications();
    const diff = comparePublicationSnapshots(from, to);

    expect(diff.summary).toEqual({
      entitiesAdded: 1,
      entitiesRemoved: 1,
      entitiesModified: 1,
      entitiesUnchanged: 2,
      relationshipsAdded: 1,
      relationshipsRemoved: 1,
      relationshipsModified: 1,
      relationshipsUnchanged: 0,
    });
    expect(
      diff.entityChanges.map(({ entityId, changeType, changedFields }) => ({
        entityId,
        changeType,
        changedFields,
      })),
    ).toEqual([
      { entityId: lodashId, changeType: 'MODIFIED', changedFields: ['name'] },
      { entityId: leftPadId, changeType: 'REMOVED', changedFields: [] },
      { entityId: reactId, changeType: 'ADDED', changedFields: [] },
    ]);
    expect(
      diff.relationshipChanges.map(
        ({ relationshipId, changeType, changedFields }) => ({
          relationshipId,
          changeType,
          changedFields,
        }),
      ),
    ).toEqual([
      {
        relationshipId: depLodashId,
        changeType: 'MODIFIED',
        changedFields: ['confidence'],
      },
      {
        relationshipId: depLeftPadId,
        changeType: 'REMOVED',
        changedFields: [],
      },
      { relationshipId: depReactId, changeType: 'ADDED', changedFields: [] },
    ]);
    const removed = diff.entityChanges.find(
      (change) => change.changeType === 'REMOVED',
    )!;
    expect(removed.from).not.toBeNull();
    expect(removed.to).toBeNull();
    expect(removed.name).toBe('left-pad');
    const added = diff.relationshipChanges.find(
      (change) => change.changeType === 'ADDED',
    )!;
    expect(added.from).toBeNull();
    expect(added.to?.versionNumber).toBe(1);
    expect(added.sourceEntityId).toBe(serviceId);
    expect(added.targetEntityId).toBe(reactId);
    const modified = diff.entityChanges[0]!;
    expect(modified.from?.versionNumber).toBe(1);
    expect(modified.to?.versionNumber).toBe(2);
    expect(modified.from?.contentHash).not.toBe(modified.to?.contentHash);
    expect(diff.fromPublicationId).toBe(from.publication.id);
    expect(diff.toPublicationId).toBe(to.publication.id);
    expect(diff.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('treats a new version with identical content as unchanged', () => {
    const { from, to } = evolvedPublications();
    const unchangedChanges = comparePublicationSnapshots(
      from,
      to,
    ).entityChanges.filter((change) => change.entityId === unchangedId);
    expect(unchangedChanges).toEqual([]);
  });

  it('is deterministic regardless of snapshot member ordering', () => {
    const { from, to } = evolvedPublications();
    const reversed: PublicationSnapshot = {
      ...to,
      entities: [...to.entities].reverse(),
      relationships: [...to.relationships].reverse(),
    };
    expect(comparePublicationSnapshots(from, reversed)).toEqual(
      comparePublicationSnapshots(from, to),
    );
  });

  it('reverses direction symmetrically', () => {
    const { from, to } = evolvedPublications();
    const backwards = comparePublicationSnapshots(to, from);
    expect(backwards.summary.entitiesAdded).toBe(1);
    expect(backwards.summary.entitiesRemoved).toBe(1);
    expect(
      backwards.entityChanges.find((change) => change.entityId === reactId)
        ?.changeType,
    ).toBe('REMOVED');
  });

  it('produces an empty diff for a publication compared with itself', () => {
    const { from } = evolvedPublications();
    const diff = comparePublicationSnapshots(from, from);
    expect(diff.entityChanges).toEqual([]);
    expect(diff.relationshipChanges).toEqual([]);
    expect(diff.summary.entitiesUnchanged).toBe(from.entities.length);
  });

  it('rejects publications from different Knowledge Models', () => {
    const { from } = evolvedPublications();
    const foreign = snapshot(otherModelId, 1, [], []);
    expect(() => comparePublicationSnapshots(from, foreign)).toThrow(
      PublicationDiffScopeError,
    );
  });

  it('rejects snapshots that contain an identity twice', () => {
    const { from, to } = evolvedPublications();
    const duplicated: PublicationSnapshot = {
      ...to,
      entities: [...to.entities, to.entities[0]!],
    };
    expect(() => comparePublicationSnapshots(from, duplicated)).toThrow(
      /more than once/,
    );
  });
});

describe('createPublicationDiffService', () => {
  it('persists a generated diff and reuses it on regeneration', async () => {
    const { service, store, from, to } = serviceFixture();
    const first = await service.compare(from.publication.id, to.publication.id);
    const second = await service.compare(
      from.publication.id,
      to.publication.id,
    );
    expect(first.status).toBe('found');
    expect(second).toEqual(first);
    expect(store.saves).toBe(1);
  });

  it('regenerates an identical diff after the store is discarded', async () => {
    const { service, store, from, to } = serviceFixture();
    const first = await service.compare(from.publication.id, to.publication.id);
    store.clear();
    const regenerated = await service.compare(
      from.publication.id,
      to.publication.id,
    );
    if (first.status !== 'found' || regenerated.status !== 'found') {
      throw new Error('expected diffs');
    }
    expect(regenerated.diff.id).not.toBe(first.diff.id);
    expect(publicationDiffContent(regenerated.diff)).toEqual(
      publicationDiffContent(first.diff),
    );
  });

  it('replaces a stored diff whose content no longer matches', async () => {
    const { service, store, from, to } = serviceFixture();
    const first = await service.compare(from.publication.id, to.publication.id);
    if (first.status !== 'found') throw new Error('expected diff');
    store.tamper(first.diff.id, { contentHash: 'f'.repeat(64) });
    const replaced = await service.compare(
      from.publication.id,
      to.publication.id,
    );
    if (replaced.status !== 'found') throw new Error('expected diff');
    expect(replaced.diff.id).not.toBe(first.diff.id);
    expect(replaced.diff.contentHash).toBe(first.diff.contentHash);
  });

  it('replaces a stored diff whose details were altered', async () => {
    const { service, from, to, store } = serviceFixture();
    const first = await service.compare(from.publication.id, to.publication.id);
    if (first.status !== 'found') throw new Error('expected diff');
    store.tamper(first.diff.id, { entityChanges: [] });
    const repaired = await service.compare(
      from.publication.id,
      to.publication.id,
    );
    if (repaired.status !== 'found') throw new Error('expected diff');
    expect(repaired.diff.id).not.toBe(first.diff.id);
    expect(repaired.diff.entityChanges).toEqual(first.diff.entityChanges);
  });

  it('reports missing publications without persisting anything', async () => {
    const { service, store, from } = serviceFixture();
    const missing = createKnowledgePublicationId();
    expect(await service.compare(from.publication.id, missing)).toEqual({
      status: 'publication-not-found',
      publicationId: missing,
    });
    expect(await service.compare(missing, from.publication.id)).toEqual({
      status: 'publication-not-found',
      publicationId: missing,
    });
    expect(store.saves).toBe(0);
  });

  it('verifies stored diffs against their publications on retrieval', async () => {
    const { service, store, from, to } = serviceFixture();
    const created = await service.compare(
      from.publication.id,
      to.publication.id,
    );
    if (created.status !== 'found') throw new Error('expected diff');
    expect(await service.getDiff(created.diff.id)).toEqual(created.diff);
    expect(await service.getDiff(createKnowledgePublicationId())).toBe(
      undefined,
    );
    store.tamper(created.diff.id, {
      summary: { ...created.diff.summary, entitiesAdded: 99 },
    });
    await expect(service.getDiff(created.diff.id)).rejects.toBeInstanceOf(
      CatalogueIntegrityError,
    );
  });

  it('lists comparisons through the store', async () => {
    const { service, from, to } = serviceFixture();
    await service.compare(from.publication.id, to.publication.id);
    await service.compare(to.publication.id, from.publication.id);
    const page = await service.listComparisons({
      publicationId: from.publication.id,
      limit: 10,
    });
    expect(page.items).toHaveLength(2);
  });
});

function serviceFixture() {
  const { from, to } = evolvedPublications();
  const snapshots = new Map(
    [from, to].map((item) => [item.publication.id as string, item]),
  );
  const store = new MemoryDiffStore();
  let tick = 0;
  const service = createPublicationDiffService({
    snapshots: {
      getPublicationSnapshot: async (id) => snapshots.get(id),
    },
    store,
    now: () => new Date(Date.UTC(2025, 0, 1, 0, 0, tick++)),
  });
  return { service, store, from, to };
}

class MemoryDiffStore implements PublicationDiffStore {
  saves = 0;
  private readonly diffs = new Map<string, PublicationDiff>();

  clear(): void {
    this.diffs.clear();
  }

  tamper(id: string, patch: Partial<PublicationDiff>): void {
    this.diffs.set(id, { ...this.diffs.get(id)!, ...patch });
  }

  async findPublicationDiff(fromId: string, toId: string) {
    return [...this.diffs.values()].find(
      (diff) =>
        diff.fromPublicationId === fromId && diff.toPublicationId === toId,
    );
  }

  async getPublicationDiff(id: string) {
    return this.diffs.get(id);
  }

  async listPublicationComparisons(request: {
    publicationId: string;
    afterId?: string;
    limit: number;
  }) {
    const items: PublicationComparison[] = [...this.diffs.values()]
      .filter(
        (diff) =>
          diff.fromPublicationId === request.publicationId ||
          diff.toPublicationId === request.publicationId,
      )
      .sort((left, right) => (left.id < right.id ? -1 : 1))
      .map(publicationComparisonHeader);
    return { items: items.slice(0, request.limit) };
  }

  async savePublicationDiff(diff: PublicationDiff, invalidDiffId?: string) {
    const existing = await this.findPublicationDiff(
      diff.fromPublicationId,
      diff.toPublicationId,
    );
    if (
      existing?.contentHash === diff.contentHash &&
      existing.id !== invalidDiffId
    ) {
      return existing;
    }
    if (existing !== undefined) {
      this.diffs.delete(existing.id);
    }
    this.saves += 1;
    this.diffs.set(diff.id, diff);
    return diff;
  }
}

function evolvedPublications(): {
  from: PublicationSnapshot;
  to: PublicationSnapshot;
} {
  const service1 = entityVersion(serviceId, 'service', 1);
  const lodash1 = entityVersion(lodashId, 'lodash', 1);
  const leftPad1 = entityVersion(leftPadId, 'left-pad', 1);
  const unchanged1 = entityVersion(unchangedId, 'stable', 1);
  const lodash2 = entityVersion(lodashId, 'lodash-es', 2);
  const unchanged2 = entityVersion(unchangedId, 'stable', 2);
  const react1 = entityVersion(reactId, 'react', 1);
  const depLodash1 = relationshipVersion(depLodashId, lodashId, 1, 0.5);
  const depLeftPad1 = relationshipVersion(depLeftPadId, leftPadId, 1, 0.5);
  const depLodash2 = relationshipVersion(depLodashId, lodashId, 2, 0.9);
  const depReact1 = relationshipVersion(depReactId, reactId, 1, 0.5);
  return {
    from: snapshot(
      modelId,
      1,
      [service1, lodash1, leftPad1, unchanged1],
      [depLodash1, depLeftPad1],
    ),
    to: snapshot(
      modelId,
      2,
      [unchanged2, react1, lodash2, service1],
      [depReact1, depLodash2],
    ),
  };
}

function snapshot(
  knowledgeModelId: KnowledgeModelId,
  version: number,
  entities: readonly Omit<PublishedEntity, 'publicationId'>[],
  relationships: readonly Omit<PublishedRelationship, 'publicationId'>[],
): PublicationSnapshot {
  const publicationId = createKnowledgePublicationId();
  return {
    publication: {
      id: publicationId,
      knowledgeModelId,
      version,
      schemaVersion: 1,
      status: 'published',
      contentHash: String(version).repeat(64).slice(0, 64),
      entityVersionIds: entities.map((item) => item.entityVersionId),
      relationshipVersionIds: relationships.map(
        (item) => item.relationshipVersionId,
      ),
      publishedAt: '2025-01-01T00:00:00.000Z',
    },
    entities: entities.map((item) => ({ ...item, publicationId })),
    relationships: relationships.map((item) => ({ ...item, publicationId })),
  };
}

function entityVersion(
  id: KnowledgeEntityId,
  name: string,
  versionNumber: number,
): Omit<PublishedEntity, 'publicationId'> {
  const entityVersionId: EntityVersionId = createEntityVersionId();
  const entity: KnowledgeEntity = {
    id,
    knowledgeModelId: modelId,
    type: 'package',
    name,
    sourceEvidenceIds: [],
    provenance: [],
    lifecycleStatus: 'observed',
    currentVersionId: entityVersionId,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: `2025-01-0${versionNumber}T00:00:00.000Z`,
  };
  return { entityVersionId, versionNumber, entity };
}

function relationshipVersion(
  id: KnowledgeRelationshipId,
  targetEntityId: KnowledgeEntityId,
  versionNumber: number,
  confidence: number,
): Omit<PublishedRelationship, 'publicationId'> {
  const relationshipVersionId: RelationshipVersionId =
    createRelationshipVersionId();
  const relationship: KnowledgeRelationship = {
    id,
    knowledgeModelId: modelId,
    type: 'DEPENDS_ON',
    sourceEntityId: serviceId,
    targetEntityId,
    sourceEvidenceIds: [],
    provenance: [],
    confidence,
    lifecycleStatus: 'observed',
    currentVersionId: relationshipVersionId,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: `2025-01-0${versionNumber}T00:00:00.000Z`,
  };
  return { relationshipVersionId, versionNumber, relationship };
}

function sortedIds<T extends string>(count: number, create: () => T): T[] {
  return Array.from({ length: count }, create).sort();
}
