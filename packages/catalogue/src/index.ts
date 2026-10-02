import type { Source, Workspace } from '@workspace-brain/domain';

export type CataloguePage<T> = {
  readonly items: readonly T[];
};

export type CataloguePageRequest = {
  readonly afterId?: string;
  readonly limit: number;
};

export interface CatalogueReader {
  listSources(request: CataloguePageRequest): Promise<CataloguePage<Source>>;
  listWorkspaces(
    request: CataloguePageRequest,
  ): Promise<CataloguePage<Workspace>>;
}

export interface CatalogueHealth {
  check(): Promise<void>;
  close(): Promise<void>;
}
