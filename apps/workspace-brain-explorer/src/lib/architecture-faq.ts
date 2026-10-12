export interface FaqQuestion {
  id: string;
  number: number;
  question: string;
  answer: string;
}

export interface FaqSection {
  id: string;
  title: string;
  questions: FaqQuestion[];
}

function paragraphs(content: string): string[] {
  return content
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

export function parseFaqSections(markdown: string): FaqSection[] {
  const headings = [...markdown.matchAll(/^### Section (\d+) - (.+)$/gm)];
  return headings.map((heading, index) => {
    const id = `section-${heading[1]}`;
    const start = (heading.index ?? 0) + heading[0].length;
    const nextSection = headings[index + 1]?.index ?? markdown.length;
    const nextTopLevelHeading = markdown.indexOf('\n## ', start);
    const end = Math.min(
      nextSection,
      nextTopLevelHeading === -1 ? markdown.length : nextTopLevelHeading,
    );
    const content = markdown.slice(start, end);
    const matches = [...content.matchAll(/^(\d+)\. \*\*(.+?)\*\*\s*$/gm)];
    return {
      id,
      title: heading[2] ?? '',
      questions: matches.map((match, questionIndex) => ({
        id: `${id}-question-${match[1]}`,
        number: Number(match[1]),
        question: match[2] ?? '',
        answer: paragraphs(
          content.slice(
            (match.index ?? 0) + match[0].length,
            matches[questionIndex + 1]?.index ?? content.length,
          ),
        ).join('\n\n'),
      })),
    };
  });
}

export function parseExecutiveSummary(markdown: string): string[] {
  const summary = markdown.match(
    /^## Executive Summary\s*([\s\S]*?)(?=^## |(?![\s\S]))/m,
  )?.[1];
  return summary ? paragraphs(summary) : [];
}

export function filterFaqSections(
  sections: FaqSection[],
  activeSection: string,
  query: string,
): FaqSection[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return sections
    .filter((section) => !activeSection || section.id === activeSection)
    .map((section) => ({
      ...section,
      questions: section.questions.filter(({ question, answer }) =>
        `${question} ${answer}`.toLocaleLowerCase().includes(normalizedQuery),
      ),
    }))
    .filter((section) => section.questions.length > 0);
}
