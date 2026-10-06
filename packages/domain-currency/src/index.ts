import { createHash } from 'node:crypto';

import type {
  DocumentId,
  DocumentVersionId,
  EntityVersionId,
  KnowledgeEntityId,
  KnowledgeModelId,
  KnowledgeProvenance,
  KnowledgePublication,
  KnowledgePublicationId,
  KnowledgeRelationshipId,
  PublishedEntity,
  PublishedRelationship,
  RelationshipVersionId,
} from '@workspace-brain/domain';

/**
 * Publication Currency vocabulary (Slice 7).
 *
 * Publication currency reports whether the document versions that support an
 * immutable Knowledge Publication are still the versions the catalogue treats
 * as authoritative. The catalogue's current-version pointer
 * (`document_current_versions.document_version_id`) and its `revision` are the
 * only authority. Timestamps, identifier order, filesystem state and
 * processing order are never consulted.
 *
 * Currency is a derived, on-demand observation. It is not a lifecycle or
 * governance status and is never written back to knowledge.
 */

export const publicationCurrencySchemaVersion = 1 as const;

export const CurrencyState = {
  CURRENT: 'CURRENT',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type CurrencyState = (typeof CurrencyState)[keyof typeof CurrencyState];
export const currencyStates = [
  CurrencyState.CURRENT,
  CurrencyState.STALE,
  CurrencyState.UNKNOWN,
] as const;

export const CurrencyReason = {
  CONTENT_CHANGED: 'CONTENT_CHANGED',
  PROCESSING_CHANGED: 'PROCESSING_CHANGED',
  CURRENT_VERSION_UNAVAILABLE: 'CURRENT_VERSION_UNAVAILABLE',
  DOCUMENT_REMOVED: 'DOCUMENT_REMOVED',
  CURRENT_VERSION_UNRESOLVABLE: 'CURRENT_VERSION_UNRESOLVABLE',
} as const;
export type CurrencyReason =
  (typeof CurrencyReason)[keyof typeof CurrencyReason];
export const staleCurrencyReasons = [
  CurrencyReason.CONTENT_CHANGED,
  CurrencyReason.PROCESSING_CHANGED,
] as const;
export const unknownCurrencyReasons = [
  CurrencyReason.CURRENT_VERSION_UNAVAILABLE,
  CurrencyReason.DOCUMENT_REMOVED,
  CurrencyReason.CURRENT_VERSION_UNRESOLVABLE,
] as const;
export const currencyReasons = [
  ...staleCurrencyReasons,
  ...unknownCurrencyReasons,
] as const;

export const currencyObjectTypes = ['entity', 'relationship'] as const;
export type CurrencyObjectType = (typeof currencyObjectTypes)[number];

/** A stored document version as recorded in the catalogue (hash only, no content). */
export type CatalogueDocumentVersion = {
  readonly id: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly contentHash: string;
};

/**
 * The catalogue's current-version state for one supporting document.
 * `revision` and `currentDocumentVersionId` are `null` when the catalogue holds
 * no current-version pointer row for the document. `documentPresent` records
 * whether the document is still catalogued (a removed document's row is
 * deleted while its pointer is cleared).
 */
export type DocumentCurrentVersionState = {
  readonly documentId: DocumentId;
  readonly documentPresent: boolean;
  readonly currentDocumentVersionId: DocumentVersionId | null;
  readonly revision: number | null;
};

/**
 * Everything needed to classify one publication, read from the catalogue in a
 * single consistent operation. `entities`/`relationships` must already be
 * integrity-validated immutable snapshots.
 */
export type PublicationCurrencyInputs = {
  readonly publication: KnowledgePublication;
  readonly entities: readonly PublishedEntity[];
  readonly relationships: readonly PublishedRelationship[];
  /** Published supporting versions and current pointer targets. */
  readonly documentVersions: readonly CatalogueDocumentVersion[];
  /** Exactly one entry per distinct supporting document. */
  readonly documents: readonly DocumentCurrentVersionState[];
};

export type SupportingDocumentCurrency = {
  readonly documentId: DocumentId;
  readonly publishedDocumentVersionId: DocumentVersionId;
  readonly publishedContentHash: string;
  readonly currentDocumentVersionId: DocumentVersionId | null;
  readonly currentContentHash: string | null;
  readonly catalogueRevision: number | null;
  readonly state: CurrencyState;
  readonly reason: CurrencyReason | null;
};

export type EntityCurrency = {
  readonly objectType: 'entity';
  readonly id: KnowledgeEntityId;
  readonly versionId: EntityVersionId;
  readonly versionNumber: number;
  readonly state: CurrencyState;
  readonly supportingDocuments: readonly SupportingDocumentCurrency[];
};

export type RelationshipCurrency = {
  readonly objectType: 'relationship';
  readonly id: KnowledgeRelationshipId;
  readonly versionId: RelationshipVersionId;
  readonly versionNumber: number;
  readonly state: CurrencyState;
  readonly supportingDocuments: readonly SupportingDocumentCurrency[];
};

export type KnowledgeObjectCurrency = EntityCurrency | RelationshipCurrency;

export type PublicationCurrencySummary = {
  readonly publicationId: KnowledgePublicationId;
  readonly knowledgeModelId: KnowledgeModelId;
  readonly currencyBasisHash: string;
  readonly currentEntities: number;
  readonly staleEntities: number;
  readonly unknownEntities: number;
  readonly currentRelationships: number;
  readonly staleRelationships: number;
  readonly unknownRelationships: number;
};

export type PublicationCurrency = {
  readonly summary: PublicationCurrencySummary;
  /** Sorted by object type, then stable ID, using ordinal comparison. */
  readonly records: readonly KnowledgeObjectCurrency[];
};

/**
 * Raised when the historical lineage needed to classify a publication is
 * missing or inconsistent. Lineage defects are integrity failures and are
 * never reported as `UNKNOWN`.
 */
export class PublicationCurrencyLineageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicationCurrencyLineageError';
  }
}

