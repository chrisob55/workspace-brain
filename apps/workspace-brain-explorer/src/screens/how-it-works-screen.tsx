import { Code2, Compass, Presentation } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { pinScroll, scrollToElement } from '@/lib/how-it-works/scroll';
import { InspectorProvider } from '@/components/docs/inspector';
import { ScreenHeader } from '@/components/story';
import {
  deepLinkHash,
  parseDeepLink,
  sectionElementId,
  SECTIONS,
  type DeepLink,
} from '@/lib/how-it-works/sections';
import { cn } from '@/lib/utils';

import { AiOsSection } from './how-it-works/ai-os-section';
import { AnatomySection } from './how-it-works/anatomy-section';
import { CodeExplorerSection } from './how-it-works/code-explorer-section';
import { GlossarySection } from './how-it-works/glossary-section';
import { JourneysSection } from './how-it-works/journeys-section';
import { OnboardingSection } from './how-it-works/onboarding-section';
import { OverviewSection } from './how-it-works/overview-section';
import { ParserPacksSection } from './how-it-works/parser-packs-section';
import { PipelineSection } from './how-it-works/pipeline-section';
import { DeepLinkContext, type DeepLinkState } from './how-it-works/shared';

const AUDIENCES = [
  {
    id: 'developers',
    label: 'Developers',
    icon: Code2,
    path: ['onboarding', 'code', 'parser-packs'],
  },
  {
    id: 'architects',
    label: 'Architects',
    icon: Compass,
    path: ['pipeline', 'anatomy', 'ai-os'],
  },
  {
    id: 'stakeholders',
    label: 'Stakeholders',
    icon: Presentation,
    path: ['overview', 'journeys', 'glossary'],
  },
];

function sectionTarget(section: string, item?: string) {
  return (
    (section === 'glossary' &&
      item &&
      document.getElementById(`hiw-term-${item}`)) ||
    document.getElementById(sectionElementId(section))
  );
}

function scrollToSection(section: string, item?: string) {
  const element = sectionTarget(section, item);
  if (element) scrollToElement(element);
}

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section!;
          if (entry.isIntersecting)
            visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: '-10% 0px -70% 0px' },
    );
    for (const id of ids) {
      const element = document.getElementById(sectionElementId(id));
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

export function HowItWorksScreen() {
  const [link, setLink] = useState<DeepLink>(() =>
    parseDeepLink(window.location.hash),
  );
  const sectionIds = useMemo(() => SECTIONS.map((section) => section.id), []);
  const active = useScrollSpy(sectionIds);

  useEffect(() => {
    let unpin: (() => void) | undefined;
    // Jump after the section has re-rendered for the new item, then hold
    // position while late content (such as diagrams) settles.
    const pinTo = (target: DeepLink) =>
      window.requestAnimationFrame(() => {
        unpin?.();
        unpin = pinScroll(() => sectionTarget(target.section!, target.item));
      });
    let frame: number | undefined;
    const onHash = () => {
      const next = parseDeepLink(window.location.hash);
      setLink(next);
      if (next.section) frame = pinTo(next);
    };
    window.addEventListener('hashchange', onHash);
    const initial = parseDeepLink(window.location.hash);
    if (initial.section) frame = pinTo(initial);
    return () => {
      window.removeEventListener('hashchange', onHash);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      unpin?.();
    };
  }, []);

  const select = useCallback((section: string, item?: string) => {
    // Selecting inside a section updates the shareable URL without re-scrolling.
    window.history.replaceState(null, '', deepLinkHash(section, item));
    setLink(item ? { section, item } : { section });
    if (!item) scrollToSection(section);
  }, []);

  const deepLinks = useMemo<DeepLinkState>(
    () => ({ ...link, select }),
    [link, select],
  );

  return (
    <InspectorProvider>
      <DeepLinkContext.Provider value={deepLinks}>
        <ScreenHeader
          eyebrow="Interactive documentation · generated from the implementation"
          title="How Workspace Brain Works"
          lead="A guided tour from organisational assets to published, evidence-backed knowledge. Diagrams, examples and code links are derived from the live publication and the repository source, so this page stays in step with the code."
        />

        <div className="mb-10 grid gap-3 sm:grid-cols-3">
          {AUDIENCES.map((audience) => (
            <div key={audience.id} className="rounded-xl border bg-card p-4">
              <p className="mb-2 flex items-center gap-2 font-medium">
                <audience.icon className="size-4 text-primary" />
                For {audience.label.toLowerCase()}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {audience.path.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => select(id)}
                    className="rounded-full border px-2.5 py-0.5 text-xs hover:border-primary/60 hover:text-primary"
                  >
                    {SECTIONS.find((section) => section.id === id)?.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_13rem] [&_.grid>*]:min-w-0">
          <div className="min-w-0 space-y-14">
            <OverviewSection />
            <PipelineSection />
            <ParserPacksSection />
            <AnatomySection />
            <JourneysSection />
            <CodeExplorerSection />
            <GlossarySection />
            <AiOsSection />
            <OnboardingSection />
          </div>
          <nav aria-label="On this page" className="hidden xl:block">
            <div className="sticky top-6 space-y-1 text-sm">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                On this page
              </p>
              {SECTIONS.map((section, index) => (
                <a
                  key={section.id}
                  href={deepLinkHash(section.id)}
                  onClick={(event) => {
                    event.preventDefault();
                    select(section.id);
                  }}
                  className={cn(
                    'block border-l-2 py-1 pl-3 text-muted-foreground transition-colors hover:text-foreground',
                    active === section.id
                      ? 'border-primary font-medium text-primary'
                      : 'border-transparent',
                  )}
                >
                  <span className="mr-1.5 tabular-nums opacity-60">
                    {index + 1}
                  </span>
                  {section.title}
                </a>
              ))}
            </div>
          </nav>
        </div>
      </DeepLinkContext.Provider>
    </InspectorProvider>
  );
}
