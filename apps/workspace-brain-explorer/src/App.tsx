import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Moon,
  Presentation,
  RefreshCw,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { KnowledgeContext, NavigationContext } from './app-context';
import { DataSourceBadge } from './components/data-source-badge';
import { BrainMark } from './components/brain-mark';
import { Button } from './components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './components/ui/tooltip';
import { useKnowledge } from './lib/queries';
import { cn } from './lib/utils';
import { SCREENS } from './screens';

function screenFromHash(): string {
  const id = window.location.hash.replace(/^#\/?/, '');
  return SCREENS.some((screen) => screen.id === id) ? id : SCREENS[0]!.id;
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('wbe-theme');
    return stored ? stored === 'dark' : true;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('wbe-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark] as const;
}

export function App() {
  const knowledge = useKnowledge();
  const [screenId, setScreenId] = useState(screenFromHash);
  const [dark, setDark] = useTheme();
  const [presenting, setPresenting] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setScreenId(screenFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const index = SCREENS.findIndex((screen) => screen.id === screenId);
  const screen = SCREENS[index] ?? SCREENS[0]!;

  const goTo = useCallback((id: string) => {
    window.location.hash = `/${id}`;
    setMobileNavOpen(false);
  }, []);

  const step = useCallback(
    (delta: number) => {
      const next =
        SCREENS[Math.min(SCREENS.length - 1, Math.max(0, index + delta))];
      if (next) goTo(next.id);
    },
    [goTo, index],
  );

  const togglePresentation = useCallback(() => {
    setPresenting((value) => {
      const next = !value;
      if (next)
        void document.documentElement
          .requestFullscreen?.()
          .catch(() => undefined);
      else if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]'))
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'p' || event.key === 'P') togglePresentation();
      if (!presenting) return;
      if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        step(1);
      } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'Escape') {
        setPresenting(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, step, togglePresentation]);

  const navigation = useMemo(() => ({ goTo, presenting }), [goTo, presenting]);
  const Screen = screen.component;

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Screens">
      <div className="mb-4 flex items-center gap-2.5 px-2 pt-1">
        <BrainMark className="size-8" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Workspace Brain</div>
          <div className="text-xs text-muted-foreground">Explorer</div>
        </div>
      </div>
      {SCREENS.map((item, i) => {
        const Icon = item.icon;
        const active = item.id === screen.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => goTo(item.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
              active
                ? 'bg-primary/12 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md border text-[11px] tabular-nums',
                active
                  ? 'border-primary/50 bg-primary text-primary-foreground'
                  : 'bg-card',
              )}
            >
              {active ? <Icon className="size-3.5" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate">{item.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {item.question}
              </span>
            </span>
          </button>
        );
      })}
      <div className="mt-auto space-y-2 px-2 pb-1 pt-4 text-[11px] leading-relaxed text-muted-foreground">
        <p>
          Press <kbd className="rounded border bg-card px-1 font-mono">P</kbd>{' '}
          to present. Use{' '}
          <kbd className="rounded border bg-card px-1 font-mono">←</kbd>{' '}
          <kbd className="rounded border bg-card px-1 font-mono">→</kbd> to move
          between screens.
        </p>
      </div>
    </nav>
  );

  return (
    <NavigationContext.Provider value={navigation}>
      <div className="flex h-full overflow-hidden">
        {!presenting && (
          <aside className="hidden w-64 shrink-0 border-r bg-sidebar lg:block">
            {sidebar}
          </aside>
        )}
        {mobileNavOpen && !presenting && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden
            />
            <aside className="relative h-full w-72 border-r bg-sidebar shadow-xl">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
              >
                <X />
              </Button>
              {sidebar}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
            {!presenting && (
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                <Menu />
              </Button>
            )}
            {presenting && <BrainMark className="size-7" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                <span className="text-muted-foreground">
                  {index + 1} / {SCREENS.length} ·{' '}
                </span>
                {screen.title}
              </div>
            </div>
            {knowledge.data && <DataSourceBadge state={knowledge.data} />}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void knowledge.refetch()}
                  aria-label="Reload latest publication"
                  disabled={knowledge.isFetching}
                >
                  <RefreshCw
                    className={cn(knowledge.isFetching && 'animate-spin')}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload latest publication</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDark(!dark)}
                  aria-label="Toggle dark mode"
                >
                  {dark ? <Sun /> : <Moon />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {dark ? 'Light mode' : 'Dark mode'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={presenting ? 'default' : 'outline'}
                  size="sm"
                  onClick={togglePresentation}
                >
                  {presenting ? <X /> : <Presentation />}
                  <span className="hidden sm:inline">
                    {presenting ? 'Exit' : 'Present'}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Presentation mode (P)</TooltipContent>
            </Tooltip>
          </header>

          <main
            className={cn(
              'relative min-h-0 flex-1',
              screen.fullBleed ? 'overflow-hidden' : 'overflow-y-auto',
            )}
          >
            {knowledge.data ? (
              <KnowledgeContext.Provider value={knowledge.data}>
                <div
                  key={screen.id}
                  className={cn(
                    'animate-fade-up',
                    screen.fullBleed
                      ? 'h-full'
                      : 'mx-auto w-full max-w-7xl px-5 py-8 md:px-8',
                    presenting &&
                      !screen.fullBleed &&
                      'max-w-[1500px] md:py-12',
                  )}
                >
                  <Screen />
                </div>
              </KnowledgeContext.Provider>
            ) : (
              <LoadingState error={knowledge.error?.message} />
            )}
          </main>

          {presenting && (
            <footer className="flex h-12 shrink-0 items-center justify-center gap-4 border-t">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => step(-1)}
                disabled={index === 0}
              >
                <ChevronLeft />
              </Button>
              <div className="flex gap-1.5">
                {SCREENS.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={item.title}
                    onClick={() => goTo(item.id)}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === index
                        ? 'w-6 bg-primary'
                        : 'w-1.5 bg-muted-foreground/40',
                    )}
                  />
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => step(1)}
                disabled={index === SCREENS.length - 1}
              >
                <ChevronRight />
              </Button>
            </footer>
          )}
        </div>
      </div>
    </NavigationContext.Provider>
  );
}

function LoadingState({ error }: { error?: string | undefined }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <BrainMark className={cn('size-14', !error && 'animate-glow')} />
      {error ? (
        <>
          <p className="font-medium">No published knowledge available</p>
          <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Loading the latest publication…
        </p>
      )}
    </div>
  );
}
