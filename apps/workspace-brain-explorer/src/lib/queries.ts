import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import type { KnowledgePublication } from './types';
import { buildKnowledgeGraph, type KnowledgeGraph } from './knowledge-graph';

export type DataSource = 'live' | 'snapshot';

export interface KnowledgeState {
  graph: KnowledgeGraph;
  source: DataSource;
  modelName: string;
  liveError?: string;
}

export interface RuntimeKnowledgeFacts {
  readonly repositoriesInInventory: number;
  readonly latestPublication?: {
    readonly publishedAt: string;
    readonly version: number;
  };
}

export async function loadRuntimeKnowledgeFacts(
  signal: AbortSignal,
): Promise<RuntimeKnowledgeFacts> {
  const [repositoriesInInventory, firstPage] = await Promise.all([
    api.countInventory('repositories', signal),
    api.listModels(signal),
  ]);
  const models = [...firstPage.items];
  let cursor = firstPage.nextCursor;
  for (let page = 1; cursor !== null && page < 200; page += 1) {
    const result = await api.listModels(signal, cursor);
    models.push(...result.items);
    cursor = result.nextCursor;
  }
  if (cursor !== null) {
    throw new Error('Could not list all knowledge models within 200 pages');
  }

  const publishedModels = models.filter(
    (model) => model.latestPublicationVersion !== null,
  );
  if (publishedModels.length === 0) {
    return { repositoriesInInventory };
  }
  const publications: KnowledgePublication[] = [];
  for (let offset = 0; offset < publishedModels.length; offset += 10) {
    const batch = publishedModels.slice(offset, offset + 10);
    publications.push(
      ...(await Promise.all(
        batch.map((model) => api.latestPublication(model.id, signal)),
      )),
    );
  }
  const publication = publications.reduce((latest, candidate) =>
    Date.parse(candidate.publishedAt) > Date.parse(latest.publishedAt)
      ? candidate
      : latest,
  );
  return {
    repositoriesInInventory,
    latestPublication: {
      publishedAt: publication.publishedAt,
      version: publication.version,
    },
  };
}

async function loadKnowledge(signal: AbortSignal): Promise<KnowledgeState> {
  try {
    const models = await api.listModels(signal);
    const model = [...models.items]
      .filter((item) => item.latestPublicationVersion !== null)
      .sort(
        (a, b) =>
          (b.latestPublicationVersion ?? 0) - (a.latestPublicationVersion ?? 0),
      )[0];
    if (!model) throw new Error('No published Knowledge Model available');
    const publication = await api.latestPublication(model.id, signal);
    const pkg = await api.exportPublication(publication.id, signal);
    return {
      graph: buildKnowledgeGraph(pkg),
      source: 'live',
      modelName: model.name,
    };
  } catch (error) {
    if (signal.aborted) throw error;
    const pkg = await api.snapshot(signal);
    return {
      graph: buildKnowledgeGraph(pkg),
      source: 'snapshot',
      modelName: 'Local Workspace Knowledge Model',
      liveError: (error as Error).message,
    };
  }
}

export function useRuntimeKnowledgeFacts() {
  return useQuery({
    queryKey: ['runtime-knowledge-facts'],
    queryFn: ({ signal }) => loadRuntimeKnowledgeFacts(signal),
    staleTime: 60_000,
  });
}

/** The latest published Knowledge Model, exported as an immutable package. */
export function useKnowledge() {
  return useQuery({
    queryKey: ['knowledge'],
    queryFn: ({ signal }) => loadKnowledge(signal),
    staleTime: Infinity,
  });
}

export function useInventoryCounts(enabled: boolean) {
  return useQuery({
    queryKey: ['inventory-counts'],
    enabled,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const [repositories, documents] = await Promise.all([
        api.countInventory('repositories', signal),
        api.countInventory('documents', signal),
      ]);
      return { repositories, documents };
    },
  });
}

export function useCurrency(
  publicationId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['currency', publicationId],
    enabled: enabled && publicationId !== undefined,
    staleTime: 30_000,
    queryFn: ({ signal }) => api.currency(publicationId!, signal),
  });
}

export function useEvidence(evidenceId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['evidence', evidenceId],
    enabled: enabled && evidenceId !== undefined,
    staleTime: Infinity,
    retry: false,
    queryFn: ({ signal }) => api.evidenceExplanation(evidenceId!, signal),
  });
}
