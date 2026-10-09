import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { buildKnowledgeGraph, type KnowledgeGraph } from './knowledge-graph';

export type DataSource = 'live' | 'snapshot';

export interface KnowledgeState {
  graph: KnowledgeGraph;
  source: DataSource;
  modelName: string;
  liveError?: string;
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
