#!/usr/bin/env node
/**
 * chunk.mjs — split a .txt or .md file into multiple chunk files
 *
 * Usage:
 *   node chunk.mjs <input-file> [options]
 *
 * Options:
 *   --max-words <n>   Max words per chunk (default: 600)
 *   --out <dir>       Output directory (default: same dir as input file)
 *   --prefix <str>    Output filename prefix (default: input basename)
 *   --ext <str>       Output file extension (default: .md)
 *
 * Example:
 *   node chunk.mjs docs/report.md --max-words 400 --out chunks/
 */

import fs from "fs";
import path from "path";

// ── Chunker logic (mirrors src/lib/doc-chunker.ts) ───────────────────────────

function stripBackmatter(text) {
  const re =
    /\n#{0,3}\s*(references|bibliography|works\s+cited|sources|further\s+reading)\b/i;
  const idx = text.search(re);
  return idx >= 0 ? text.slice(0, idx) : text;
}

function splitDocumentIntoChunks(text, maxWords = 600) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = stripBackmatter(normalized);

  let sections = [];
  if (/\n#{1,3} /.test(body)) {
    sections = body.split(/\n(?=#{1,3} )/).filter((s) => s.trim());
  }
  if (sections.length <= 1) {
    sections = body.split(/\n{2,}/).filter((s) => s.trim());
  }

  const chunks = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (trimmed.split(/\s+/).length <= maxWords) {
      chunks.push(trimmed);
      continue;
    }
    let remaining = trimmed;
    while (remaining.length > 0) {
      const words = remaining.split(/\s+/);
      if (words.length <= maxWords) {
        chunks.push(remaining);
        break;
      }
      let charPos = 0;
      let wc = 0;
      for (let i = 1; i < remaining.length; i++) {
        if (/\s/.test(remaining[i]) && /\S/.test(remaining[i - 1])) {
          wc++;
          if (wc >= maxWords) {
            charPos = i;
            break;
          }
        }
      }
      const slice = remaining.slice(0, charPos);
      const sentenceEnd = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf(".\n"),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
      );
      const splitAt = sentenceEnd > 0 ? sentenceEnd + 1 : charPos;
      chunks.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
    }
  }
  return chunks.filter((c) => c.length > 0);
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(
    `Usage: node chunk.mjs <input-file> [--max-words N] [--out DIR] [--prefix STR] [--ext EXT]`,
  );
  process.exit(0);
}

const inputFile = args[0];
let maxWords = 600;
let outDir = null;
let prefix = null;
let ext = ".md";

for (let i = 1; i < args.length; i++) {
  switch (args[i]) {
    case "--max-words":
      maxWords = parseInt(args[++i], 10);
      break;
    case "--out":
      outDir = args[++i];
      break;
    case "--prefix":
      prefix = args[++i];
      break;
    case "--ext":
      ext = args[++i].startsWith(".") ? args[i] : "." + args[i];
      break;
    default:
      console.error(`Unknown option: ${args[i]}`);
      process.exit(1);
  }
}

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

const resolved = path.resolve(inputFile);
const inputExt = path.extname(resolved);
if (![".txt", ".md"].includes(inputExt.toLowerCase())) {
  console.error(`Input must be a .txt or .md file (got ${inputExt})`);
  process.exit(1);
}

if (!outDir) outDir = path.dirname(resolved);
if (!prefix) prefix = path.basename(resolved, inputExt);

fs.mkdirSync(outDir, { recursive: true });

// ── Run ───────────────────────────────────────────────────────────────────────

const text = fs.readFileSync(resolved, "utf8");
const chunks = splitDocumentIntoChunks(text, maxWords);

if (chunks.length === 0) {
  console.error("No chunks produced — is the file empty?");
  process.exit(1);
}

const pad = String(chunks.length).length;

chunks.forEach((chunk, i) => {
  const n = String(i + 1).padStart(pad, "0");
  const outPath = path.join(outDir, `${prefix}-${n}${ext}`);
  fs.writeFileSync(outPath, chunk, "utf8");
});

console.log(
  `✓ ${chunks.length} chunk${chunks.length === 1 ? "" : "s"} written to ${path.resolve(outDir)}/`,
);
chunks.forEach((chunk, i) => {
  const n = String(i + 1).padStart(pad, "0");
  const words = chunk.split(/\s+/).length;
  console.log(`  ${prefix}-${n}${ext}  (${words} words)`);
});
