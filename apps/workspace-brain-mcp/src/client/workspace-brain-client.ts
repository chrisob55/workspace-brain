export const DEFAULT_WORKSPACE_BRAIN_API_URL = 'http://localhost:3000';
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export type QueryParams = Readonly<Record<string, string | number | undefined>>;

export type PageParams = {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
};

export type RelationshipDirection = 'incoming' | 'outgoing' | 'both';

type TransportPhase = 'response' | 'body';

export type SearchMatch = 'contains' | 'prefix' | 'exact';
export type CurrencyObjectType = 'entity' | 'relationship';
export type CurrencyState = 'CURRENT' | 'STALE' | 'UNKNOWN';

/**
 * How a failed call failed:
 * - `http`: the API answered with a non-2xx status; `body` is its response.
 * - `timeout`: no complete response within the configured timeout
 *   (`body.cause` is `ETIMEDOUT`).
 * - `connection`: the API could not be reached or the connection broke
 *   (`body.cause` carries the socket or DNS code when available).
 * - `malformed-body`: a 2xx response whose body is not JSON.
 * - `invalid-request`: rejected locally before any request was sent.
 */
export type ApiErrorKind =
  'http' | 'timeout' | 'connection' | 'malformed-body' | 'invalid-request';

/**
 * Outcome of a Workspace Brain API call. Non-2xx responses and transport
 * failures are returned rather than thrown so callers can pass them through
 * unchanged.
 */
export type ApiResponse =
  | { readonly ok: true; readonly status: number; readonly body: unknown }
  | {
      readonly ok: false;
      readonly kind: ApiErrorKind;
      readonly status: number | null;
      readonly body: unknown;
    };

/** A successful response whose JSON body is kept as the exact API text. */
export type ApiTextResponse =
  | { readonly ok: true; readonly status: number; readonly text: string }
  | Extract<ApiResponse, { readonly ok: false }>;

export type WorkspaceBrainClientOptions = {
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetch?: typeof fetch | undefined;
};

const pathSegmentPattern = /^[A-Za-z0-9_-]{1,128}$/;

export class InvalidPathSegmentError extends Error {
  constructor(name: string) {
    super(`${name} must contain only letters, digits, '-' or '_'.`);
    this.name = 'InvalidPathSegmentError';
  }
}

export class WorkspaceBrainClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WorkspaceBrainClientOptions = {}) {
    const baseUrl = options.baseUrl ?? DEFAULT_WORKSPACE_BRAIN_API_URL;
    // Validate eagerly so misconfiguration fails at startup, not per call.
    new URL(baseUrl);
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  searchEntities(
    params: {
      readonly query: string;
      readonly publicationId?: string | undefined;
      readonly type?: string | undefined;
      readonly lifecycleStatus?: string | undefined;
      readonly match?: SearchMatch | undefined;
      readonly field?: 'name' | 'text' | undefined;
    } & PageParams,
  ): Promise<ApiResponse> {
    return this.get('/api/v1/search/entities', {
      query: params.query,
      publicationId: params.publicationId,
      type: params.type,
      lifecycleStatus: params.lifecycleStatus,
      match: params.match,
      field: params.field,
      limit: params.limit,
      cursor: params.cursor,
    });
  }

  searchJourneys(
    params: {
      readonly query?: string | undefined;
      readonly publicationId?: string | undefined;
      readonly service?: string | undefined;
      readonly api?: string | undefined;
      readonly connector?: string | undefined;
    } & PageParams,
  ): Promise<ApiResponse> {
    return this.get('/api/v1/search/journeys', {
      query: params.query,
      publicationId: params.publicationId,
      service: params.service,
      api: params.api,
      connector: params.connector,
      limit: params.limit,
      cursor: params.cursor,
    });
  }

  getJourney(publicationId: string, journeyId: string): Promise<ApiResponse> {
    return this.get(
      `${publicationPath(publicationId)}/journeys/${segment('journeyId', journeyId)}`,
    );
  }

  searchRelationships(
    params: {
      readonly query: string;
      readonly publicationId?: string | undefined;
      readonly relationshipType?: string | undefined;
      readonly entityId?: string | undefined;
      readonly match?: SearchMatch | undefined;
      readonly field?: 'type' | 'text' | undefined;
    } & PageParams,
  ): Promise<ApiResponse> {
    return this.get('/api/v1/search/relationships', {
      query: params.query,
      publicationId: params.publicationId,
      type: params.relationshipType,
      entityId: params.entityId,
      match: params.match,
      field: params.field,
      limit: params.limit,
      cursor: params.cursor,
    });
  }

