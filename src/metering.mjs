import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 외부 API 사용량 가드.
 * 모든 외부 호출(구글/슬랙/트렐로)은 meteredFetch 를 통과한다 —
 * 분당·일일 상한(하드 차단), 80% 경고(소프트), 429 백오프·연속 429 시 자동 일시정지.
 * 구글은 결제 미연결 프로젝트라 과금이 불가능하지만, 429 로 기능이 멈추는 것을 막는 것이 목적이다.
 */

const DIR = process.env.PB_CONFIG_DIR || path.join(os.homedir(), '.ddalgi-tool');
const FILE = path.join(DIR, 'metering.json');

/** 서비스별 상한. 무료 쿼터(구글 사용자당 60회/분, 트렐로 토큰당 100회/10초)보다 낮게 잡는다. */
export const LIMITS = {
  google: { perMin: 50, perDay: 4000 },
  slack: { perMin: 40, perDay: 4000 },
  trello: { perMin: 120, perDay: 4000 },
};

const winCalls = { google: [], slack: [], trello: [] }; // 최근 60초 호출 타임스탬프
const pausedUntil = {}; // service -> ms
const consec429 = {};
let warnedToday = {};
let day = { date: today(), counts: { google: 0, slack: 0, trello: 0 } };

let onEvent = () => {};
/** 경고·일시정지 이벤트를 UI(토스트)로 흘려보낼 리스너. */
export function setMeterListener(fn) {
  onEvent = fn || (() => {});
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

try {
  const d = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  if (d?.date === today()) day = d;
} catch {
  /* 첫 실행 */
}

function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(day));
  } catch {
    /* 저장 실패는 치명적이지 않다 */
  }
}

function rollDay() {
  if (day.date !== today()) {
    day = { date: today(), counts: { google: 0, slack: 0, trello: 0 } };
    warnedToday = {};
    save();
  }
}

/** 호출 직전 점검. 막혀 있으면 이유를 담아 던진다 — 에이전트에게 그대로 전달된다. */
export function checkQuota(service) {
  rollDay();
  const now = Date.now();
  if (pausedUntil[service] && now < pausedUntil[service]) {
    const sec = Math.ceil((pausedUntil[service] - now) / 1000);
    throw new Error(`${service} API 일시정지 중입니다 (429 누적 — ${sec}초 후 재개). 잠시 후 다시 시도하세요.`);
  }
  const lim = LIMITS[service];
  if (!lim) return;
  const w = winCalls[service];
  while (w.length && now - w[0] > 60000) w.shift();
  if (w.length >= lim.perMin) {
    throw new Error(`${service} 분당 호출 상한(${lim.perMin}회)에 도달했습니다. 1분 뒤 다시 시도하세요.`);
  }
  if (day.counts[service] >= lim.perDay) {
    throw new Error(`${service} 일일 호출 상한(${lim.perDay}회)에 도달했습니다. 자정에 초기화됩니다.`);
  }
}

function recordCall(service) {
  rollDay();
  winCalls[service]?.push(Date.now());
  day.counts[service] = (day.counts[service] || 0) + 1;
  const lim = LIMITS[service];
  if (lim && !warnedToday[service] && day.counts[service] >= lim.perDay * 0.8) {
    warnedToday[service] = true;
    onEvent({ kind: 'soft', service, used: day.counts[service], limit: lim.perDay });
  }
  save();
}

function record429(service, retryAfterSec) {
  consec429[service] = (consec429[service] || 0) + 1;
  const base = Math.max(Number(retryAfterSec) || 0, 30);
  const sec = consec429[service] >= 3 ? 600 : base;
  pausedUntil[service] = Date.now() + sec * 1000;
  onEvent({ kind: '429', service, pausedSec: sec, consec: consec429[service] });
}

/** UI(사용량 모달)용 현재 상태. */
export function meterStats() {
  rollDay();
  const now = Date.now();
  const out = {};
  for (const s of Object.keys(LIMITS)) {
    const w = winCalls[s];
    while (w.length && now - w[0] > 60000) w.shift();
    out[s] = {
      today: day.counts[s] || 0,
      perDay: LIMITS[s].perDay,
      lastMin: w.length,
      perMin: LIMITS[s].perMin,
      pausedSec: pausedUntil[s] > now ? Math.ceil((pausedUntil[s] - now) / 1000) : 0,
    };
  }
  return out;
}

/**
 * 사용량 가드를 통과하는 공용 fetch.
 * 429 면 백오프를 기록하고 던진다. 그 외 HTTP 오류도 본문 일부와 함께 던진다.
 */
export async function meteredFetch(service, url, options) {
  checkQuota(service);
  recordCall(service);
  const res = await fetch(url, options);
  if (res.status === 429) {
    record429(service, res.headers.get('retry-after'));
    throw new Error(`${service} API 429 (호출 한도 초과) — 자동 일시정지했습니다.`);
  }
  consec429[service] = 0;
  return res;
}
