import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

interface Paragraph {
  agentName: string;
  color: string;
  text: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50)
    .replace(/-+$/, '');
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function escapeYaml(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

export const POST: RequestHandler = async ({ request }) => {
  const { premise, paragraphs } = (await request.json()) as {
    premise: string;
    paragraphs: Paragraph[];
  };

  if (!premise?.trim() || !paragraphs?.length) {
    throw error(400, 'premise and paragraphs are required');
  }

  const date = new Date().toISOString().slice(0, 10);
  const baseSlug = slugify(premise) || 'story';
  const slug = `${date}-${baseSlug}-${randomSuffix()}`;

  // Derive title from premise (first 70 chars, sentence-cased)
  const rawTitle = premise.trim().slice(0, 70);
  const title = rawTitle.length < premise.trim().length ? rawTitle + '…' : rawTitle;

  // Unique author list (preserving order)
  const authors = [...new Set(paragraphs.map((p) => p.agentName))];

  // Build YAML frontmatter
  const authorsYaml = authors.map((a) => `  - "${escapeYaml(a)}"`).join('\n');
  const frontmatter = [
    '---',
    `title: "${escapeYaml(title)}"`,
    `premise: "${escapeYaml(premise.trim())}"`,
    `date: "${date}"`,
    `slug: "${slug}"`,
    `authors:`,
    authorsYaml,
    '---',
  ].join('\n');

  // Build markdown body
  const body = paragraphs
    .map((p) => `${p.text}\n\n*— ${p.agentName}*`)
    .join('\n\n---\n\n');

  const markdown = `${frontmatter}\n\n${body}\n`;

  // Write to data/stories/
  const storiesDir = path.join(process.cwd(), 'data', 'stories');
  await mkdir(storiesDir, { recursive: true });
  await writeFile(path.join(storiesDir, `${slug}.md`), markdown, 'utf-8');

  return json({ slug, title });
};