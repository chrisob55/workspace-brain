import { createContext, useContext } from 'react';

import type { KnowledgeState } from '@/lib/queries';

export const KnowledgeContext = createContext<KnowledgeState | null>(null);

export function useKnowledgeState(): KnowledgeState {
  const value = useContext(KnowledgeContext);
  if (!value)
    throw new Error('useKnowledgeState must be used inside KnowledgeContext');
  return value;
}

export interface AppNavigation {
  goTo: (screenId: string) => void;
  presenting: boolean;
}

export const NavigationContext = createContext<AppNavigation>({
  goTo: () => undefined,
  presenting: false,
});

export function useNavigation(): AppNavigation {
  return useContext(NavigationContext);
}
