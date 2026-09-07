#!/usr/bin/env node
// Installs this skill into ~/.claude/skills/repo-unbox/ so it can be used from
// any directory, not just this repository.
//
//   node scripts/install.mjs            install (replaces the previous copy)
//   node scripts/install.mjs --dry-run  print what would be copied
//   node scripts/install.mjs --target <dir>
//
// What goes: SKILL.md, references/ (including the fonts), scripts/.
// What stays behind: output/, examples/, spec/, .git, node_modules —
// the repository's own working material, none of which a user of the skill needs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_NAME = 'repo-unbox';
// Renamed from this in v0.2. An install left behind under the old name still
// registers with Claude Code, so the user would silently get the old skill.
const FORMER_SKILL_NAME = 'codebase-course-cn';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetFlag = args.indexOf('--target');
const target = targetFlag !== -1 && args[targetFlag + 1]
  ? path.resolve(args[targetFlag + 1])
  : path.join(os.homedir(), '.claude', 'skills', SKILL_NAME);

const INCLUDE = ['SKILL.md', 'references', 'scripts'];
const EXCLUDE_DIRS = new Set(['output', 'examples', '.git', 'node_modules', '.DS_Store']);

let files = 0;
let bytes = 0;

function copy(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    if (EXCLUDE_DIRS.has(path.basename(from))) return;
    if (!dryRun) fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
      if (entry === '.DS_Store') continue;
      copy(path.join(from, entry), path.join(to, entry));
    }
  } else {
    files += 1;
    bytes += stat.size;
    if (!dryRun) fs.copyFileSync(from, to);
  }
}

// Verify the skill is well-formed before installing a broken one.
const skillText = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
const frontmatter = skillText.match(/^---\n([\s\S]*?)\n---/);
if (!frontmatter) {
  console.error('install failed: SKILL.md has no frontmatter block');
  process.exit(1);
}
const declaredName = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
if (declaredName !== SKILL_NAME) {
  console.error(`install failed: SKILL.md declares name "${declaredName}" but the skill installs to ${SKILL_NAME}/`);
  console.error('  Claude Code matches on the frontmatter name — these must agree.');
  process.exit(1);
}

// Replace rather than merge, so a file deleted from the repo also disappears
// from the installed copy.
if (!dryRun && fs.existsSync(target)) fs.rmSync(target, { recursive: true });
if (!dryRun) fs.mkdirSync(target, { recursive: true });

for (const entry of INCLUDE) {
  copy(path.join(ROOT, entry), path.join(target, entry));
}

console.log(`${dryRun ? 'would install' : 'installed'} ${SKILL_NAME} -> ${target}`);
console.log(`  ${files} files, ${(bytes / 1048576).toFixed(2)} MB (most of it the self-hosted fonts)`);
if (!dryRun) {
  const check = path.join(target, 'SKILL.md');
  console.log(`  ${fs.existsSync(check) ? 'OK' : 'MISSING'}  ${check}`);
  console.log(`  ${fs.existsSync(path.join(target, 'scripts', 'build.mjs')) ? 'OK' : 'MISSING'}  scripts/build.mjs`);
  console.log(`  ${fs.existsSync(path.join(target, 'references', 'fonts', 'fonts.css')) ? 'OK' : 'MISSING'}  references/fonts/fonts.css`);
  console.log('');

  // A leftover install under the former name still registers and would shadow
  // this one with an old, incompatible copy. Say so; do not delete it silently.
  const stale = path.join(path.dirname(target), FORMER_SKILL_NAME);
  if (stale !== target && fs.existsSync(stale)) {
    console.log(`  ! 旧版本还装在 ${stale}`);
    console.log(`    它用的是 ${FORMER_SKILL_NAME} 这个名字，会和这次安装同时被 Claude Code 认出来。`);
    console.log('    确认新版本能用之后，手动删掉它：');
    console.log(`      rm -rf ${JSON.stringify(stale)}`);
    console.log('');
  }

  console.log('  Start a new Claude Code session for it to be picked up.');
}
