import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * 스킬 카탈로그 — 각 skills/<이름>/SKILL.md 맨 위 frontmatter 가 유일한 등록 정보다.
 * 메뉴(시작 버튼·⚡), 에이전트 안내문의 스킬 목록, 라우터의 분류 목록이 모두 여기서 만들어진다.
 * 스킬을 추가하려면 폴더 하나와 SKILL.md 하나만 만들면 된다.
 *
 * frontmatter 필드:
 *   name, label, icon, group(쓰기|확인|테스트|정리), order, summary, ask, examples[],
 *   needs[](google|slack|trello|unity), effort(low|medium|high|xhigh), description(언제 발동하는지)
 */

export const SKILL_GROUPS = ['쓰기', '확인', '테스트', '정리'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const NEEDS = ['google', 'slack', 'trello', 'unity'];

let cache = null;

export function loadSkillCatalog(skillsDir) {
  if (cache && cache.dir === skillsDir) return cache.list;
  const list = [];
  let dirs = [];
  try {
    dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  for (const d of dirs) {
    const file = path.join(skillsDir, d.name, 'SKILL.md');
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const m = /^---\n([\s\S]*?)\n---/.exec(raw);
    if (!m) continue;
    let fm;
    try {
      fm = YAML.parse(m[1]) ?? {};
    } catch {
      continue;
    }
    const name = String(fm.name || d.name);
    if (!/^[a-z0-9-]+$/.test(name)) continue;
    list.push({
      name,
      label: String(fm.label || name),
      icon: String(fm.icon || '⚡'),
      group: SKILL_GROUPS.includes(fm.group) ? fm.group : '확인',
      order: Number(fm.order) || 99,
      summary: String(fm.summary || ''),
      ask: fm.ask ? String(fm.ask) : '',
      examples: Array.isArray(fm.examples) ? fm.examples.map(String).slice(0, 4) : [],
      needs: Array.isArray(fm.needs) ? fm.needs.filter((n) => NEEDS.includes(n)) : [],
      effort: EFFORTS.includes(fm.effort) ? fm.effort : '',
      description: String(fm.description || ''),
      path: file,
    });
  }
  list.sort((a, b) => SKILL_GROUPS.indexOf(a.group) - SKILL_GROUPS.indexOf(b.group) || a.order - b.order);
  cache = { dir: skillsDir, list };
  return list;
}

/** 에이전트 안내문에 넣을 스킬 목록 (한 줄씩: 라벨 — 언제 쓰나 → 경로). */
export function skillPromptLines(skillsDir) {
  return loadSkillCatalog(skillsDir).map(
    (s) => `- ${s.icon} ${s.label} [${s.name}] — ${s.description || s.summary}\n  → ${s.path}`,
  );
}

export function findSkill(skillsDir, name) {
  return loadSkillCatalog(skillsDir).find((s) => s.name === name) || null;
}