/**
 * Classifies one supporting document version against the catalogue's current
 * pointer. Pure; consults only the pointer, its revision, document presence
 * and stored content hashes.
 */
export function classifySupportingDocument(
  published: CatalogueDocumentVersion,
  current: DocumentCurrentVersionState,
  resolveVersion: (
    id: DocumentVersionId,
  ) => CatalogueDocumentVersion | undefined,
): SupportingDocumentCurrency {
  const base = {
    documentId: published.documentId,
    publishedDocumentVersionId: published.id,
    publishedContentHash: published.contentHash,
    catalogueRevision: current.revision,
  };
  if (current.currentDocumentVersionId === null) {
    return {
      ...base,
      currentDocumentVersionId: null,
      currentContentHash: null,
      state: CurrencyState.UNKNOWN,
      reason: current.documentPresent
        ? CurrencyReason.CURRENT_VERSION_UNAVAILABLE
        : CurrencyReason.DOCUMENT_REMOVED,
    };
  }
  const target = resolveVersion(current.currentDocumentVersionId);
  if (
    target === undefined ||
    target.documentId !== published.documentId ||
    !current.documentPresent
  ) {
    return {
      ...base,
      currentDocumentVersionId: current.currentDocumentVersionId,
      currentContentHash: null,
      state: CurrencyState.UNKNOWN,
      reason: CurrencyReason.CURRENT_VERSION_UNRESOLVABLE,
    };
  }
  const resolved = {
    ...base,
    currentDocumentVersionId: target.id,
    currentContentHash: target.contentHash,
  };
  if (target.id === published.id) {
    return { ...resolved, state: CurrencyState.CURRENT, reason: null };
  }
  return {
    ...resolved,
    state: CurrencyState.STALE,
    reason:
      target.contentHash === published.contentHash
        ? CurrencyReason.PROCESSING_CHANGED
        : CurrencyReason.CONTENT_CHANGED,
  };
}

/** `STALE` takes precedence over `UNKNOWN`, which takes precedence over `CURRENT`. */
export function combineCurrencyStates(
  states: readonly CurrencyState[],
): CurrencyState {
  if (states.includes(CurrencyState.STALE)) {
    return CurrencyState.STALE;
  }
  if (states.includes(CurrencyState.UNKNOWN)) {
    return CurrencyState.UNKNOWN;
  }
  return CurrencyState.CURRENT;
}

/**
 * Deterministic SHA-256 over the catalogue current-version state of every
 * supporting document, as stable JSON ordered by document ID.
 */
export function createCurrencyBasisHash(
  documents: readonly DocumentCurrentVersionState[],
  documentVersions: readonly CatalogueDocumentVersion[] = [],
): string {
  const versionsById = new Map(
    documentVersions.map((version) => [version.id, version]),
  );
  const entries = [...documents]
    .sort((left, right) => compareOrdinal(left.documentId, right.documentId))
    .map((document) => {
      const currentVersion =
        document.currentDocumentVersionId === null
          ? undefined
          : versionsById.get(document.currentDocumentVersionId);
      return {
        documentId: document.documentId,
        documentPresent: document.documentPresent,
        currentDocumentVersionId: document.currentDocumentVersionId,
        revision: document.revision,
        currentVersion:
          currentVersion === undefined
            ? null
            : {
                documentId: currentVersion.documentId,
                contentHash: currentVersion.contentHash,
              },
      };
    });
  return sha256(
    stableJson({
      schemaVersion: publicationCurrencySchemaVersion,
      documents: entries,
    }),
  );
}

/** Distinct `(documentId, documentVersionId)` pairs referenced by provenance. */
export function supportingDocumentVersionIds(
  provenance: readonly KnowledgeProvenance[],
): { documentId: DocumentId; documentVersionId: DocumentVersionId }[] {
  const pairs = new Map<
    string,
    { documentId: DocumentId; documentVersionId: DocumentVersionId }
  >();
  for (const item of provenance) {
    pairs.set(`${item.documentId}\u0000${item.documentVersionId}`, {
      documentId: item.documentId,
      documentVersionId: item.documentVersionId,
    });
  }
  return [...pairs.values()].sort(
    (left, right) =>
      compareOrdinal(left.documentId, right.documentId) ||
      compareOrdinal(left.documentVersionId, right.documentVersionId),
  );
}

