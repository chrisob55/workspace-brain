import { ulid } from 'ulid';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type SourceId = Brand<string, 'SourceId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type RepositoryId = Brand<string, 'RepositoryId'>;
export type DocumentId = Brand<string, 'DocumentId'>;
export type DocumentVersionId = Brand<string, 'DocumentVersionId'>;

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function parseBrandedId<Name extends string>(
  value: string,
): Brand<string, Name> {
  if (!ulidPattern.test(value)) {
    throw new Error('Catalogue contains an invalid ULID');
  }
  return value as Brand<string, Name>;
}

export const createSourceId = (): SourceId => ulid() as SourceId;
export const createWorkspaceId = (): WorkspaceId => ulid() as WorkspaceId;
export const createRepositoryId = (): RepositoryId => ulid() as RepositoryId;
export const createDocumentId = (): DocumentId => ulid() as DocumentId;
export const createDocumentVersionId = (): DocumentVersionId =>
  ulid() as DocumentVersionId;

export const parseSourceId = (value: string): SourceId =>
  parseBrandedId<'SourceId'>(value);
export const parseWorkspaceId = (value: string): WorkspaceId =>
  parseBrandedId<'WorkspaceId'>(value);
export const parseRepositoryId = (value: string): RepositoryId =>
  parseBrandedId<'RepositoryId'>(value);
export const parseDocumentId = (value: string): DocumentId =>
  parseBrandedId<'DocumentId'>(value);
export const parseDocumentVersionId = (value: string): DocumentVersionId =>
  parseBrandedId<'DocumentVersionId'>(value);

export type Source = {
  readonly id: SourceId;
  readonly name: string;
  readonly type: 'filesystem';
  readonly containerPaths: readonly string[];
  readonly createdAt: string;
};

export type Workspace = {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly description?: string;
  readonly sourceIds: readonly SourceId[];
  readonly createdAt: string;
};

export type Repository = {
  readonly id: RepositoryId;
  readonly sourceId: SourceId;
  readonly path: string;
  readonly name: string;
};

export type Document = {
  readonly id: DocumentId;
  readonly repositoryId: RepositoryId;
  readonly path: string;
};

export type DocumentVersion = {
  readonly id: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly contentHash: string;
  readonly hashAlgorithm: 'sha256';
  readonly discoveredAt: string;
};