  getEntity(entityId: string): Promise<ApiResponse> {
    return this.get(
      `/api/v1/knowledge/entities/${segment('entityId', entityId)}`,
    );
  }

  getPublishedEntity(
    publicationId: string,
    entityId: string,
  ): Promise<ApiResponse> {
    return this.get(
      `${publicationPath(publicationId)}/entities/${segment('entityId', entityId)}`,
    );
  }

  getRelationship(relationshipId: string): Promise<ApiResponse> {
    return this.get(
      `/api/v1/knowledge/relationships/${segment('relationshipId', relationshipId)}`,
    );
  }

  getPublishedRelationship(
    publicationId: string,
    relationshipId: string,
  ): Promise<ApiResponse> {
    return this.get(
      `${publicationPath(publicationId)}/relationships/${segment('relationshipId', relationshipId)}`,
    );
  }

  getRelationshipProvenance(
    params: {
      readonly publicationId: string;
      readonly relationshipId: string;
    } & PageParams,
  ): Promise<ApiResponse> {
    return this.get(
      `${publicationPath(params.publicationId)}/relationships/${segment('relationshipId', params.relationshipId)}/provenance`,
      { limit: params.limit, cursor: params.cursor },
    );
  }

  listRelationshipsForEntity(
    params: {
      readonly publicationId: string;
      readonly entityId: string;
      readonly direction?: RelationshipDirection | undefined;
      readonly relationshipType?: string | undefined;
    } & PageParams,
  ): Promise<ApiResponse> {
    return this.get(
      `${publicationPath(params.publicationId)}/entities/${segment('entityId', params.entityId)}/relationships`,
      {
        direction: params.direction,
        relationshipType: params.relationshipType,
        limit: params.limit,
        cursor: params.cursor,
      },
    );
  }

  getEntityProvenance(
    params: {
      readonly publicationId: string;
      readonly entityId: string;
    } & PageParams,
  ): Promise<ApiResponse> {
    return this.get(
      `${publicationPath(params.publicationId)}/entities/${segment('entityId', params.entityId)}/provenance`,
      { limit: params.limit, cursor: params.cursor },
    );
  }

  listPublications(
    params: {
      readonly knowledgeModelId?: string | undefined;
    } & PageParams = {},
  ): Promise<ApiResponse> {
    return this.get('/api/v1/knowledge/publications', {
      knowledgeModelId: params.knowledgeModelId,
      limit: params.limit,
      cursor: params.cursor,
    });
  }

  getPublicationSummary(publicationId: string): Promise<ApiResponse> {
    return this.get(`${publicationPath(publicationId)}/summary`);
  }

  getLatestPublication(knowledgeModelId: string): Promise<ApiResponse> {
    return this.get(
      `/api/v1/knowledge/models/${segment('knowledgeModelId', knowledgeModelId)}/publications/latest`,
    );
  }

  /** The export package as the exact JSON text the API returned. */
  exportPublicationText(publicationId: string): Promise<ApiTextResponse> {
    return this.getText(`${publicationPath(publicationId)}/export`);
  }

  getPublicationCurrency(publicationId: string): Promise<ApiResponse> {
    return this.get(`${publicationPath(publicationId)}/currency`);
  }

  listPublicationCurrencyDetails(
    params: {
      readonly publicationId: string;
      readonly objectType?: CurrencyObjectType | undefined;
      readonly state?: CurrencyState | undefined;
    } & PageParams,
  ): Promise<ApiResponse> {
    return this.get(
      `${publicationPath(params.publicationId)}/currency/details`,
      {
        objectType: params.objectType,
        state: params.state,
        limit: params.limit,
        cursor: params.cursor,
      },
    );
  }

  comparePublications(
    publicationId: string,
    otherPublicationId: string,
  ): Promise<ApiResponse> {
    return this.get(
      `${publicationPath(publicationId)}/diff/${segment('otherPublicationId', otherPublicationId)}`,
    );
  }

