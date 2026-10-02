import { describe, expect, it } from 'vitest';

import { createDocumentId, parseDocumentId } from './index.js';

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
});
