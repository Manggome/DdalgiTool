import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { flog } from './config.mjs';

/**
 * 소프트 라우터 — 본 모델을 부르기 전에 Haiku 가 카탈로그를 보고
 * "어느 소스·스킬이 필요할지" 힌트를 만든다. 힌트일 뿐 하드 제한이 아니며
 * (본 모델은 자료가 부족하면 스스로 추가 소스를 조회한다),
 * 실패·타임아웃 시에는 조용히 건너뛴다 — 라우터가 턴을 막는 일은 없어야 한다.
 */

const ROUTER_MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 12000;

const SYSTEM = [
  '너는 게임 기획 도구의 요청 라우터다. 카탈로그와 사용자 요청을 보고 JSON 하나만 출력한다.',
  '형식: {"sources":["drive-docs"|"drive-sheets"|"slack"|"trello"|"unity-code"|"git"|"archive"|"local"...],',
  '"skill":"design-doc"|"data-table"|"balance"|"explore"|"qa"|"archive"|"none",',
  '"targets":["카탈로그에서 찾은 구체 대상 — 파일명/시트 탭/채널/카드 등, 최대 3개"],',
  '"confidence":0~1}',
  '설명 없이 JSON 만. 단순 대화·질문이면 sources:[] , skill:"none".',
].join('\n');

export async function routeRequest(workDir, userPrompt) {
  const catPath = path.join(workDir, '.ddalgi', 'index', 'catalog.md');
  let catalog = '';
  try {
    catalog = fs.readFileSync(catPath, 'utf-8').slice(0, 7000);
  } catch {
    return null; // 카탈로그가 없으면 라우팅하지 않는다
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const stream = query({
      prompt: `[카탈로그]\n${catalog}\n\n[사용자 요청]\n${String(userPrompt).slice(0, 1200)}\n\nJSON:`,
      options: {
        cwd: workDir,
        model: ROUTER_MODEL,
        systemPrompt: SYSTEM,
        allowedTools: [],
        disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Task', 'TodoWrite'],
        maxTurns: 1,
        abortController: ac,
      },
    });
    let out = '';
    for await (const m of stream) {
      if (m.type === 'assistant') {
        for (const b of m.message.content ?? []) if (b.type === 'text') out += b.text;
      } else if (m.type === 'result') {
        if (m.subtype === 'success' && m.result) out = m.result;
        break;
      }
    }
    clearTimeout(timer);
    const jm = /\{[\s\S]*\}/.exec(out);
    if (!jm) return null;
    const r = JSON.parse(jm[0]);
    if (!Array.isArray(r.sources)) return null;
    r.ms = Date.now() - started;
    flog(`라우터(${r.ms}ms): ${JSON.stringify({ s: r.sources, k: r.skill, c: r.confidence })}`);
    return r;
  } catch (e) {
    clearTimeout(timer);
    try {
      ac.abort();
    } catch {
      /* noop */
    }
    flog('라우터 건너뜀: ' + (e?.message || e));
    return null;
  }
}

/** 라우터 결과를 본 모델 프롬프트 앞에 붙일 힌트 문자열로. */
export function routerHint(r) {
  if (!r || !r.sources?.length || (r.confidence ?? 0) < 0.4) return '';
  const parts = [`추천 소스: ${r.sources.join(', ')}`];
  if (r.skill && r.skill !== 'none') parts.push(`스킬: ${r.skill}`);
  if (r.targets?.length) parts.push(`대상 후보: ${r.targets.join(' / ')}`);
  return `[라우터 힌트 — 참고용, 부족하면 다른 소스도 조회 가능]\n${parts.join(' · ')}\n\n`;
}
