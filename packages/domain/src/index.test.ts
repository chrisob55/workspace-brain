import { describe, expect, it } from 'vitest';

import {
  createDocumentId,
  createDocumentVersionId,
  createEvidenceId,
  parseDocumentId,
  parseDocumentVersionId,
  parseEvidenceId,
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
});
