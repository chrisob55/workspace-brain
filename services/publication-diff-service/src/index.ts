import {
  CatalogueIntegrityError,
  type CataloguePage,
  type PublicationComparisonPageRequest,
  type PublicationDiffStore,
  type PublicationSnapshotReader,
} from '@workspace-brain/catalogue';
import {
  createPublicationDiffId,
  publicationComparisonHeader,
  type PublicationComparison,
  type PublicationDiff,
} from '@workspace-brain/domain-evolution';

import {
  comparePublicationSnapshots,
  publicationDiffContent,
  stableJson,
} from './engine.js';

export * from './engine.js';

export type PublicationDiffServiceDependencies = {
  readonly snapshots: PublicationSnapshotReader;
  readonly store: PublicationDiffStore;
  readonly now?: () => Date;
  readonly createId?: () => string;
};

export type PublicationDiffResult =
  | { readonly status: 'found'; readonly diff: PublicationDiff }
  | {
      readonly status: 'publication-not-found';
      readonly publicationId: string;
    };

export interface PublicationDiffService {
  /**
   * Returns the diff of `from` → `to`, generating and persisting it when no
   * current diff is stored. A stored diff is reused only when regenerating it
   * from the immutable publications yields the identical content hash.
   */
  compare(
    fromPublicationId: string,
    toPublicationId: string,
  ): Promise<PublicationDiffResult>;
  /** Returns a stored diff after verifying it against its publications. */
  getDiff(diffId: string): Promise<PublicationDiff | undefined>;
  /**
   * Lists stored comparison headers involving a publication, each verified
   * against a regeneration from its immutable publications.
   */
  listComparisons(
    request: PublicationComparisonPageRequest,
  ): Promise<CataloguePage<PublicationComparison>>;
}

export function createPublicationDiffService(
  dependencies: PublicationDiffServiceDependencies,
): PublicationDiffService {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? createPublicationDiffId;

  // A corrupt stored diff is disposable: treat it as absent and replace it.
  async function findStoredDiff(
    fromPublicationId: string,
    toPublicationId: string,
  ): Promise<PublicationDiff | undefined> {
    try {
      return await dependencies.store.findPublicationDiff(
        fromPublicationId,
        toPublicationId,
      );
    } catch (error) {
      if (error instanceof CatalogueIntegrityError) {
        return undefined;
      }
      throw error;
    }
  }

  return {
    async compare(fromPublicationId, toPublicationId) {
      const from =
        await dependencies.snapshots.getPublicationSnapshot(fromPublicationId);
      if (from === undefined) {
        return {
          status: 'publication-not-found',
          publicationId: fromPublicationId,
        };
      }
      const to =
        await dependencies.snapshots.getPublicationSnapshot(toPublicationId);
      if (to === undefined) {
        return {
          status: 'publication-not-found',
          publicationId: toPublicationId,
        };
      }
      const content = comparePublicationSnapshots(from, to);
      const stored = await findStoredDiff(
        from.publication.id,
        to.publication.id,
      );
      if (
        stored !== undefined &&
        stableJson(publicationDiffContent(stored)) === stableJson(content)
      ) {
        return { status: 'found', diff: stored };
      }
      const diff = await dependencies.store.savePublicationDiff(
        {
          ...content,
          id: createId() as PublicationDiff['id'],
          generatedAt: now().toISOString(),
        },
        stored?.id,
      );
      return { status: 'found', diff };
    },

    async getDiff(diffId) {
      const stored = await dependencies.store.getPublicationDiff(diffId);
      if (stored === undefined) {
        return undefined;
      }
      const [from, to] = await Promise.all([
        dependencies.snapshots.getPublicationSnapshot(stored.fromPublicationId),
        dependencies.snapshots.getPublicationSnapshot(stored.toPublicationId),
      ]);
      if (from === undefined || to === undefined) {
        throw new CatalogueIntegrityError(
          `Publication diff ${diffId} references a publication that does not exist`,
        );
      }
      const regenerated = comparePublicationSnapshots(from, to);
      if (
        stableJson(publicationDiffContent(stored)) !== stableJson(regenerated)
      ) {
        throw new CatalogueIntegrityError(
          `Publication diff ${diffId} does not match its publications`,
        );
      }
      return stored;
    },

    async listComparisons(request) {
      const page = await dependencies.store.listPublicationComparisons(request);
      const snapshots = new Map<
        string,
        ReturnType<PublicationSnapshotReader['getPublicationSnapshot']>
      >();
      const snapshot = (publicationId: string) => {
        let pending = snapshots.get(publicationId);
        if (pending === undefined) {
          pending =
            dependencies.snapshots.getPublicationSnapshot(publicationId);
          snapshots.set(publicationId, pending);
        }
        return pending;
      };
      for (const comparison of page.items) {
        const [from, to] = await Promise.all([
          snapshot(comparison.fromPublicationId),
          snapshot(comparison.toPublicationId),
        ]);
        if (from === undefined || to === undefined) {
          throw new CatalogueIntegrityError(
            `Publication diff ${comparison.id} references a publication that does not exist`,
          );
        }
        const expected = publicationComparisonHeader({
          ...comparePublicationSnapshots(from, to),
          id: comparison.id,
          generatedAt: comparison.generatedAt,
        });
        if (stableJson(expected) !== stableJson(comparison)) {
          throw new CatalogueIntegrityError(
            `Publication diff ${comparison.id} does not match its publications`,
          );
        }
      }
      return page;
    },
  };
}
