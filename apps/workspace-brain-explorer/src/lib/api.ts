import type {
  EvidenceExplanation,
  KnowledgeModel,
  KnowledgePublication,
  Page,
  PublicationCurrency,
  PublicationPackage,
} from './types';

const API_BASE =
  (import.meta.env.VITE_WORKSPACE_BRAIN_API_BASE as string | undefined) ?? '';
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}snapshot/publication.json`;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw new ApiError(
      `Workspace Brain API unreachable: ${(error as Error).message}`,
    );
  }
  if (!response.ok)
    throw new ApiError(`${path} returned ${response.status}`, response.status);
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new ApiError(`${path} did not return JSON`);
  return (await response.json()) as T;
}

export const api = {
  listModels: (signal?: AbortSignal) =>
    getJson<Page<KnowledgeModel>>('/api/v1/knowledge/models?limit=100', signal),

  latestPublication: (modelId: string, signal?: AbortSignal) =>
    getJson<KnowledgePublication>(
      `/api/v1/knowledge/models/${encodeURIComponent(modelId)}/publications/latest`,
      signal,
    ),

  exportPublication: (publicationId: string, signal?: AbortSignal) =>
    getJson<PublicationPackage>(
      `/api/v1/knowledge/publications/${encodeURIComponent(publicationId)}/export`,
      signal,
    ),

  currency: (publicationId: string, signal?: AbortSignal) =>
    getJson<PublicationCurrency>(
      `/api/v1/knowledge/publications/${encodeURIComponent(publicationId)}/currency`,
      signal,
    ),

  evidenceExplanation: (evidenceId: string, signal?: AbortSignal) =>
    getJson<EvidenceExplanation>(
      `/api/v1/evidence/${encodeURIComponent(evidenceId)}/explanation`,
      signal,
    ),

  /** Counts a cursor-paginated inventory collection (repositories or documents). */
  async countInventory(
    collection: 'repositories' | 'documents',
    signal?: AbortSignal,
  ): Promise<number> {
    let total = 0;
    let cursor: string | null = null;
    for (let page = 0; page < 200; page += 1) {
      const query: string = cursor
        ? `&cursor=${encodeURIComponent(cursor)}`
        : '';
      const result: Page<unknown> = await getJson<Page<unknown>>(
        `/api/v1/${collection}?limit=100${query}`,
        signal,
      );
      total += result.items.length;
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return total;
  },

  snapshot: async (signal?: AbortSignal) => {
    const response = await fetch(SNAPSHOT_URL, signal ? { signal } : {});
    if (!response.ok)
      throw new ApiError('Bundled snapshot unavailable', response.status);
    return (await response.json()) as PublicationPackage;
  },
};
