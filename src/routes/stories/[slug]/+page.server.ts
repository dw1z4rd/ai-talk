import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { readFile } from 'fs/promises';
import path from 'path';
import { marked } from 'marked';

function parseFrontmatter(raw: string): {
  meta: Record<string, string | string[]>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const meta: Record<string, string | string[]> = {};
  const lines = match[1].split('\n');
  let currentKey = '';
  let inList = false;
  const listItems: string[] = [];

  for (const line of lines) {
    if (line.startsWith('  - ')) {
      inList = true;
      listItems.push(line.slice(4).replace(/^"(.*)"$/, '$1'));
    } else {
      if (inList && currentKey) {
        meta[currentKey] = [...listItems];
        listItems.length = 0;
        inList = false;
      }
      const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
      if (kv) {
        currentKey = kv[1];
        const val = kv[2];
        if (val) meta[currentKey] = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        else meta[currentKey] = '';
      }
    }
  }
  if (inList && currentKey) meta[currentKey] = [...listItems];

  return { meta, body: match[2].trim() };
}

export const load: PageServerLoad = async ({ params }) => {
  const { slug } = params;

  // Basic slug safety — no path traversal
  if (!/^[\w-]+$/.test(slug)) throw error(400, 'Invalid slug');

  const filePath = path.join(process.cwd(), 'data', 'stories', `${slug}.md`);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    throw error(404, 'Story not found');
  }

  const { meta, body } = parseFrontmatter(raw);
  const html = await marked(body, { breaks: true });

  return {
    title: (meta.title as string) || 'Untitled',
    premise: (meta.premise as string) || '',
    date: (meta.date as string) || '',
    authors: (meta.authors as string[]) || [],
    slug,
    html
  };
};