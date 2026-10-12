import { BookOpenText, ChevronRight, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { ScreenHeader } from '@/components/story';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  filterFaqSections,
  parseExecutiveSummary,
  parseFaqSections,
} from '@/lib/architecture-faq';
import { cn } from '@/lib/utils';

import faqMarkdown from '../../../../docs/architecture/architecture-faq.md?raw';

function extractSection(markdown: string, title: string): string {
  const heading = `## ${title}`;
  const headingIndex = markdown.indexOf(`${heading}\n`);
  if (headingIndex === -1) return '';

  const contentStart = headingIndex + heading.length + 1;
  const nextHeading = markdown.indexOf('\n## ', contentStart);
  return markdown
    .slice(contentStart, nextHeading === -1 ? markdown.length : nextHeading)
    .trim();
}

function parseNumberedList(content: string): string[] {
  const matches = [...content.matchAll(/^\d+\.\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    return [match[1] ?? '', ...content.slice(start, end).split('\n')]
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');
  });
}

function parseBulletList(content: string): string[] {
  const matches = [...content.matchAll(/^- (.+)$/gm)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    return [match[1] ?? '', ...content.slice(start, end).split('\n')]
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');
  });
}

function parseTable(content: string): string[][] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|[\s|:-]+\|$/.test(line))
    .map((line) =>
      line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
}

const FAQ_SECTIONS = parseFaqSections(faqMarkdown);
const EXECUTIVE_SUMMARY = parseExecutiveSummary(faqMarkdown);
const CHALLENGES = parseTable(
  extractSection(faqMarkdown, 'Common Architecture Challenges'),
).slice(1);
const MISUNDERSTANDINGS = parseBulletList(
  extractSection(faqMarkdown, 'Common Misunderstandings'),
);
const ARCHITECT_QUESTIONS = parseNumberedList(
  extractSection(faqMarkdown, 'Questions Architects Should Ask'),
);
const PLATFORM_QUESTIONS = parseBulletList(
  extractSection(
    faqMarkdown,
    'Questions Workspace Brain Should Be Able To Answer',
  ),
);
const QUESTION_COUNT = FAQ_SECTIONS.reduce(
  (count, section) => count + section.questions.length,
  0,
);

function InlineMarkdown({ text }: { text: string }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);

  return (
    <>
      {tokens.map((token, index) => {
        if (token.startsWith('**') && token.endsWith('**')) {
          return <strong key={index}>{token.slice(2, -2)}</strong>;
        }
        if (token.startsWith('`') && token.endsWith('`')) {
          return (
            <code
              key={index}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]"
            >
              {token.slice(1, -1)}
            </code>
          );
        }
        const link = token.match(/^\[([^\]]+)\]\([^)]+\)$/);
        if (link) {
          return (
            <span
              key={index}
              className="underline decoration-dotted underline-offset-4"
            >
              {link[1]}
            </span>
          );
        }
        return token;
      })}
    </>
  );
}

