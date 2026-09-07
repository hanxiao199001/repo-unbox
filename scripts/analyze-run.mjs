#!/usr/bin/env node
// Breaks one Claude Code session transcript into phases and reports what each
// phase cost, plus which files were read.
//
//   node scripts/analyze-run.mjs <transcript.jsonl>
//
// Caveat worth knowing before trusting the phase split: a turn's token cost
// reflects the context it was given, and a file read by turn N only enters the
// context of turn N+1. So a phase's cost lands slightly late — the numbers show
// where the weight is, not an exact per-action price.

import fs from 'node:fs';

const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

const PHASES = ['read-skill', 'read-repo', 'write-course', 'build-validate', 'no-tool', 'other'];
const totals = Object.fromEntries(PHASES.map((p) => [p, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }]));

const readFiles = new Set();
const writtenFiles = new Set();
const commands = [];
let first = null;
let last = null;
let model = null;

// Classification works off whatever the turn actually touched, including the
// text of Bash commands — this run did all of its reading and writing through
// cat/sed/heredocs rather than the Read and Write tools.
function classify(tools) {
  if (tools.length === 0) return 'no-tool';
  const joined = tools.join(' | ');
  if (/build\.mjs|validate\.mjs|test-elements/.test(joined)) return 'build-validate';
  if (/(cat|tee) *> *[^|]*output\/|Write:.*output\/|Edit:.*output\//.test(joined)) return 'write-course';
  if (/SKILL\.md|references\/|scripts\//.test(joined)) return 'read-skill';
  if (/signal-log/.test(joined)) return 'read-repo';
  if (/output\//.test(joined)) return 'write-course';
  return 'other';
}

// The transcript logs one entry per content block, so a single assistant
// message appears several times: usage must be counted once, but the tool calls
// have to be gathered across every entry that shares the message id.
const byMessage = new Map();

for (const line of lines) {
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.timestamp) { first ??= e.timestamp; last = e.timestamp; }
  const usage = e?.message?.usage;
  if (!usage) continue;
  model ??= e.message.model;
  const id = e.message.id || Math.random().toString(36);
  if (!byMessage.has(id)) byMessage.set(id, { usage, tools: [] });
  const rec = byMessage.get(id);

  for (const block of e.message.content || []) {
    if (block.type !== 'tool_use') continue;
    const i = block.input || {};
    const target = i.file_path || i.path || i.pattern || i.command || i.skill || '';
    rec.tools.push(`${block.name}:${String(target).slice(0, 300)}`);
    if (block.name === 'Read' && i.file_path) readFiles.add(i.file_path);
    if ((block.name === 'Write' || block.name === 'Edit') && i.file_path) writtenFiles.add(i.file_path);
    if (block.name === 'Bash' && i.command) commands.push(String(i.command).slice(0, 200));
  }
}

for (const { usage, tools } of byMessage.values()) {
  const t = totals[classify(tools)];
  t.input += usage.input_tokens || 0;
  t.output += usage.output_tokens || 0;
  t.cacheRead += usage.cache_read_input_tokens || 0;
  t.cacheWrite += usage.cache_creation_input_tokens || 0;
  t.turns += 1;
}

const n = (x) => x.toLocaleString('en-US');
console.log(`transcript: ${file}`);
console.log(`window: ${first} → ${last}`);
if (first && last) console.log(`wall clock: ${Math.round((Date.parse(last) - Date.parse(first)) / 1000)}s`);
console.log('');
console.log('phase             turns    fresh in   cache write    cache read      output');
let g = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
for (const p of PHASES) {
  const t = totals[p];
  if (!t.turns) continue;
  console.log(`${p.padEnd(16)} ${String(t.turns).padStart(5)} ${n(t.input).padStart(11)} ${n(t.cacheWrite).padStart(13)} ${n(t.cacheRead).padStart(13)} ${n(t.output).padStart(11)}`);
  for (const k of Object.keys(g)) g[k] += t[k];
}
console.log(`${'TOTAL'.padEnd(16)} ${String(g.turns).padStart(5)} ${n(g.input).padStart(11)} ${n(g.cacheWrite).padStart(13)} ${n(g.cacheRead).padStart(13)} ${n(g.output).padStart(11)}`);
console.log('');
console.log(`input总计 (fresh + cache write + cache read): ${n(g.input + g.cacheWrite + g.cacheRead)}`);
console.log(`output总计: ${n(g.output)}`);
// ── Cost ──────────────────────────────────────────────────────
// Rates in USD per million tokens. Derived from this run and checked against the
// figure the SDK reported: 58 fresh + 158,649 1h-cache-write + 2,751,962
// cache-read + 63,179 output priced at 5 / 10 / 0.5 / 25 comes to $4.542236,
// which is what result.json said to the last cent. Cache write here is the
// one-hour TTL (2x input); a 5-minute write would be 1.25x.
// Sonnet's rates were derived the same way from its own run and also close to
// the cent: 60 + 147,712 + 3,337,390 + 59,123 at 2 / 4 / 0.2 / 10 gives
// $1.849676, which is what that result.json reported.
const RATES = {
  'claude-opus-5': { input: 5, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5': { input: 2, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
};
const rate = RATES[model];
if (rate) {
  const usd = {
    'fresh input': (g.input / 1e6) * rate.input,
    'cache write (1h)': (g.cacheWrite / 1e6) * rate.cacheWrite1h,
    'cache read': (g.cacheRead / 1e6) * rate.cacheRead,
    output: (g.output / 1e6) * rate.output,
  };
  const total = Object.values(usd).reduce((a, b) => a + b, 0);
  console.log(`cost (${model}, $${rate.input}/$${rate.cacheWrite1h}/$${rate.cacheRead}/$${rate.output} per M):`);
  for (const [k, v] of Object.entries(usd)) {
    console.log(`  ${k.padEnd(18)} $${v.toFixed(4).padStart(8)}   ${((v / total) * 100).toFixed(1).padStart(5)}%`);
  }
  console.log(`  ${'TOTAL'.padEnd(18)} $${total.toFixed(4).padStart(8)}`);
  console.log('');
}

console.log('');
console.log(`files read (${readFiles.size}):`);
for (const f of [...readFiles].sort()) console.log(`  ${f}`);
console.log('');
console.log(`files written (${writtenFiles.size}):`);
for (const f of [...writtenFiles].sort()) console.log(`  ${f}`);
console.log('');
console.log(`bash commands (${commands.length}):`);
for (const c of commands) console.log(`  $ ${c}`);
