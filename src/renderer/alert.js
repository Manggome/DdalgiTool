// 플로팅 알림 카드 — 메인이 보내주는 목록을 그대로 그린다. 상태는 메인이 소유한다.
const list = document.getElementById('list');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderPerm(it) {
  const card = el('div', 'card');
  const head = el('div', 'head');
  head.append(el('div', 'title', '권한 요청'), el('span', 'badge', it.displayName || it.tool || '도구'));
  card.append(head);
  if (it.title) card.append(el('div', 'sub', it.title));
  if (it.summary) card.append(el('div', 'summary', it.summary));
  if (it.description) card.append(el('div', 'desc', it.description));

  const row = el('div', 'row');
  const allow = el('button', 'allow', '허용');
  allow.addEventListener('click', () => window.alertApi.decide(it.id, 'allow'));
  const deny = el('button', 'deny', '거부');
  deny.addEventListener('click', () => window.alertApi.decide(it.id, 'deny'));
  row.append(allow, deny);
  card.append(row);

  if (it.writeKey) {
    const always = el('button', 'always', `항상 허용 · ${it.writeKey}`);
    always.title = '이 종류의 쓰기는 다시 묻지 않습니다 (연동 설정에서 해제 가능)';
    always.addEventListener('click', () => window.alertApi.decide(it.id, 'always'));
    card.append(always);
  }
  return card;
}

function renderDone(it) {
  const card = el('div', 'card');
  const head = el('div', 'head');
  const ok = it.status === 'ok';
  head.append(
    el('div', 'title', it.title || '작업 완료'),
    el('span', 'badge ' + (ok ? 'done' : 'warn'), ok ? '완료' : it.status === 'stopped' ? '중지' : '오류'),
  );
  card.append(head);
  if (it.body) card.append(el('div', 'body', it.body));
  const row = el('div', 'row');
  const open = el('button', 'open', '열기');
  open.addEventListener('click', () => window.alertApi.open(it.key));
  const close = el('button', 'deny', '닫기');
  close.addEventListener('click', () => window.alertApi.dismiss(it.key));
  row.append(open, close);
  card.append(row);
  return card;
}

function render(items) {
  list.replaceChildren(...items.map((it) => (it.kind === 'perm' ? renderPerm(it) : renderDone(it))));
  // 창 크기를 내용에 맞춘다 (빈 영역이 다른 앱의 클릭을 가로채지 않게)
  requestAnimationFrame(() => window.alertApi.resize(items.length ? document.body.scrollHeight : 0));
}

window.alertApi.onItems(render);
