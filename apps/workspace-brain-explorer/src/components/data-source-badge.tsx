import { CircleDot, HardDrive } from 'lucide-react';

import type { KnowledgeState } from '@/lib/queries';
import { cn } from '@/lib/utils';

import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export function DataSourceBadge({ state }: { state: KnowledgeState }) {
  const live = state.source === 'live';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium sm:inline-flex',
            live
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}
        >
          {live ? (
            <CircleDot className="size-3 animate-glow" />
          ) : (
            <HardDrive className="size-3" />
          )}
          {live ? 'Live' : 'Snapshot'} · Publication v{state.graph.meta.version}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {live
          ? `Latest immutable publication of “${state.modelName}”, exported from the Workspace Brain API.`
          : `Workspace Brain API unavailable (${state.liveError ?? 'unknown error'}). Showing the bundled publication export.`}
      </TooltipContent>
    </Tooltip>
  );
}
