import { createContext, useContext } from 'react';

import type { CodeRef } from '@/lib/how-it-works/concepts';
import type { ProvenanceItem } from '@/lib/types';

export type InspectorTarget =
  | { kind: 'code'; ref: CodeRef }
  | { kind: 'schema'; name: string }
  | { kind: 'json'; title: string; value: unknown; schema?: string }
  | { kind: 'adr'; number: number }
  | { kind: 'api'; operationId: string }
  | { kind: 'evidence'; title: string; provenance: ProvenanceItem[] };

export interface Inspector {
  open: (target: InspectorTarget) => void;
}

export const InspectorContext = createContext<Inspector>({
  open: () => undefined,
});

export function useInspector(): Inspector {
  return useContext(InspectorContext);
}
