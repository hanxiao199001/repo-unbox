// Verbatim code-block checking, shared by validate.mjs.
//
// The rule this enforces: every code block in a course must be a run of
// CONSECUTIVE lines copied verbatim out of a real source file, and must cite
// where it came from. Doctored code is the failure mode that human review does
// not catch, because a tidied-up snippet reads better than the real one.

import fs from 'node:fs';
import path from 'node:path';

const CODE_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'html', 'css', 'json', 'py', 'go', 'rs', 'rb', 'java', 'sh']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'data', 'coverage']);

export function decodeHtml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Every source file we are allowed to match against.
export function collectSources(sourceDir) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (CODE_EXTENSIONS.has(entry.name.split('.').pop())) {
        out.set(path.relative(sourceDir, full), fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(sourceDir);
  return out;
}

// Pull each code-pair block out of the assembled HTML, along with the
// file:line source label that sits immediately before it.
//
// Only .kc-code-pair blocks are checked. .kc-bughunt code is deliberately
// broken — running it through the verbatim check would fail every course.
export function extractCodeBlocks(html) {
  const blocks = [];
  const re = /(?:<p class="kc-code-pair__source"[^>]*>([\s\S]*?)<\/p>\s*)?<pre[^>]*\bdata-kc-lang="en"[^>]*>([\s\S]*?)<\/pre>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const label = (m[1] || '').replace(/<[^>]+>/g, '').trim();
    const text = decodeHtml(m[2].replace(/<[^>]+>/g, ''));
    const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
    // Blank lines INSIDE the block are part of it; only trim the edges.
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    blocks.push({
      label: /^[\w./-]+:\d+-\d+$/.test(label) ? label : '',
      lines,
      firstLine: (lines[0] || '').trim(),
    });
  }
  return blocks;
}

// Find the block as a run of consecutive lines in some source file.
// Comparison ignores each line's leading indentation, so a block may be
// dedented as a whole — but every line must otherwise match character for
// character, blank lines included.
export function findVerbatim(lines, sources) {
  if (lines.length === 0) return null;
  const want = lines.map((l) => l.trim());
  for (const [rel, src] of sources) {
    const srcLines = src.split('\n').map((l) => l.replace(/\s+$/, '').trim());
    for (let i = 0; i + want.length <= srcLines.length + 1; i += 1) {
      let ok = true;
      for (let j = 0; j < want.length; j += 1) {
        if (srcLines[i + j] !== want[j]) { ok = false; break; }
      }
      if (ok) return `${rel}:${i + 1}-${i + want.length}`;
    }
  }
  return null;
}