export function ArchitectureFaqScreen() {
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const answerHeading = useRef<HTMLHeadingElement>(null);

  const visibleSections = useMemo(
    () => filterFaqSections(FAQ_SECTIONS, activeSection, query),
    [activeSection, query],
  );
  const visibleQuestions = visibleSections.flatMap((section) =>
    section.questions.map((question) => ({
      ...question,
      topic: section.title,
    })),
  );
  const selected =
    visibleQuestions.find((question) => question.id === selectedId) ??
    visibleQuestions[0];
  const visibleCount = visibleSections.reduce(
    (count, section) => count + section.questions.length,
    0,
  );

  function selectQuestion(id: string) {
    setSelectedId(id);
    requestAnimationFrame(() => {
      answerHeading.current?.scrollIntoView({
        block: window.matchMedia('(min-width: 1024px)').matches
          ? 'nearest'
          : 'start',
      });
    });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <ScreenHeader
        eyebrow="Architecture Review"
        title="Architecture FAQ"
        lead="A practical reference for the platform’s boundaries, guarantees and open architectural constraints."
      />

      <section className="mb-8 space-y-3" aria-labelledby="faq-summary">
        <h2
          id="faq-summary"
          className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
        >
          Executive summary
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            [
              'What it does',
              'Turns configured repositories and documents into immutable, versioned Knowledge Models with traceable evidence.',
            ],
            [
              'What to trust',
              'Sources remain authoritative. Provenance explains a claim; it does not guarantee completeness or correctness.',
            ],
            [
              'What it is not',
              'Not a chat, agent or RAG platform. Today’s extraction and search are deterministic; future AI may propose candidates, not establish facts.',
            ],
          ].map(([title, text]) => (
            <article key={title} className="rounded-xl border bg-card p-4">
              <h3 className="mb-2 text-sm font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {text}
              </p>
            </article>
          ))}
        </div>
        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Read the full executive summary
          </summary>
          <div className="space-y-3 border-t px-4 py-3">
            {EXECUTIVE_SUMMARY.map((paragraph, index) => (
              <p
                key={index}
                className="max-w-4xl text-sm leading-relaxed text-muted-foreground"
              >
                <InlineMarkdown text={paragraph} />
              </p>
            ))}
          </div>
        </details>
      </section>

      <section aria-label="Browse architecture questions">
        <h2 className="mb-1 text-lg font-semibold">Find an answer</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Search or choose a topic, then select a question to read its answer.
        </p>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search questions and answers"
              className="pl-9"
              aria-label="Search architecture FAQ"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">Topic</span>
            <select
              value={activeSection}
              onChange={(event) => setActiveSection(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-64"
            >
              <option value="">All topics</option>
              {FAQ_SECTIONS.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title}
                </option>
              ))}
            </select>
          </label>
          <p
            className="text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {visibleCount} of {QUESTION_COUNT} questions
          </p>
        </div>

        {visibleCount === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <BookOpenText className="mx-auto mb-3 size-6 text-muted-foreground" />
            <p className="font-medium">No matching questions</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try another term or choose a different topic.
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => {
                setQuery('');
                setActiveSection('');
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="max-h-72 overflow-y-auto rounded-xl border bg-card p-2 lg:max-h-[32rem]">
              {visibleSections.map((section) => (
                <section
                  key={section.id}
                  aria-labelledby={`${section.id}-title`}
                  className="mb-4 last:mb-0"
                >
                  <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-card px-2 py-2">
                    <h2
                      id={`${section.id}-title`}
                      className="text-sm font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {section.title}
                    </h2>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {section.questions.length} questions
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {section.questions.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-pressed={selected?.id === item.id}
                          aria-controls="faq-answer"
                          onClick={() => selectQuestion(item.id)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            selected?.id === item.id
                              ? 'border-primary bg-primary/10 font-medium'
                              : 'border-transparent hover:bg-accent',
                          )}
                        >
                          <span>{item.question}</span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            {selected && (
              <article
                id="faq-answer"
                aria-labelledby="faq-answer-heading"
                className="min-w-0 rounded-xl border bg-card p-5 lg:sticky lg:top-4 lg:max-h-[32rem] lg:overflow-y-auto"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  {selected.topic}
                </p>
                <h3
                  id="faq-answer-heading"
                  ref={answerHeading}
                  className="scroll-mt-4 text-xl font-semibold"
                >
                  {selected.question}
                </h3>
                <div
                  key={selected.id}
                  className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground"
                >
                  {selected.answer.split('\n\n').map((paragraph, index) => (
                    <p key={index}>
                      <InlineMarkdown text={paragraph} />
                    </p>
                  ))}
                </div>
                <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
                  Source: Architecture FAQ · {selected.topic} · Question{' '}
                  {selected.number}
                </p>
              </article>
            )}
          </div>
        )}
      </section>

      <section className="mt-12 space-y-8">
        <div>
          <h2 className="mb-4 text-lg font-semibold">
            Common architecture challenges
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {CHALLENGES.map(([challenge, response, concern]) => (
              <article
                key={challenge}
                className="rounded-xl border bg-card p-4"
              >
                <h3 className="font-medium">{challenge}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  <InlineMarkdown text={response ?? ''} />
                </p>
                <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Residual concern:
                  </span>
                  <InlineMarkdown text={concern ?? ''} />
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              Common misunderstandings
            </h2>
            <ul className="space-y-2">
              {MISUNDERSTANDINGS.map((item) => (
                <li
                  key={item}
                  className="rounded-lg border bg-card px-4 py-3 text-sm leading-relaxed text-muted-foreground"
                >
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-3 text-lg font-semibold">
              Questions architects should ask
            </h2>
            <ol className="space-y-2">
              {ARCHITECT_QUESTIONS.map((question, index) => (
                <li
                  key={question}
                  className="flex gap-3 rounded-lg border bg-card px-4 py-3 text-sm leading-relaxed"
                >
                  <span className="font-mono text-xs text-primary">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <InlineMarkdown text={question} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">
            Questions Workspace Brain should be able to answer
          </h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {PLATFORM_QUESTIONS.map((question) => (
              <li
                key={question}
                className="rounded-lg border bg-card px-4 py-3 text-sm leading-relaxed text-muted-foreground"
              >
                <InlineMarkdown text={question} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
