import { loadCred, saveCred, deleteCred } from '../creds.mjs';
import { meteredFetch } from '../metering.mjs';

/** 슬랙 봇 API 클라이언트. project.yaml 에 등록된 채널만 조회하는 것은 도구 계층에서 강제한다. */

const userNameCache = new Map();

async function call(method, params = {}, httpMethod = 'GET') {
  const cred = loadCred('slack');
  if (!cred?.token) throw new Error('슬랙이 연결되어 있지 않습니다. [🔗 연동 설정]에서 봇 토큰을 저장하세요.');
  let r;
  if (httpMethod === 'GET') {
    const u = new URL(`https://slack.com/api/${method}`);
    u.search = new URLSearchParams(params).toString();
    r = await meteredFetch('slack', u.toString(), { headers: { authorization: `Bearer ${cred.token}` } });
  } else {
    r = await meteredFetch('slack', `https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cred.token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(params),
    });
  }
  const d = await r.json();
  if (!d.ok) throw new Error(`슬랙 API 오류: ${d.error || r.status}`);
  return d;
}

/** 토큰 검증 후 저장. */
export async function slackConnect(token) {
  const r = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  if (!d.ok) throw new Error('토큰 확인 실패: ' + (d.error || '알 수 없음'));
  saveCred('slack', { token, team: d.team, botUser: d.user });
  return { team: d.team, botUser: d.user };
}

export function slackDisconnect() {
  deleteCred('slack');
}

export function slackStatus() {
  const c = loadCred('slack');
  return c ? { connected: true, team: c.team, botUser: c.botUser } : { connected: false };
}

/** 워크스페이스 채널 목록 (공개 전체 + 봇이 초대된 비공개). 마법사용. */
export async function slackChannels() {
  const out = [];
  let cursor = '';
  do {
    const d = await call('conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
      ...(cursor ? { cursor } : {}),
    });
    for (const c of d.channels ?? []) {
      out.push({ id: c.id, name: c.name, isPrivate: !!c.is_private, isMember: !!c.is_member });
    }
    cursor = d.response_metadata?.next_cursor || '';
  } while (cursor && out.length < 1000);
  return out;
}

async function userName(id) {
  if (!id) return '?';
  if (userNameCache.has(id)) return userNameCache.get(id);
  try {
    const d = await call('users.info', { user: id });
    const name = d.user?.profile?.display_name || d.user?.real_name || d.user?.name || id;
    userNameCache.set(id, name);
    return name;
  } catch {
    return id;
  }
}

/** 채널 히스토리를 "[시각] 이름: 내용" 줄로. 스레드 답글은 포함하지 않는다(필요 시 확장). */
export async function slackHistory(channelId, limit = 50, oldest) {
  const d = await call('conversations.history', {
    channel: channelId,
    limit: String(Math.min(limit, 100)),
    ...(oldest ? { oldest: String(oldest) } : {}),
  });
  const msgs = (d.messages ?? []).filter((m) => m.type === 'message' && !m.subtype);
  const lines = [];
  for (const m of msgs.reverse()) {
    const t = new Date(Number(m.ts) * 1000).toISOString().replace('T', ' ').slice(0, 16);
    const name = await userName(m.user);
    const replies = m.reply_count ? ` (답글 ${m.reply_count})` : '';
    lines.push(`[${t}] ${name}: ${String(m.text).replace(/\n/g, ' ⏎ ')}${replies} <ts:${m.ts}>`);
  }
  return { count: lines.length, hasMore: !!d.has_more, text: lines.join('\n') };
}

/** 스레드 답글 조회. */
export async function slackReplies(channelId, threadTs, limit = 50) {
  const d = await call('conversations.replies', {
    channel: channelId,
    ts: String(threadTs),
    limit: String(Math.min(limit, 100)),
  });
  const lines = [];
  for (const m of d.messages ?? []) {
    const t = new Date(Number(m.ts) * 1000).toISOString().replace('T', ' ').slice(0, 16);
    lines.push(`[${t}] ${await userName(m.user)}: ${String(m.text).replace(/\n/g, ' ⏎ ')}`);
  }
  return { count: lines.length, text: lines.join('\n') };
}

/** 메시지 발송. 호출 전 반드시 앱 승인 절차를 거칠 것. */
export async function slackPost(channelId, text) {
  const d = await call('chat.postMessage', { channel: channelId, text }, 'POST');
  return { ts: d.ts, channel: d.channel };
}
