import { Check, Copy, ExternalLink, RotateCcw } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';

import { useNavigation } from '@/app-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ONBOARDING, scriptCommand } from '@/lib/how-it-works/catalogue';
import { SECTIONS } from '@/lib/how-it-works/sections';
import { ROOT_SCRIPTS } from '@/lib/implementation-metadata';
import { SCREENS } from '@/screens';
import { cn } from '@/lib/utils';

import {
  DeepLinkContext,
  DocSection,
  ImplementedBy,
  useDeepLink,
} from './shared';

const STORAGE_KEY = 'wbe-onboarding-progress';

function useProgress() {
  const [done, setDone] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  useEffect(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(done)),
    [done],
  );
  const toggle = (id: string) =>
    setDone((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  return { done, toggle, reset: () => setDone([]) };
}

function CommandLine({
  command,
  detail,
}: {
  command: string;
  detail?: string | undefined;
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 font-mono text-xs">
      <span className="text-muted-foreground">$</span>
      <span className="min-w-0 flex-1 break-all">{command}</span>
      {detail && (
        <span className="hidden truncate text-muted-foreground lg:inline">
          {detail}
        </span>
      )}
      <button
        type="button"
        title="Copy"
        onClick={() => void navigator.clipboard?.writeText(command)}
        className="text-muted-foreground hover:text-foreground"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

export function OnboardingSection() {
  const { goTo } = useNavigation();
  const deepLinks = useContext(DeepLinkContext);
  const { item, select } = useDeepLink('onboarding');
  const { done, toggle, reset } = useProgress();
  const active =
    ONBOARDING.find((step) => step.id === item) ??
    ONBOARDING.find((step) => !done.includes(step.id)) ??
    ONBOARDING[0]!;
  const progress = Math.round((done.length / ONBOARDING.length) * 100);
  return (
    <DocSection
      id="onboarding"
      lead="New to Workspace Brain? Work through these seven steps. Each one links to the real code and the commands you will run. Your progress is saved in this browser."
    >
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">
          {done.length}/{ONBOARDING.length}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={reset}
          disabled={done.length === 0}
        >
          <RotateCcw />
          Reset
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <ol className="space-y-1">
          {ONBOARDING.map((step, index) => {
            const complete = done.includes(step.id);
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => select(step.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent',
                    step.id === active.id &&
                      'bg-primary/10 font-medium text-primary',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
                      complete &&
                        'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {complete ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  {step.title}
                </button>
              </li>
            );
          })}
        </ol>
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xl font-semibold">
                {ONBOARDING.indexOf(active) + 1}. {active.title}
              </h3>
              <Button
                size="sm"
                variant={done.includes(active.id) ? 'secondary' : 'default'}
                onClick={() => toggle(active.id)}
              >
                <Check />
                {done.includes(active.id) ? 'Completed' : 'Mark as done'}
              </Button>
            </div>
            <p className="text-sm">{active.description}</p>
            {(active.scripts.length > 0 || active.commands.length > 0) && (
              <div className="space-y-1.5">
                {active.scripts.map((script) => (
                  <CommandLine
                    key={script}
                    command={scriptCommand(script) ?? `pnpm ${script}`}
                    detail={ROOT_SCRIPTS[script]}
                  />
                ))}
                {active.commands.map((command) => (
                  <CommandLine key={command} command={command} />
                ))}
              </div>
            )}
            <ImplementedBy refs={active.refs} />
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {active.section && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deepLinks.select(active.section!)}
                >
                  Go to{' '}
                  {
                    SECTIONS.find((section) => section.id === active.section)
                      ?.title
                  }
                </Button>
              )}
              {active.screen && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => goTo(active.screen!)}
                >
                  <ExternalLink />
                  Open{' '}
                  {SCREENS.find((screen) => screen.id === active.screen)
                    ?.title ?? active.screen}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DocSection>
  );
}
