import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
// skills 目录在上层：src/modules/ -> src/ -> stdu-cli/skills
const SKILL_SOURCE = join(HERE, '..', '..', 'skills', 'stdu-cli-skill');

export function skillSourceDir() {
  return SKILL_SOURCE;
}

export function homeDir(env = process.env) {
  return env.HOME ?? env.USERPROFILE ?? '';
}

// 同时覆盖 WorkBuddy（电脑/手机）、Claude Code、CodeBuddy 三类 Agent 的 skills 目录，
// 这样同一份技能发给不同同学、不同 AI 都能自动识别。
export function skillTargets(options = {}) {
  const env = options.env ?? process.env;
  const home = homeDir(env);
  const list = [
    join(home, '.workbuddy', 'skills'),
    join(home, '.claude', 'skills'),
    join(home, '.codebuddy', 'skills')
  ];
  return list.filter(Boolean);
}

export function copySkill(targets = skillTargets()) {
  if (!existsSync(SKILL_SOURCE)) {
    const error = new Error(`未找到 skill 源目录：${SKILL_SOURCE}`);
    error.code = 'SKILL_NOT_FOUND';
    throw error;
  }
  const results = [];
  for (const target of targets) {
    if (!target) continue;
    const dest = join(target, 'stdu-cli-skill');
    mkdirSync(dest, { recursive: true });
    for (const file of readdirSync(SKILL_SOURCE)) {
      if (file === '.' || file === '..') continue;
      writeFileSync(join(dest, file), readFileSync(join(SKILL_SOURCE, file)), 'utf8');
    }
    results.push(dest);
  }
  return results;
}

export function configDir(env = process.env) {
  return join(homeDir(env), '.stdu-cli');
}

export function writeInstallConfig(cfg) {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'config.json');
  const prev = existsSync(file) ? safeParse(file) : {};
  const next = { ...prev, ...cfg, installedAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
  return file;
}

export function readInstallConfig(env = process.env) {
  const file = join(configDir(env), 'config.json');
  return existsSync(file) ? safeParse(file) : null;
}

function safeParse(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}