  private async get(
    path: string,
    query: QueryParams = {},
  ): Promise<ApiResponse> {
    const response = await this.getText(path, query);
    return response.ok
      ? {
          ok: true,
          status: response.status,
          body: JSON.parse(response.text) as unknown,
        }
      : response;
  }

  private async getText(
    path: string,
    query: QueryParams = {},
  ): Promise<ApiTextResponse> {
    const url = this.url(path, query);
    const signal = AbortSignal.timeout(this.timeoutMs);
    let phase: TransportPhase = 'response';
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal,
      });
      phase = 'body';
      const text = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          kind: 'http',
          status: response.status,
          body: parseJsonOrText(text),
        };
      }
      if (!parseJson(text).ok) {
        return {
          ok: false,
          kind: 'malformed-body',
          status: response.status,
          body: {
            title: 'Malformed Workspace Brain Response',
            detail: 'The API returned a successful status without a JSON body.',
            contentType: response.headers.get('content-type'),
            url: safeUrl(url),
          },
        };
      }
      return { ok: true, status: response.status, text };
    } catch (error) {
      return this.transportFailure(error, signal, phase, url);
    }
  }

  private url(path: string, query: QueryParams = {}): URL {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private transportFailure(
    error: unknown,
    signal: AbortSignal,
    phase: TransportPhase,
    url: URL,
  ): Extract<ApiResponse, { readonly ok: false }> {
    const timedOut = signal.aborted || hasErrorName(error, 'TimeoutError');
    const cause = timedOut ? 'ETIMEDOUT' : errorCode(error);
    return {
      ok: false,
      kind: timedOut ? 'timeout' : 'connection',
      status: null,
      body: {
        title: timedOut
          ? 'Workspace Brain Request Timed Out'
          : 'Workspace Brain Connection Failed',
        detail: timedOut
          ? `The Workspace Brain API did not complete the request within the configured timeout (${this.timeoutMs} ms).`
          : 'The Workspace Brain API could not be reached or the connection was interrupted.',
        ...(cause === undefined ? {} : { cause }),
        phase,
        url: safeUrl(url),
      },
    };
  }
}

export function createClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkspaceBrainClient {
  const timeout = env.WORKSPACE_BRAIN_API_TIMEOUT_MS;
  return new WorkspaceBrainClient({
    baseUrl: env.WORKSPACE_BRAIN_API_URL || DEFAULT_WORKSPACE_BRAIN_API_URL,
    timeoutMs:
      timeout === undefined || timeout === ''
        ? DEFAULT_REQUEST_TIMEOUT_MS
        : parsePositiveInteger('WORKSPACE_BRAIN_API_TIMEOUT_MS', timeout),
  });
}

function publicationPath(publicationId: string): string {
  return `/api/v1/knowledge/publications/${segment('publicationId', publicationId)}`;
}

function segment(name: string, value: string): string {
  if (!pathSegmentPattern.test(value)) {
    throw new InvalidPathSegmentError(name);
  }
  return value;
}

function parseJson(
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (text === '') {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function parseJsonOrText(text: string): unknown {
  if (text === '') {
    return null;
  }
  const parsed = parseJson(text);
  return parsed.ok ? parsed.value : text;
}

// fetch wraps socket and DNS failures (e.g. ECONNREFUSED, ENOTFOUND) in
// `cause`, sometimes nested or inside an AggregateError.
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const queue: unknown[] = [error];
  while (queue.length > 0 && chain.length < 10) {
    const next = queue.shift();
    if (typeof next !== 'object' || next === null) {
      continue;
    }
    chain.push(next);
    if ('cause' in next) {
      queue.push(next.cause);
    }
    if ('errors' in next && Array.isArray(next.errors)) {
      queue.push(...(next.errors as unknown[]));
    }
  }
  return chain;
}

function errorCode(error: unknown): string | undefined {
  for (const entry of causeChain(error)) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'code' in entry &&
      typeof entry.code === 'string'
    ) {
      return entry.code;
    }
  }
  return undefined;
}

function hasErrorName(error: unknown, name: string): boolean {
  return causeChain(error).some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'name' in entry &&
      entry.name === name,
  );
}

// Credentials in a configured base URL must never reach tool output.
function safeUrl(url: URL): string {
  const copy = new URL(url);
  copy.username = '';
  copy.password = '';
  return copy.toString();
}

function parsePositiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
