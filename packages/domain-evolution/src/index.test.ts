import { describe, expect, it } from 'vitest';

import {
  ChangeType,
  changeTypes,
  createPublicationDiffId,
  entityContentFields,
  parsePublicationDiffId,
  relationshipContentFields,
} from './index.js';

describe('knowledge evolution vocabulary', () => {
  it('defines exactly the observable change types', () => {
    expect(changeTypes).toEqual(['ADDED', 'REMOVED', 'MODIFIED']);
    expect(Object.values(ChangeType)).toEqual([...changeTypes]);
  });

  it('compares content fields only, never version bookkeeping', () => {
    for (const fields of [entityContentFields, relationshipContentFields]) {
      expect(fields).not.toContain('currentVersionId');
      expect(fields).not.toContain('createdAt');
      expect(fields).not.toContain('updatedAt');
      expect(fields).not.toContain('id');
    }
  });

  it('creates and validates ULID diff identifiers', () => {
    const id = createPublicationDiffId();
    expect(parsePublicationDiffId(id)).toBe(id);
    expect(() => parsePublicationDiffId('not-a-ulid')).toThrow();
  });
});
