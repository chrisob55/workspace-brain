import { BookOpenText, ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { KeyMessage, ScreenHeader } from '@/components/story';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import faqMarkdown from '../../../../docs/architecture/architecture-faq.md?raw';

interface FaqQuestion {
  number: number;
  question: string;
  answer: string;
}

interface FaqSection {
  id: string;
  title: string;
  questions: FaqQuestion[];
}

const SECTION_HEADING = /^### Section (\d+) - (.+)$/gm;
const QUESTION_HEADING = /^(\d+)\. \*\*(.+?)\*\*\s*$/gm;

function sectionQuestions(content: string): FaqQuestion[] {
  const matches = [...content.matchAll(QUESTION_HEADING)];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    const answer = content
      .slice(start, end)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');

    return {
      number: Number(match[1]),
      question: match[2] ?? '',
      answer,
    };
  });
}

function parseSections(markdown: string): FaqSection[] {
  const headings = [...markdown.matchAll(SECTION_HEADING)];
  return headings.map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const nextSection = headings[index + 1]?.index;
    const nextTopLevelHeading = markdown.indexOf('\n## ', start);
    const end =
      nextSection ??
      (nextTopLevelHeading === -1 ? markdown.length : nextTopLevelHeading);
    return {
      id: `section-${heading[1]}`,
      title: heading[2] ?? '',
      questions: sectionQuestions(markdown.slice(start, end)),
    };
  });
}

function parseExecutiveSummary(markdown: string): string[] {
  const summary = markdown.match(
    /^## Executive Summary\s*([\s\S]*?)(?=^## )/m,
  )?.[1];
  if (!summary) return [];

  return summary
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/\s*\n\s*/g, ' ')
        .replace(/^>\s*/, '')
        .trim(),
    )
    .filter(Boolean);
}

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

const FAQ_SECTIONS = parseSections(faqMarkdown);
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
  const [activeSection, setActiveSection] = useState('all');
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visibleSections = useMemo(
    () =>
      FAQ_SECTIONS.filter(
        (section) => activeSection === 'all' || section.id === activeSection,
      )
        .map((section) => ({
          ...section,
          questions: section.questions.filter(
            ({ question, answer }) =>
              !normalizedQuery ||
              `${question} ${answer}`
                .toLocaleLowerCase()
                .includes(normalizedQuery),
          ),
        }))
        .filter((section) => section.questions.length > 0),
    [activeSection, normalizedQuery],
  );

  const visibleCount = visibleSections.reduce(
    (count, section) => count + section.questions.length,
    0,
  );

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
        {EXECUTIVE_SUMMARY.map((paragraph, index) => (
          <p
            key={index}
            className="max-w-4xl text-sm leading-relaxed text-muted-foreground"
          >
            <InlineMarkdown text={paragraph} />
          </p>
        ))}
        <KeyMessage className="mt-5">
          Deterministic, evidence-backed knowledge is the current product.
          Future AI may propose candidates; it does not establish facts.
        </KeyMessage>
      </section>

      <section aria-label="Browse architecture questions">
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
          <p
            className="text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {visibleCount} of {QUESTION_COUNT} questions
          </p>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => setActiveSection('all')}
            aria-pressed={activeSection === 'all'}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              activeSection === 'all'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            All topics
          </button>
          {FAQ_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              aria-pressed={activeSection === section.id}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                activeSection === section.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {section.title}
            </button>
          ))}
        </div>

        {visibleCount === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <BookOpenText className="mx-auto mb-3 size-6 text-muted-foreground" />
            <p className="font-medium">No matching questions</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try another term or choose a different topic.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {visibleSections.map((section) => (
              <section key={section.id} aria-labelledby={`${section.id}-title`}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
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
                <div className="divide-y overflow-hidden rounded-xl border bg-card">
                  {section.questions.map((item) => (
                    <details
                      key={`${section.id}-${item.number}`}
                      className="group"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 font-medium marker:hidden hover:bg-accent/50 [&::-webkit-details-marker]:hidden">
                        <span>{item.question}</span>
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="border-t bg-muted/30 px-4 py-4 text-sm leading-relaxed text-muted-foreground">
                        <InlineMarkdown text={item.answer} />
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}
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