/**
 * Classifies every published entity and relationship version. Each object's
 * currency is derived only from its own provenance; relationships never
 * inherit currency from their endpoint entities.
 */
export function classifyPublicationCurrency(
  inputs: PublicationCurrencyInputs,
): PublicationCurrency {
  const { publication } = inputs;
  const versions = new Map<string, CatalogueDocumentVersion>();
  for (const version of inputs.documentVersions) {
    const previous = versions.get(version.id);
    if (
      previous !== undefined &&
      (previous.documentId !== version.documentId ||
        previous.contentHash !== version.contentHash)
    ) {
      throw new PublicationCurrencyLineageError(
        `Publication ${publication.id} has conflicting document version records`,
      );
    }
    versions.set(version.id, version);
  }
  const documents = new Map<string, DocumentCurrentVersionState>();
  for (const document of inputs.documents) {
    if (documents.has(document.documentId)) {
      throw new PublicationCurrencyLineageError(
        `Publication ${publication.id} has duplicate current-version state`,
      );
    }
    documents.set(document.documentId, document);
  }
  const resolveVersion = (id: DocumentVersionId) => versions.get(id);
  const referencedDocuments = new Set<string>();

  const classify = (
    objectId: string,
    provenance: readonly KnowledgeProvenance[],
  ): {
    state: CurrencyState;
    supportingDocuments: SupportingDocumentCurrency[];
  } => {
    const pairs = supportingDocumentVersionIds(provenance);
    if (pairs.length === 0) {
      throw new PublicationCurrencyLineageError(
        `Published knowledge object ${objectId} has no supporting document versions`,
      );
    }
    const supportingDocuments = pairs.map(
      ({ documentId, documentVersionId }) => {
        const published = versions.get(documentVersionId);
        if (published === undefined || published.documentId !== documentId) {
          throw new PublicationCurrencyLineageError(
            `Published knowledge object ${objectId} references missing or inconsistent document version lineage`,
          );
        }
        const current = documents.get(documentId);
        if (current === undefined) {
          throw new PublicationCurrencyLineageError(
            `Publication ${publication.id} is missing current-version state for a supporting document`,
          );
        }
        referencedDocuments.add(documentId);
        return classifySupportingDocument(published, current, resolveVersion);
      },
    );
    return {
      state: combineCurrencyStates(
        supportingDocuments.map(({ state }) => state),
      ),
      supportingDocuments,
    };
  };

  const entities: EntityCurrency[] = inputs.entities
    .map((published): EntityCurrency => ({
      objectType: 'entity',
      id: published.entity.id,
      versionId: published.entityVersionId,
      versionNumber: published.versionNumber,
      ...classify(published.entity.id, published.entity.provenance),
    }))
    .sort((left, right) => compareOrdinal(left.id, right.id));
  const relationships: RelationshipCurrency[] = inputs.relationships
    .map((published): RelationshipCurrency => ({
      objectType: 'relationship',
      id: published.relationship.id,
      versionId: published.relationshipVersionId,
      versionNumber: published.versionNumber,
      ...classify(published.relationship.id, published.relationship.provenance),
    }))
    .sort((left, right) => compareOrdinal(left.id, right.id));

  const relevantDocuments = [...documents.values()].filter(({ documentId }) =>
    referencedDocuments.has(documentId),
  );
  if (relevantDocuments.length !== documents.size) {
    throw new PublicationCurrencyLineageError(
      `Publication ${publication.id} received current-version state for unreferenced documents`,
    );
  }

  const count = (
    records: readonly KnowledgeObjectCurrency[],
    state: CurrencyState,
  ) => records.filter((record) => record.state === state).length;

  return {
    summary: {
      publicationId: publication.id,
      knowledgeModelId: publication.knowledgeModelId,
      currencyBasisHash: createCurrencyBasisHash(
        relevantDocuments,
        inputs.documentVersions,
      ),
      currentEntities: count(entities, CurrencyState.CURRENT),
      staleEntities: count(entities, CurrencyState.STALE),
      unknownEntities: count(entities, CurrencyState.UNKNOWN),
      currentRelationships: count(relationships, CurrencyState.CURRENT),
      staleRelationships: count(relationships, CurrencyState.STALE),
      unknownRelationships: count(relationships, CurrencyState.UNKNOWN),
    },
    records: [...entities, ...relationships],
  };
}

/** Ordinal comparison of the `(objectType, id)` sort key. */
export function compareCurrencySortKey(
  left: { readonly objectType: CurrencyObjectType; readonly id: string },
  right: { readonly objectType: CurrencyObjectType; readonly id: string },
): number {
  return (
    compareOrdinal(left.objectType, right.objectType) ||
    compareOrdinal(left.id, right.id)
  );
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareOrdinal)
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
