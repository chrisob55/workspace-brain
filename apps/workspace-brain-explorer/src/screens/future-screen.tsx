import {
  Bot,
  BrainCircuit,
  Compass,
  FolderGit2,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  Stamp,
  XCircle,
  CheckCircle2,
} from 'lucide-react';
import { useState } from 'react';

import { KeyMessage, ScreenHeader, SectionTitle } from '@/components/story';
import { Pipeline, type PipelineStep } from '@/components/pipeline';

const TODAY: (PipelineStep & { detail: string })[] = [
  {
    label: 'Repositories',
    caption: 'Frozen Git snapshots',
    icon: FolderGit2,
    color: '#60a5fa',
    detail:
      'Sources are discovered and captured as immutable, fingerprinted document versions.',
  },
  {
    label: 'Knowledge',
    caption: 'Deterministic extraction',
    icon: Network,
    color: '#34d399',
    detail:
      'Parser packs turn evidence into entities and relationships, each with provenance.',
  },
  {
    label: 'Publication',
    caption: 'Immutable snapshot',
    icon: Stamp,
    color: '#a78bfa',
    detail:
      'A Knowledge Model is published as a versioned, content-hashed package.',
  },
  {
    label: 'Exploration',
    caption: 'This explorer',
    icon: Compass,
    color: '#f472b6',
    detail:
      'People explore published knowledge and trace every fact back to evidence.',
  },
];

const FUTURE: (PipelineStep & { detail: string })[] = [
  {
    label: 'Publication',
    caption: 'The trust boundary',
    icon: Stamp,
    color: '#a78bfa',
    detail:
      'Everything downstream reads published knowledge only — never the operational state.',
  },
  {
    label: 'Search',
    caption: 'Lexical & structural',
    icon: Search,
    color: '#22d3ee',
    muted: true,
    detail: 'Find entities, relationships and evidence across publications.',
  },
  {
    label: 'Semantic Retrieval',
    caption: 'Meaning-aware lookup',
    icon: Sparkles,
    color: '#f59e0b',
    muted: true,
    detail:
      'Retrieve relevant facts with their provenance attached, ready to cite.',
  },
  {
    label: 'AI OS',
    caption: 'Grounded context',
    icon: BrainCircuit,
    color: '#818cf8',
    muted: true,
    detail:
      'An AI operating layer assembles context from published, cited facts.',
  },
  {
    label: 'Agents',
    caption: 'Act on evidence',
    icon: Bot,
    color: '#f472b6',
    muted: true,
    detail:
      'Agents answer and act using facts they can cite — and flag when a publication is stale.',
  },
];

const RULES: [boolean, string][] = [
  [true, 'AI reads immutable publications'],
  [true, 'AI cites provenance for every claim'],
  [true, 'AI checks publication currency'],
  [false, 'AI writes entities or relationships'],
  [false, 'AI infers facts from prose or folder names'],
  [false, 'AI bypasses the publication boundary'],
];

export function FutureScreen() {
  const [todayStep, setTodayStep] = useState(0);
  const [futureStep, setFutureStep] = useState(0);
  return (
    <div className="space-y-8">
      <ScreenHeader
        eyebrow="Future Direction"
        title="Published knowledge becomes the ground truth for AI"
        lead="Today people explore publications. Next, search, retrieval and agents consume the same publications — so every AI answer is grounded in evidence."
      />

      <section>
        <SectionTitle
          aside={
            <span className="text-xs text-emerald-500">Shipping today</span>
          }
        >
          Today
        </SectionTitle>
        <Pipeline steps={TODAY} active={todayStep} onSelect={setTodayStep} />
        <p
          key={todayStep}
          className="animate-fade-up mt-3 text-sm text-muted-foreground"
        >
          {TODAY[todayStep]?.detail}
        </p>
      </section>

      <section>
        <SectionTitle
          aside={
            <span className="text-xs text-muted-foreground">
              Direction of travel
            </span>
          }
        >
          Future
        </SectionTitle>
        <Pipeline steps={FUTURE} active={futureStep} onSelect={setFutureStep} />
        <p
          key={futureStep}
          className="animate-fade-up mt-3 text-sm text-muted-foreground"
        >
          {FUTURE[futureStep]?.detail}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex items-center gap-3 rounded-2xl border bg-card p-5">
          <ShieldCheck className="size-10 text-primary" />
          <div>
            <div className="font-semibold">The publication boundary</div>
            <div className="text-sm text-muted-foreground">
              Facts flow in one direction.
            </div>
          </div>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {RULES.map(([allowed, text]) => (
            <li
              key={text}
              className="flex items-center gap-2 rounded-lg border bg-card p-3 text-sm"
            >
              {allowed ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="size-4 shrink-0 text-rose-500" />
              )}
              {text}
            </li>
          ))}
        </ul>
      </section>

      <KeyMessage>
        AI consumes published knowledge.{' '}
        <span className="text-gradient">AI does not create facts.</span>
      </KeyMessage>
    </div>
  );
}
