import { loadCred, saveCred, deleteCred } from '../creds.mjs';
import { meteredFetch } from '../metering.mjs';

/** 트렐로 REST 클라이언트. */

function auth() {
  const c = loadCred('trello');
  if (!c?.key || !c?.token) throw new Error('트렐로가 연결되어 있지 않습니다. [🔗 연동 설정]에서 키·토큰을 저장하세요.');
  return c;
}

async function call(pathname, params = {}, method = 'GET') {
  const c = auth();
  const u = new URL('https://api.trello.com/1/' + pathname);
  u.search = new URLSearchParams({ ...params, key: c.key, token: c.token }).toString();
  const r = await meteredFetch('trello', u.toString(), { method });
  const body = await r.text();
  if (!r.ok) throw new Error(`트렐로 API 오류 ${r.status}: ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/** 키·토큰 검증 후 저장. */
export async function trelloConnect(key, token) {
  const u = new URL('https://api.trello.com/1/members/me');
  u.search = new URLSearchParams({ key, token, fields: 'username,fullName' }).toString();
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error('키/토큰 확인 실패 (' + r.status + ')');
  const d = await r.json();
  saveCred('trello', { key, token, username: d.username });
  return { username: d.username, fullName: d.fullName };
}

export function trelloDisconnect() {
  deleteCred('trello');
}

export function trelloStatus() {
  const c = loadCred('trello');
  return c ? { connected: true, username: c.username } : { connected: false };
}

/** 내 보드 목록 (마법사용). */
export async function trelloBoards() {
  const d = await call('members/me/boards', { fields: 'name,shortUrl', filter: 'open' });
  return d.map((b) => ({ id: b.id, name: b.name, url: b.shortUrl }));
}

/** 보드의 리스트+카드. 반환은 리스트별 카드 요약 텍스트 (토큰 절약). */
export async function trelloBoardCards(boardId) {
  const lists = await call(`boards/${boardId}/lists`, { fields: 'name', cards: 'open', card_fields: 'name,desc,labels,shortUrl' });
  const lines = [];
  for (const l of lists) {
    lines.push(`## ${l.name} (${(l.cards ?? []).length}장)`);
    for (const c of l.cards ?? []) {
      const labels = (c.labels ?? []).map((x) => x.name || x.color).filter(Boolean).join(',');
      const desc = c.desc ? ` — ${String(c.desc).replace(/\n/g, ' ').slice(0, 120)}` : '';
      lines.push(`- [${c.id}] ${c.name}${labels ? ` {${labels}}` : ''}${desc}`);
    }
  }
  return { lists: lists.length, text: lines.join('\n') };
}

/** 카드 상세 (설명 전문 + 코멘트). */
export async function trelloCard(cardId) {
  const c = await call(`cards/${cardId}`, { fields: 'name,desc,shortUrl,idList,labels' });
  const actions = await call(`cards/${cardId}/actions`, { filter: 'commentCard', limit: '20' });
  const comments = actions.map((a) => `- ${a.memberCreator?.username || '?'}: ${String(a.data?.text || '').replace(/\n/g, ' ')}`);
  return {
    name: c.name,
    url: c.shortUrl,
    labels: (c.labels ?? []).map((x) => x.name || x.color).filter(Boolean),
    desc: c.desc || '(설명 없음)',
    comments: comments.join('\n') || '(코멘트 없음)',
  };
}

/** 카드 생성. 호출 전 반드시 앱 승인 절차를 거칠 것. */
export async function trelloCardCreate(listId, name, desc) {
  const d = await call('cards', { idList: listId, name, desc: desc || '' }, 'POST');
  return { id: d.id, url: d.shortUrl };
}

/** 카드 코멘트. 호출 전 반드시 앱 승인 절차를 거칠 것. */
export async function trelloCardComment(cardId, text) {
  const d = await call(`cards/${cardId}/actions/comments`, { text }, 'POST');
  return { id: d.id };
}

/** 보드의 리스트 목록 (카드 생성 대상 선택용). */
export async function trelloLists(boardId) {
  const d = await call(`boards/${boardId}/lists`, { fields: 'name' });
  return d.map((l) => ({ id: l.id, name: l.name }));
}

/** 카드 속성 변경(리스트 이동·이름). 삭제·보관은 정책상 지원하지 않는다. 호출 전 반드시 앱 승인 절차를 거칠 것. */
export async function trelloCardUpdate(cardId, { listId, name } = {}) {
  const params = {};
  if (listId) params.idList = listId;
  if (name) params.name = name;
  const d = await call(`cards/${cardId}`, params, 'PUT');
  return { id: d.id, name: d.name, idList: d.idList };
}

/** 카드 첨부 목록. */
export async function trelloCardAttachments(cardId) {
  const d = await call(`cards/${cardId}/attachments`, { fields: 'name,url,mimeType,bytes,isUpload' });
  return d.map((a) => ({ id: a.id, name: a.name, url: a.url, mimeType: a.mimeType || '', bytes: a.bytes || 0, isUpload: !!a.isUpload }));
}

/** 카드에 URL 첨부(링크·이미지 주소)를 추가한다. 호출 전 반드시 앱 승인 절차를 거칠 것. */
export async function trelloAttachUrl(cardId, url, name) {
  const d = await call(`cards/${cardId}/attachments`, { url, ...(name ? { name } : {}) }, 'POST');
  return { id: d.id, name: d.name };
}

const MAX_IMG_BYTES = 2 * 1024 * 1024; // 에이전트 컨텍스트 보호 — 2MB 초과 이미지는 내려받지 않는다

/**
 * 이미지 첨부를 base64 로 내려받는다 (에이전트가 직접 보게).
 * 트렐로에 업로드된 파일은 OAuth 헤더가 필요하고, 외부 URL 첨부는 그대로 받는다.
 */
export async function trelloDownloadImage(att) {
  const c = auth();
  const isTrelloHosted = /^https:\/\/(api\.)?trello\.com\//.test(att.url);
  const headers = isTrelloHosted
    ? { authorization: `OAuth oauth_consumer_key="${c.key}", oauth_token="${c.token}"` }
    : {};
  const r = await meteredFetch('trello', att.url, { headers });
  if (!r.ok) throw new Error(`첨부 다운로드 실패 ${r.status}`);
  const mime = r.headers.get('content-type')?.split(';')[0] || att.mimeType || 'image/png';
  if (!mime.startsWith('image/')) throw new Error('이미지가 아닌 첨부: ' + mime);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_IMG_BYTES) throw new Error(`이미지가 너무 큼 (${Math.round(buf.length / 1024)}KB > 2MB)`);
  return { base64: buf.toString('base64'), mimeType: mime };
}
