import { useCallback, useEffect, useRef, useState } from 'react';

import type { RuntimeStatusResponse } from '@workspace-brain/domain';

import { api, API_BASE } from './api';

export type RuntimeDashboardState = {
  readonly snapshot?: RuntimeStatusResponse;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly stale: boolean;
  readonly endpointUnavailable: boolean;
  readonly refreshError?: string;
  readonly lastRefreshAt?: string;
  readonly refresh: () => void;
};

export const RUNTIME_STATUS_REFRESH_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;

export function scheduleRuntimeStatusRefresh(
  refresh: () => void,
  intervalMs: number,
  schedule: (callback: () => void, delayMs: number) => () => void = (
    callback,
    delayMs,
  ) => {
    const timer = window.setInterval(callback, delayMs);
    return () => window.clearInterval(timer);
  },
): () => void {
  return schedule(refresh, intervalMs);
}

export function createNonOverlappingRunner(task: () => Promise<void>) {
  let inFlight = false;
  return async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await task();
    } finally {
      inFlight = false;
    }
  };
}

export type RuntimeRefreshResult =
  | {
      readonly ok: true;
      readonly snapshot: RuntimeStatusResponse;
      readonly refreshedAt: string;
    }
  | {
      readonly ok: false;
      readonly stale: boolean;
      readonly endpointUnavailable: boolean;
      readonly error: string;
    };

export async function refreshRuntimeStatus(
  signal: AbortSignal,
  previous?: RuntimeStatusResponse,
  now: () => Date = () => new Date(),
): Promise<RuntimeRefreshResult> {
  const diagnostics =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('runtimeDebug') === '1';
  const requestUrl = `${API_BASE}/runtime/status`;
  if (diagnostics) {
    console.debug('[runtime/status] Refresh started', {
      requestUrl,
      pageOrigin: location.origin,
      hasPreviousSnapshot: previous !== undefined,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  }
  try {
    const requestSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ]);
    const snapshot = await api.runtimeStatus(requestSignal);
    if (diagnostics) {
      console.debug('[runtime/status] Refresh succeeded', {
        requestUrl,
        generatedAt: snapshot.generatedAt,
        componentCount: snapshot.components.length,
      });
    }
    return {
      ok: true,
      snapshot,
      refreshedAt: now().toISOString(),
    };
  } catch (error) {
    if (diagnostics) {
      console.warn('[runtime/status] Refresh failed', {
        requestUrl,
        error,
        aborted: signal.aborted,
        hasPreviousSnapshot: previous !== undefined,
      });
    }
    return {
      ok: false,
      stale: previous !== undefined,
      endpointUnavailable: previous === undefined,
      error:
        previous === undefined
          ? 'Runtime registry endpoint is unavailable; no component status has been loaded.'
          : 'Runtime registry refresh failed; the last successful snapshot is stale.',
    };
  }
}

export function useRuntimeStatus(
  refreshIntervalMs = RUNTIME_STATUS_REFRESH_INTERVAL_MS,
): RuntimeDashboardState {
  const [snapshot, setSnapshot] = useState<RuntimeStatusResponse>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [endpointUnavailable, setEndpointUnavailable] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [lastRefreshAt, setLastRefreshAt] = useState<string>();
  const refreshRef = useRef<() => void>(() => undefined);
  const snapshotRef = useRef<RuntimeStatusResponse | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    let activeController: AbortController | undefined;

    const runRefresh = createNonOverlappingRunner(async () => {
      if (disposed) return;
      activeController = new AbortController();
      const controller = activeController;
      setRefreshing(true);
      const result = await refreshRuntimeStatus(
        controller.signal,
        snapshotRef.current,
      );
      if (!disposed) {
        if (result.ok) {
          snapshotRef.current = result.snapshot;
          setSnapshot(result.snapshot);
          setLastRefreshAt(result.refreshedAt);
          setStale(false);
          setEndpointUnavailable(false);
          setRefreshError(undefined);
        } else {
          setStale(result.stale);
          setEndpointUnavailable(result.endpointUnavailable);
          setRefreshError(result.error);
        }
        setLoading(false);
        setRefreshing(false);
      }
    });
    const refresh = () => void runRefresh();

    refreshRef.current = refresh;
    refresh();
    const cancelTimer = scheduleRuntimeStatusRefresh(
      refresh,
      refreshIntervalMs,
    );
    return () => {
      disposed = true;
      cancelTimer();
      activeController?.abort();
      refreshRef.current = () => undefined;
    };
  }, [refreshIntervalMs]);

  const refreshNow = useCallback(() => refreshRef.current(), []);
  return {
    ...(snapshot === undefined ? {} : { snapshot }),
    loading,
    refreshing,
    stale,
    endpointUnavailable,
    ...(refreshError === undefined ? {} : { refreshError }),
    ...(lastRefreshAt === undefined ? {} : { lastRefreshAt }),
    refresh: refreshNow,
  };
}

export function summarizeRuntime(runtime: RuntimeDashboardState): string {
  if (runtime.loading && runtime.snapshot === undefined) {
    return 'Loading the runtime registry from the Workspace Brain API.';
  }
  if (runtime.endpointUnavailable) {
    return 'The API runtime registry is unavailable. No component has been marked offline based on this request failure.';
  }
  if (runtime.stale) {
    return 'The displayed component states come from the last successful snapshot and may no longer reflect current runtime state.';
  }
  const components = runtime.snapshot?.components ?? [];
  const healthyCount = components.filter(
    ({ status }) => status === 'healthy',
  ).length;
  return `${healthyCount} of ${components.length} observed or expected runtime components are healthy. Component state is calculated from heartbeat age or the API NATS connection state.`;
}
