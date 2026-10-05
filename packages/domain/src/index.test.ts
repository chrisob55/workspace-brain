import { describe, expect, it } from 'vitest';

import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  createEntityVersionId,
  createKnowledgeEntityId,
  createKnowledgeEntityKey,
  createKnowledgeModelId,
  createKnowledgePublicationId,
  createKnowledgeRelationshipId,
  createRelationshipVersionId,
  createSourceId,
  discoveryEventSubject,
  knowledgeRelationshipTypes,
  parseDocumentId,
  parseDocumentVersionId,
  parseEvidenceId,
  parseEntityVersionId,
  parseKnowledgeEntityId,
  parseKnowledgeModelId,
  parseKnowledgePublicationId,
  parseKnowledgeRelationshipId,
  parseRelationshipVersionId,
} from './index.js';

describe('branded domain identifiers', () => {
  it('creates and parses ULIDs', () => {
    const id = createDocumentId();

    expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(parseDocumentId(id)).toBe(id);
  });

  it('rejects values that are not ULIDs at the parsing boundary', () => {
    expect(() => parseDocumentId('documents/readme.md')).toThrow(
      'Catalogue contains an invalid ULID',
    );
  });

  it('assigns evidence and document-version identities through the catalogue domain', () => {
    const versionId = createDocumentVersionId();
    const evidenceId = createEvidenceId();

    expect(parseDocumentVersionId(versionId)).toBe(versionId);
    expect(parseEvidenceId(evidenceId)).toBe(evidenceId);
  });

  it('assigns typed knowledge identities through the catalogue domain', () => {
    expect(parseKnowledgeModelId(createKnowledgeModelId())).toMatch(
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
    );
    expect(parseKnowledgeEntityId(createKnowledgeEntityId())).toMatch(
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
    );
    expect(
      parseKnowledgeRelationshipId(createKnowledgeRelationshipId()),
    ).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(parseEntityVersionId(createEntityVersionId())).toMatch(
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
    );
    expect(parseRelationshipVersionId(createRelationshipVersionId())).toMatch(
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
    );
    expect(parseKnowledgePublicationId(createKnowledgePublicationId())).toMatch(
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
    );
  });

  it('exposes only the accepted directional relationship vocabulary', () => {
    expect(knowledgeRelationshipTypes).toEqual([
      'CONTAINS',
      'BELONGS_TO',
      'REFERENCES',
      'DOCUMENTS',
      'DEPENDS_ON',
      'USES',
      'IMPLEMENTS',
      'EXPOSES',
      'CONSUMES',
      'CLASSIFIED_AS',
      'DERIVED_FROM',
    ]);
  });

  it('routes discovery, processing, and knowledge events to bounded subjects', () => {
    expect(discoveryEventSubject('DocumentProcessingSubmitted')).toBe(
      'workspace.processing.document.submitted',
    );
    expect(discoveryEventSubject('DocumentExtracted')).toBe(
      'workspace.processing.document.extracted',
    );
    expect(discoveryEventSubject('KnowledgeCandidatesSubmitted')).toBe(
      'workspace.knowledge.candidates.submitted',
    );
    expect(discoveryEventSubject('KnowledgeEntityDiscovered')).toBe(
      'workspace.knowledge.entity.discovered',
    );
    expect(discoveryEventSubject('KnowledgeModelPublished')).toBe(
      'workspace.knowledge.model.published',
    );
    expect(discoveryEventSubject('SearchProjectionRequested')).toBe(
      'workspace.search.projection.requested',
    );
    expect(discoveryEventSubject('SearchProjectionBuilt')).toBe(
      'workspace.search.projection.built',
    );
    expect(discoveryEventSubject('DocumentModified')).toBe(
      'workspace.discovery.document.modified',
    );
  });

  it('scopes entity identity by source and preserves case-sensitive paths', () => {
    const firstSource = createSourceId();
    const secondSource = createSourceId();
    const upperPath = createKnowledgeEntityKey(
      'module',
      firstSource,
      'root/src/Client.ts',
      'src/Client',
    );

    expect(
      createKnowledgeEntityKey(
        'module',
        firstSource,
        'root/src/client.ts',
        'src/client',
      ),
    ).not.toBe(upperPath);
    expect(
      createKnowledgeEntityKey(
        'module',
        secondSource,
        'root/src/Client.ts',
        'src/Client',
      ),
    ).not.toBe(upperPath);
  });
});
