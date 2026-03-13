import type { PageServerLoad } from "./$types";
import { readdir, readFile } from "fs/promises";
import path from "path";

interface StoryMeta {
  slug: string;
  title: string;
  premise: string;
  date: string;
  authors: string[];
}

function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, string | string[]> = {};
  const lines = match[1].split("\n");
  let currentKey = "";
  let inList = false;
  const listItems: string[] = [];

  for (const line of lines) {
    if (line.startsWith("  - ")) {
      inList = true;
      listItems.push(line.slice(4).replace(/^"(.*)"$/, "$1"));
    } else {
      if (inList && currentKey) {
        fm[currentKey] = [...listItems];
        listItems.length = 0;
        inList = false;
      }
      const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
      if (kv) {
        currentKey = kv[1];
        const val = kv[2];
        if (val)
          fm[currentKey] = val.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        else fm[currentKey] = "";
      }
    }
  }
  if (inList && currentKey) fm[currentKey] = [...listItems];
  return fm;
}

export const load: PageServerLoad = async () => {
  const storiesDir = path.join(process.cwd(), "data", "stories");
  let stories: StoryMeta[] = [];

  try {
    const files = await readdir(storiesDir);
    const mdFiles = files
      .filter((f: string) => f.endsWith(".md"))
      .sort()
      .reverse();

    stories = await Promise.all(
      mdFiles.map(async (file: string) => {
        const raw = await readFile(path.join(storiesDir, file), "utf-8");
        const fm = parseFrontmatter(raw);
        return {
          slug: (fm.slug as string) || file.replace(".md", ""),
          title: (fm.title as string) || "Untitled",
          premise: (fm.premise as string) || "",
          date: (fm.date as string) || "",
          authors: (fm.authors as string[]) || [],
        };
      }),
    );
  } catch {
    // data/stories/ doesn't exist yet — return empty list
  }

  return { stories };
};
