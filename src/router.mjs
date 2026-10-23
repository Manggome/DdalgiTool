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

const ROUTER_MODEL = 'claude-haiku-5-5';
const TIMEOUT_MS = 12000;

const SYSTEM = [
  '너는 게임 기획 도구의 요청 라우터다. 카탈로그와 사용자 요청을 보고 JSON 하나만 출력한다.',
  '형식: {"sources":["drive-docs"|"drive-sheets"|"slack"|"trello"|"unity-code"|"git"|"archive"|"local"...],',
  '"skill":"design-doc"|"data-table"|"balance"|"explore"|"qa"|"archive"|"none",',
  '"targets":["카탈로그에서 찾은 구체 대상 — 파일명/시트 탭/채널/카드 등, 최대 3개"],',
  '"confidence":0~1}',
  '설명 없이 JSON 만. 단순 대화·질문이면 sources:[] , skill:"none".',
].join('\n');

/** 구조화 출력 스키마 — 형식이 깨져 분류가 버려지는 일을 없앤다. */
const ROUTE_SCHEMA = {
  type: 'object',
  properties: {
    sources: {
      type: 'array',
      items: { type: 'string', enum: ['drive-docs', 'drive-sheets', 'slack', 'trello', 'unity-code', 'git', 'archive', 'local'] },
    },
    skill: { type: 'string', enum: ['design-doc', 'data-table', 'balance', 'explore', 'qa', 'archive', 'insight', 'none'] },
    targets: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['sources', 'skill', 'targets', 'confidence'],
  additionalProperties: false,
};

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
        // 내장 도구는 전부 끈다. (allowedTools: [] 는 구조화 출력용 StructuredOutput 도구까지 막아 쓰지 않는다)
        tools: [],
        maxTurns: 1,
        outputFormat: { type: 'json_schema', schema: ROUTE_SCHEMA },
        effort: 'low', // 분류는 깊게 생각할 일이 아니다 — 빠르게
        abortController: ac,
      },
    });
    let out = '';
    let structured = null;
    for await (const m of stream) {
      if (m.type === 'assistant') {
        for (const b of m.message.content ?? []) if (b.type === 'text') out += b.text;
      } else if (m.type === 'result') {
        if (m.subtype === 'success') {
          if (m.structured_output && typeof m.structured_output === 'object') structured = m.structured_output;
          else if (m.result) out = m.result;
        }
        break;
      }
    }
    clearTimeout(timer);
    let r = structured;
    if (!r) {
      // 구조화 출력이 비어 오면 본문에서 JSON 을 한 번 더 찾아본다
      const jm = /\{[\s\S]*\}/.exec(out);
      if (!jm) return null;
      r = JSON.parse(jm[0]);
    }
    if (!Array.isArray(r.sources)) return null;
    r.ms = Date.now() - started;
    flog(`라우터(${r.ms}ms${structured ? ', 구조화' : ''}): ${JSON.stringify({ s: r.sources, k: r.skill, c: r.confidence })}`);
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
