export type RelationshipType =
  'DEPENDS_ON' | 'CONTAINS' | 'EXPOSES' | 'REFERENCES';

export type EntityType =
  | 'repository'
  | 'package'
  | 'module'
  | 'api'
  | 'operation'
  | 'architectural-decision'
  | 'document'
  | 'container'
  | (string & {});

export type EvidenceLocator =
  | {
      kind: 'markdown-lines' | 'text-lines' | 'yaml-lines';
      lineStart: number;
      lineEnd: number;
      headingPath?: string[];
    }
  | { kind: 'json-pointer'; pointer: string };

export interface ProvenanceItem {
  contentFingerprint: string;
  documentId: string;
  documentPath: string;
  documentVersionId: string;
  evidenceId: string;
  extractionRuleId: string;
  extractionRuleVersion: number;
  knowledgeExtractorId?: string;
  knowledgeExtractorVersion?: number;
  locator: EvidenceLocator;
  processorId: string;
  processorVersion: number;
  sourceId: string;
}

export interface KnowledgeEntity {
  id: string;
  knowledgeModelId: string;
  name: string;
  type: EntityType;
  lifecycleStatus: string;
  provenance: ProvenanceItem[];
  sourceEvidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRelationship {
  id: string;
  knowledgeModelId: string;
  type: RelationshipType;
  sourceEntityId: string;
  targetEntityId: string;
  confidence: number;
  lifecycleStatus: string;
  provenance: ProvenanceItem[];
  sourceEvidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicationPackage {
  format: string;
  formatVersion: number;
  metadata: {
    contentHash: string;
    createdAt: string;
    entityCount: number;
    knowledgeModelId: string;
    publicationId: string;
    publicationVersion: number;
    relationshipCount: number;
    schemaVersion: number;
  };
  entities: {
    entity: KnowledgeEntity;
    entityVersionId: string;
    publicationId: string;
    versionNumber: number;
  }[];
  relationships: {
    relationship: KnowledgeRelationship;
    relationshipVersionId: string;
    publicationId: string;
    versionNumber: number;
  }[];
}

export interface KnowledgeModel {
  id: string;
  workspaceId: string;
  name: string;
  schemaVersion: number;
  latestPublicationVersion: number | null;
  createdAt: string;
}

export interface KnowledgePublication {
  id: string;
  knowledgeModelId: string;
  version: number;
  schemaVersion: number;
  status: 'published';
  contentHash: string;
  publishedAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PublicationCurrency {
  publicationId: string;
  knowledgeModelId: string;
  currencyBasisHash: string;
  currentEntities: number;
  staleEntities: number;
  unknownEntities: number;
  currentRelationships: number;
  staleRelationships: number;
  unknownRelationships: number;
}

export interface EvidenceExplanation {
  evidence: {
    id: string;
    documentVersionId: string;
    key: string;
    kind: string;
    excerpt: string;
    truncated: boolean;
    locator: EvidenceLocator;
  };
  documentVersion: {
    id: string;
    documentId: string;
    contentHash: string;
    discoveredAt: string;
    processorId: string;
    processorVersion: number;
  };
  document: {
    id: string;
    path: string;
    filename: string;
  };
  provenance: {
    provider: string;
    documentPath: string;
    processorId: string;
    processorVersion: number;
    extractionRuleId: string;
    extractionRuleVersion: number;
  };
}
