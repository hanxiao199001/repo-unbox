#!/usr/bin/env node
// Reads this session's transcript and totals token usage, optionally between
// two timestamps so a run can be measured phase by phase.
//
//   node scripts/token-usage.mjs                       whole session
//   node scripts/token-usage.mjs --since <ISO>         from a marker
//   node scripts/token-usage.mjs --since <ISO> --until <ISO>
//   node scripts/token-usage.mjs --phases a.json       {"name":"ISO", ...} boundaries
//
// Claude Code writes one JSON object per line; assistant lines carry a usage
// block. Cache reads and cache writes are counted separately from fresh input
// because they cost differently and because a big cache-read number is exactly
// what a long skill file produces.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};

const dir = flag('--dir') || path.join(os.homedir(), '.claude', 'projects', '-Users-a01-Claude');
const file = flag('--file') || fs.readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m)[0].f;

const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean);

function collect(since, until) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 };
  // Each assistant message appears in the transcript once per content block;
  // counting every line would roughly double every figure.
  const seen = new Set();
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const usage = entry?.message?.usage;
    if (!usage) continue;
    const id = entry.message.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const ts = entry.timestamp;
    if (since && ts < since) continue;
    if (until && ts > until) continue;
    total.input += usage.input_tokens || 0;
    total.output += usage.output_tokens || 0;
    total.cacheRead += usage.cache_read_input_tokens || 0;
    total.cacheWrite += usage.cache_creation_input_tokens || 0;
    total.messages += 1;
  }
  return total;
}

const fmt = (n) => n.toLocaleString('en-US');
function print(label, t) {
  console.log(`${label}`);
  console.log(`  input (fresh)      ${fmt(t.input).padStart(12)}`);
  console.log(`  cache write        ${fmt(t.cacheWrite).padStart(12)}`);
  console.log(`  cache read         ${fmt(t.cacheRead).padStart(12)}`);
  console.log(`  output             ${fmt(t.output).padStart(12)}`);
  console.log(`  ---`);
  console.log(`  total in           ${fmt(t.input + t.cacheWrite + t.cacheRead).padStart(12)}`);
  console.log(`  total out          ${fmt(t.output).padStart(12)}`);
  console.log(`  assistant turns    ${fmt(t.messages).padStart(12)}`);
}

const phasesFile = flag('--phases');
if (phasesFile) {
  const marks = JSON.parse(fs.readFileSync(phasesFile, 'utf8'));
  const names = Object.keys(marks);
  console.log(`transcript: ${file}\n`);
  for (let i = 0; i < names.length - 1; i += 1) {
    print(`[${names[i]}]  ${marks[names[i]]} → ${marks[names[i + 1]]}`, collect(marks[names[i]], marks[names[i + 1]]));
    console.log('');
  }
  print('[TOTAL]', collect(marks[names[0]], marks[names[names.length - 1]]));
} else {
  console.log(`transcript: ${file}\n`);
  print(flag('--since') ? `since ${flag('--since')}` : 'whole session', collect(flag('--since'), flag('--until')));
}
