/* 딸각기획(딸기툴) — 렌더러. window.pb (preload)로만 메인과 통신한다. */

const $ = (sel) => document.querySelector(sel);

const el = {
  setup: $('#setup'),
  setupMsg: $('#setupMsg'),
  chooseBtn: $('#chooseBtn'),
  chat: $('#chat'),
  messages: $('#messages'),
  welcome: $('#welcome'),
  guideBtn: $('#guideBtn'),
  guideModal: $('#guideModal'),
  guideBody: $('#guideBody'),
  guideClose: $('#guideClose'),
  input: $('#input'),
  sendBtn: $('#sendBtn'),
  stopBtn: $('#stopBtn'),
  queueBar: $('#queueBar'),
  skillBtn: $('#skillBtn'),
  skillMenu: $('#skillMenu'),
  folderChangeBtn: $('#folderChangeBtn'),
  panelBtn: $('#panelBtn'),
  work: $('#work'),
  workTitle: $('#workTitle'),
  workMeta: $('#workMeta'),
  workToggle: $('#workToggle'),
  workList: $('#workList'),
  workStall: $('#workStall'),
  workStallText: $('#workStallText'),
  stallStop: $('#stallStop'),
  stallWait: $('#stallWait'),
  thinkToggle: $('#thinkToggle'),
  thinkBox: $('#thinkBox'),
  attachments: $('#attachments'),
  attachBtn: $('#attachBtn'),
  attachMenu: $('#attachMenu'),
  composer: document.querySelector('.composer'),
  modelSelect: $('#modelSelect'),
  permSelect: $('#permSelect'),
  usageBtn: $('#usageBtn'),
  usageCost: $('#usageCost'),
  usageTok: $('#usageTok'),
  usageCtx: $('#usageCtx'),
  usageModal: $('#usageModal'),
  usageBody: $('#usageBody'),
  usageClose: $('#usageClose'),
  usageReset: $('#usageReset'),
  connBtn: $('#connBtn'),
  connModal: $('#connModal'),
  connClose: $('#connClose'),
  connMsg: $('#connMsg'),
  connSave: $('#connSave'),
  connProjName: $('#connProjName'),
  gState: $('#gState'),
  gImport: $('#gImport'),
  gLogin: $('#gLogin'),
  gOut: $('#gOut'),
  sState: $('#sState'),
  sToken: $('#sToken'),
  sSave: $('#sSave'),
  sOut: $('#sOut'),
  tState: $('#tState'),
  tKey: $('#tKey'),
  tToken: $('#tToken'),
  tSave: $('#tSave'),
  tOut: $('#tOut'),
  pDocsFolder: $('#pDocsFolder'),
  pDocsAdd: $('#pDocsAdd'),
  pDocsList: $('#pDocsList'),
  pSheetsFolder: $('#pSheetsFolder'),
  pSheetsAdd: $('#pSheetsAdd'),
  pSheetsList: $('#pSheetsList'),
  pUnityList: $('#pUnityList'),
  pSlackLoad: $('#pSlackLoad'),
  pSlackList: $('#pSlackList'),
  pTrelloLoad: $('#pTrelloLoad'),
  pTrelloList: $('#pTrelloList'),
  pUnityPick: $('#pUnityPick'),
  idxSync: $('#idxSync'),
  idxState: $('#idxState'),
  updateBar: $('#updateBar'),
  updateVer: $('#updateVer'),
  updateGo: $('#updateGo'),
  updateLater: $('#updateLater'),
  uFolder: $('#uFolder'),
  uSave: $('#uSave'),
  uCheck: $('#uCheck'),
  uState: $('#uState'),
  waList: $('#waList'),
  permModal: $('#permModal'),
  permTool: $('#permTool'),
  permTitle: $('#permTitle'),
  permSummary: $('#permSummary'),
  permDesc: $('#permDesc'),
  permAllow: $('#permAllow'),
  permAllowAll: $('#permAllowAll'),
  permCount: $('#permCount'),
  permAlways: $('#permAlways'),
  permDeny: $('#permDeny'),
  ctxUsage: $('#ctxUsage'),
  newChat: $('#newChat'),
  history: $('#history'),
  status: $('#status'),
  statusDot: $('#statusDot'),
  acctLabel: $('#acctLabel'),
  authBtn: $('#authBtn'),
  versionLabel: $('#versionLabel'),
  guideFoot: $('#guideFoot'),
  folderBtn: $('#folderBtn'),
  errBar: $('#errBar'),
  errBarText: $('#errBarText'),
  errInclude: $('#errInclude'),
  errClear: $('#errClear'),
  panel: $('#previewPanel'),
  dragbar: $('#dragbar'),
  pvFile: $('#pvFile'),
  pvDevice: $('#pvDevice'),
  pvReload: $('#pvReload'),
  pvReveal: $('#pvReveal'),
  pvDev: $('#pvDev'),
  pvErrBadge: $('#pvErrBadge'),
  pvStage: $('#pvStage'),
  pvEmpty: $('#pvEmpty'),
  pvRestart: $('#pvRestart'),
  pvFoot: $('#pvFoot'),
  promptModal: $('#promptModal'),
  promptMsg: $('#promptMsg'),
  promptInput: $('#promptInput'),
  promptYes: $('#promptYes'),
  promptNo: $('#promptNo'),
  toast: $('#toast'),
  tabMenu: $('#tabMenu'),
  confirmModal: $('#confirmModal'),
  confirmMsg: $('#confirmMsg'),
  confirmYes: $('#confirmYes'),
  confirmNo: $('#confirmNo'),
  chatTools: $('#chatTools'),
  findBtn: $('#findBtn'),
  findBar: $('#findBar'),
  findInput: $('#findInput'),
  findCount: $('#findCount'),
  findPrev: $('#findPrev'),
  findNext: $('#findNext'),
  findClose: $('#findClose'),
  jumpBtn: $('#jumpBtn'),
  jumpPanel: $('#jumpPanel'),
  jumpList: $('#jumpList'),
  jumpCount: $('#jumpCount'),
  toBottom: $('#toBottom'),
  toBottomText: $('#toBottomText'),
  cmdMenu: $('#cmdMenu'),
};

const CONV_KEY = 'pb.conversations';
const MODEL_KEY = 'pb.model';
const DEVICE_KEY = 'pb.device';
const PANEL_KEY = 'pb.panelWidth';

let workDir = null;

/**
 * 대화(탭)별 실행 상태. 탭을 바꿔도 진행 중인 작업이 이어지도록
 * 화면(DOM)과 분리해 여기에 둔다. localStorage 에는 저장하지 않는다.
 */
const rt = new Map();

function newWork() {
  return {
    steps: [],
    startedAt: 0,
    lastAt: 0,
    collapsed: false,
    thinking: '',
    thinkOpen: false,
    thinkTokens: 0,
    snooseUntil: 0,
  };
}

function runtime(id) {
  let r = rt.get(id);
  if (!r) {
    r = { busy: false, buf: '', box: null, queue: [], work: newWork() };
    rt.set(id, r);
  }
  return r;
}

const isActive = (id) => currentConv && currentConv.id === id;
const activeRt = () => (currentConv ? runtime(currentConv.id) : null);
let permQueue = [];
let busy = false;
let attachments = [];
let previewErrCount = 0; // 미리보기 오류 개수 (메인에서 합쳐서 보내 준다)
let previewErrLast = null;
let conversations = [];
let currentConv = null;

// ---------- 마크다운 (최소 구현) ----------

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 코드 조각을 잠시 빼 두는 표식. 본문에 나올 일이 없는 제어문자를 쓴다.
const CODE_MARK = '\u0091';
const CODE_RE = /\u0091(\d+)\u0091/g;

function inline(s) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`;
  });
  t = t
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    // 링크는 새 창을 띄우지 않고 텍스트로만 보여 준다.
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
  return t.replace(CODE_RE, (_m, i) => `<code>${codes[Number(i)]}</code>`);
}

function renderMd(src) {
  const lines = String(src).split('\n');
  let out = '';
  let i = 0;
  const listBuf = { type: null, items: [] };

  const flushList = () => {
    if (!listBuf.type) return;
    const tag = listBuf.type;
    out += `<${tag}>${listBuf.items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`;
    listBuf.type = null;
    listBuf.items = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // 코드블록
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      flushList();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      out += `<pre><code>${esc(body.join('\n'))}</code></pre>`;
      continue;
    }

    // 표
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flushList();
      const cells = (l) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out +=
        '<table><thead><tr>' +
        head.map((h) => `<th>${inline(h)}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table>';
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const lv = Math.min(3, h[1].length);
      out += `<h${lv}>${inline(h[2])}</h${lv}>`;
      i++;
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flushList();
      out += '<hr />';
      i++;
      continue;
    }

    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) {
      flushList();
      out += `<blockquote>${inline(q[1])}</blockquote>`;
      i++;
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (listBuf.type && listBuf.type !== type) flushList();
      listBuf.type = type;
      listBuf.items.push((ul || ol)[1]);
      i++;
      continue;
    }

    if (!line.trim()) {
      flushList();
      i++;
      continue;
    }

    // 문단 (연속된 줄을 묶는다)
    flushList();
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|#{1,4}\s|>\s|[-*+]\s|\d+[.)]\s|---+\s*$)/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    out += `<p>${inline(para.join('\n')).replace(/\n/g, '<br />')}</p>`;
  }
  flushList();
  return out;
}

// ---------- 테마 ----------

let themePref = 'auto';

/** auto 면 OS 설정을 따른다 (다크는 네이비, 라이트는 화이트). */
function resolveTheme(pref) {
  if (pref !== 'auto') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'navy' : 'light';
}

function applyTheme(pref) {
  themePref = pref;
  document.documentElement.dataset.theme = resolveTheme(pref);
  for (const b of document.querySelectorAll('.theme-btn')) {
    b.classList.toggle('active', b.dataset.theme === pref);
  }
}

// ---------- 상태 표시 ----------

function setStatus(text, kind) {
  el.status.textContent = text;
  el.status.title = text;
  el.statusDot.className = 'dot' + (kind ? ' ' + kind : '');
}

function updateSendBtn() {
  // 작업 중에도 보낼 수 있다 — 대기열에 들어간다
  const has = el.input.value.trim().length > 0;
  el.sendBtn.classList.toggle('on', has);
  el.sendBtn.title = busy && has ? '대기열에 추가' : '전송';
}

// ---------- 대화 목록 ----------

function loadConvs() {
  try {
    conversations = JSON.parse(localStorage.getItem(CONV_KEY) || '[]');
  } catch {
    conversations = [];
  }
}

function saveConvs() {
  try {
    const ordered = [...conversations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    localStorage.setItem(CONV_KEY, JSON.stringify(ordered.slice(0, 40)));
  } catch {
    /* 용량 초과는 무시 */
  }
}

function renderHistory() {
  el.history.innerHTML = '';
  if (!conversations.length) {
    el.history.innerHTML = '<div class="history-empty">아직 없음</div>';
    return;
  }
  // 고정한 대화를 위로 (그 안에서는 최근 순 유지)
  const ordered = [...conversations].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  for (const c of ordered) {
    const r = rt.get(c.id);
    const row = document.createElement('div');
    row.className = 'hist-item' + (isActive(c.id) ? ' active' : '') + (c.pinned ? ' pinned' : '');

    // 진행 중이면 탭에서 바로 보이게 한다 (다른 탭에 있어도)
    const dot = document.createElement('span');
    dot.className = 'hist-dot' + (r?.busy ? ' busy' : '');
    if (r?.busy) dot.title = '작업 중';
    row.append(dot);

    if (c.pinned) {
      const pin = document.createElement('span');
      pin.className = 'hist-pin';
      pin.textContent = '📌';
      pin.title = '위에 고정됨';
      row.append(pin);
    }

    const t = document.createElement('span');
    t.className = 'hist-title';
    t.textContent = c.title || '제목 없음';
    row.append(t);

    if (c.unread && !r?.busy) {
      const done = document.createElement('span');
      done.className = 'hist-done' + (c.unread === 'ok' ? '' : ' warn');
      done.textContent = c.unread === 'ok' ? '완료' : '확인';
      done.title = '새 결과가 있습니다';
      row.append(done);
    }
    if (r?.queue?.length) {
      const q = document.createElement('span');
      q.className = 'hist-queue';
      q.textContent = `+${r.queue.length}`;
      q.title = `대기 중인 요청 ${r.queue.length}건`;
      row.append(q);
    }

    const x = document.createElement('span');
    x.className = 'hist-del';
    x.textContent = '✕';
    x.title = '삭제';
    x.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (rt.get(c.id)?.busy) {
        void pb.stop(c.id);
      }
      void pb.newSession(c.id);
      rt.delete(c.id);
      conversations = conversations.filter((v) => v.id !== c.id);
      if (isActive(c.id)) startNew();
      saveConvs();
      renderHistory();
    });
    row.append(x);

    row.addEventListener('click', () => openConv(c));
    // 우클릭으로 이름 바꾸기
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      openTabMenu(ev, c, row, t);
    });
    el.history.append(row);
  }
}

/** 탭 우클릭 메뉴. */
function openTabMenu(ev, c, row, titleEl) {
  const items = [
    { label: '✏️  이름 바꾸기', run: () => startRename(c, row, titleEl) },
    c.pinned
      ? {
          label: '📌  고정 해제',
          run: () => {
            delete c.pinned;
            saveConvs();
            renderHistory();
          },
        }
      : {
          label: '📌  위에 고정',
          run: () => {
            c.pinned = true;
            saveConvs();
            renderHistory();
          },
        },
    {
      label: '🗑  삭제',
      danger: true,
      run: async () => {
        if (!(await confirmDialog(`"${c.title || '제목 없음'}" 대화를 지울까요?`))) return;
        if (rt.get(c.id)?.busy) void pb.stop(c.id);
        void pb.newSession(c.id);
        rt.delete(c.id);
        conversations = conversations.filter((v) => v.id !== c.id);
        if (isActive(c.id)) startNew();
        saveConvs();
        renderHistory();
      },
    },
  ];

  el.tabMenu.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('div');
    b.className = 'tab-menu-item' + (it.danger ? ' danger' : '');
    b.textContent = it.label;
    b.addEventListener('click', () => {
      closeTabMenu();
      void it.run();
    });
    el.tabMenu.append(b);
  }
  el.tabMenu.classList.remove('hidden');
  // 화면 밖으로 나가지 않게 위치를 잡는다
  const w = 170;
  const h = el.tabMenu.offsetHeight || 110;
  el.tabMenu.style.left = Math.min(ev.clientX, window.innerWidth - w - 8) + 'px';
  el.tabMenu.style.top = Math.min(ev.clientY, window.innerHeight - h - 8) + 'px';
}

function closeTabMenu() {
  el.tabMenu.classList.add('hidden');
}

/** 탭 이름을 그 자리에서 고친다. */
function startRename(c, row, titleEl) {
  if (row.querySelector('.hist-input')) return;
  const input = document.createElement('input');
  input.className = 'hist-input';
  input.value = c.title || '';
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const done = (save) => {
    if (save) {
      c.title = input.value.trim() || c.title;
      saveConvs();
    }
    renderHistory();
  };
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') done(true);
    if (ev.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
  input.addEventListener('click', (ev) => ev.stopPropagation());
}

function startNew() {
  currentConv = null;
  closeFind();
  el.jumpPanel.classList.add('hidden');
  el.messages.innerHTML = '';
  el.messages.append(el.welcome);
  el.welcome.classList.remove('hidden');
  el.ctxUsage.classList.add('hidden');
  void pb.setActiveConv(null);
  setBusyUI(false);
  renderHistory();
}

/** 대화를 화면에 올린다. 진행 중이던 대화면 그 상태를 그대로 복원한다. */
function openConv(c) {
  currentConv = c;
  delete c.unread;
  void pb.setActiveConv(c.id);
  if (c.sessionId) void pb.attachSession({ convId: c.id, sessionId: c.sessionId });

  el.chat.classList.remove('hidden');
  closeFind();
  el.jumpPanel.classList.add('hidden');
  el.messages.innerHTML = '';
  for (const m of c.msgs || []) {
    if (m.role === 'user') addUserMsg(m.text, m.atts || [], false, m.at);
    else if (m.role === 'system') addSystemMsg(m.text);
    else {
      const box = addAssistantMsg();
      box.md.innerHTML = renderMd(m.text);
    }
  }

  const r = runtime(c.id);
  if (r.busy) {
    // 진행 중인 응답을 이어서 보여 준다
    const box = addAssistantMsg();
    r.box = box;
    box.md.innerHTML = renderMd(r.buf);
    for (const st of r.work.steps.filter((x) => x.kind === 'tool')) {
      const line = document.createElement('div');
      line.className = 'tool-line';
      line.innerHTML = '';
      const k = document.createElement('span');
      k.className = 'tool-kind';
      k.textContent = st.what;
      const a = document.createElement('span');
      a.className = 'tool-arg';
      a.textContent = st.arg || '';
      line.append(k, a);
      box.tools.append(line);
    }
  } else {
    r.box = null;
  }
  setBusyUI(r.busy);
  renderWork();
  renderQueue();
  renderHistory();
  scrollDown(true);
}

function touchConv(userText) {
  if (!currentConv) {
    const title = userText.startsWith('/') ? '새 작업' : userText.slice(0, 38);
    currentConv = { id: String(Date.now()), title, sessionId: '', msgs: [] };
    conversations.unshift(currentConv);
    void pb.setActiveConv(currentConv.id);
  }
}

// ---------- 메시지 DOM ----------

/** 바닥에서 이만큼 안쪽이면 "아래를 보고 있다"고 친다. */
const BOTTOM_SLACK = 120;
let unseenBelow = false;
/**
 * 따라가기 상태 — 사용자가 바닥에 있으면 true, 위로 올리면 false.
 * 새 내용이 붙은 "뒤"에 바닥 여부를 재면 긴 응답 한 덩어리에 밀려나 따라가기가 풀리므로,
 * 스크롤 이벤트 시점의 위치로만 갱신한다.
 */
let followBottom = true;

function atBottom() {
  return el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < BOTTOM_SLACK;
}

/**
 * 아래로 내린다.
 * 따라가는 중(followBottom)이면 항상 내리고, 위를 읽고 있으면 "맨 아래로" 알약만 띄운다.
 */
function scrollDown(force = false) {
  if (!force && !followBottom) {
    unseenBelow = true;
    updateToBottom();
    return;
  }
  el.messages.scrollTop = el.messages.scrollHeight;
  followBottom = true;
  unseenBelow = false;
  updateToBottom();
}

/** 위로 많이 올라갔을 때만 알약을 보여 준다. */
function updateToBottom() {
  const away = !atBottom();
  el.toBottom.classList.toggle('hidden', !away);
  if (!away) unseenBelow = false;
  el.toBottom.classList.toggle('news', away && unseenBelow);
  el.toBottomText.textContent = away && unseenBelow ? '새 내용이 있습니다 — 맨 아래로' : '맨 아래로 내리기';
}

function addUserMsg(text, atts, animate = true, at = 0) {
  el.welcome.classList.add('hidden');
  const wrap = document.createElement('div');
  wrap.className = 'msg user';
  if (at) wrap.dataset.at = String(at);
  if (String(text).startsWith('/')) wrap.dataset.cmd = '1';
  if (atts?.length) {
    const box = document.createElement('div');
    box.className = 'atts';
    for (const a of atts) {
      const chip = document.createElement('div');
      chip.className = 'att-chip';
      if (a.dataUrl) {
        const img = document.createElement('img');
        img.src = a.dataUrl;
        chip.append(img);
      } else {
        chip.append(document.createTextNode(a.kind === 'folder' ? '📁' : '📄'));
      }
      const n = document.createElement('span');
      n.className = 'att-name';
      n.textContent = a.name;
      chip.append(n);
      box.append(chip);
    }
    wrap.append(box);
  }
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  wrap.append(b);
  el.messages.append(wrap);
  if (animate) scrollDown(true);
  if (!el.jumpPanel.classList.contains('hidden')) renderJump();
  return wrap;
}

function addAssistantMsg() {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  const tools = document.createElement('div');
  tools.className = 'tools';
  const md = document.createElement('div');
  md.className = 'bubble md';
  wrap.append(tools, md);
  el.messages.append(wrap);
  scrollDown(true);
  return { wrap, tools, md };
}

/** 모델을 부르지 않고 앱이 직접 답한 안내(명령 결과 등). */
function addSystemMsg(text) {
  el.welcome.classList.add('hidden');
  const wrap = document.createElement('div');
  wrap.className = 'msg system';
  const b = document.createElement('div');
  b.className = 'bubble md';
  b.innerHTML = renderMd(text);
  wrap.append(b);
  el.messages.append(wrap);
  scrollDown(true);
  return wrap;
}

// ---------- 이 대화에서 찾기 (⌘F / Ctrl+F) ----------

let findMarks = [];
let findAt = -1;

/** 표시(<mark>)를 걷어내고 원래 글자로 되돌린다. */
function clearFindMarks() {
  for (const m of findMarks) {
    const parent = m.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(m.textContent), m);
    parent.normalize();
  }
  findMarks = [];
  findAt = -1;
}

function openFind() {
  if (el.chat.classList.contains('hidden')) return;
  el.jumpPanel.classList.add('hidden');
  el.findBar.classList.remove('hidden');
  el.chatTools.classList.add('hidden');
  el.findInput.focus();
  el.findInput.select();
  if (el.findInput.value.trim()) runFind(el.findInput.value);
}

function closeFind() {
  clearFindMarks();
  el.findBar.classList.add('hidden');
  el.chatTools.classList.remove('hidden');
  updateFindCount();
}

const findOpen = () => !el.findBar.classList.contains('hidden');

function updateFindCount() {
  const has = findMarks.length > 0;
  el.findCount.textContent = has ? `${findAt + 1} / ${findMarks.length}` : '0 / 0';
  el.findCount.classList.toggle('none', !has && el.findInput.value.trim().length > 0);
}

/** 대화 말풍선 안의 글자에서 찾아 표시한다. */
function runFind(query) {
  clearFindMarks();
  const needle = query.trim().toLowerCase();
  if (!needle) {
    updateFindCount();
    return;
  }

  for (const bubble of el.messages.querySelectorAll('.bubble')) {
    const nodes = [];
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) if (n.nodeValue && n.nodeValue.trim()) nodes.push(n);

    for (const node of nodes) {
      const text = node.nodeValue;
      const low = text.toLowerCase();
      let idx = low.indexOf(needle);
      if (idx < 0) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (idx >= 0) {
        if (idx > last) frag.append(document.createTextNode(text.slice(last, idx)));
        const mk = document.createElement('mark');
        mk.className = 'find-hit';
        mk.textContent = text.slice(idx, idx + needle.length);
        frag.append(mk);
        findMarks.push(mk);
        last = idx + needle.length;
        idx = low.indexOf(needle, last);
      }
      if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  findAt = -1;
  if (findMarks.length) stepFind(1);
  else updateFindCount();
}

function stepFind(delta) {
  if (!findMarks.length) {
    updateFindCount();
    return;
  }
  for (const m of findMarks) m.classList.remove('current');
  findAt = (findAt + delta + findMarks.length) % findMarks.length;
  const cur = findMarks[findAt];
  cur.classList.add('current');
  cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
  updateFindCount();
}

// ---------- 내가 한 말 목록 ----------

/** 유튜브 타임스탬프처럼, 보낸 말을 시각과 함께 늘어놓는다. */
function renderJump() {
  const items = [...el.messages.querySelectorAll('.msg.user')];
  el.jumpList.innerHTML = '';
  el.jumpCount.textContent = items.length ? `${items.length}개` : '';

  if (!items.length) {
    const d = document.createElement('div');
    d.className = 'jump-empty';
    d.textContent = '아직 보낸 말이 없습니다.';
    el.jumpList.append(d);
    return;
  }

  items.forEach((wrap, i) => {
    const li = document.createElement('li');
    li.className = 'jump-item' + (wrap.dataset.cmd ? ' cmd' : '');
    const at = Number(wrap.dataset.at || 0);
    const time = document.createElement('span');
    time.className = 'jump-time';
    time.textContent = at
      ? new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
      : `#${i + 1}`;
    const txt = document.createElement('span');
    txt.className = 'jump-text';
    txt.textContent =
      (wrap.querySelector('.bubble')?.textContent || '').trim().replace(/\s+/g, ' ') || '(빈 메시지)';
    li.append(time, txt);
    li.addEventListener('click', () => {
      toggleJump(); // 가려지지 않게 목록을 닫고 이동한다
      jumpTo(wrap);
    });
    el.jumpList.append(li);
  });
}

function jumpTo(wrap) {
  wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
  wrap.classList.remove('flash');
  void wrap.offsetWidth; // 애니메이션을 다시 시작시킨다
  wrap.classList.add('flash');
  setTimeout(() => wrap.classList.remove('flash'), 1500);
}

function toggleJump() {
  const hidden = el.jumpPanel.classList.toggle('hidden');
  el.jumpBtn.classList.toggle('on', !hidden);
  if (!hidden) renderJump();
}

// ---------- 작업 현황 (대화별) ----------

function stepEl(step) {
  const li = document.createElement('li');
  li.className = 'work-step ' + step.state;
  const mark = document.createElement('span');
  mark.className = 'step-mark';
  mark.textContent = step.state === 'done' ? '✓' : step.state === 'fail' ? '✕' : '▸';
  const what = document.createElement('span');
  what.className = 'step-what';
  what.textContent = step.what;
  const arg = document.createElement('span');
  arg.className = 'step-arg';
  arg.textContent = step.arg || '';
  li.append(mark, what, arg);
  if (step.sec) {
    const sec = document.createElement('span');
    sec.className = 'step-sec';
    sec.textContent = `${Math.round(step.sec)}초`;
    li.append(sec);
  }
  return li;
}

/** 활성 대화의 작업 현황을 그린다. */
function renderWork() {
  const r = activeRt();
  if (!r || !r.busy) {
    el.work.classList.add('hidden');
    return;
  }
  const w = r.work;
  el.work.classList.remove('hidden');
  el.workList.innerHTML = '';
  for (const st of w.steps) el.workList.append(stepEl(st));
  if (!w.steps.some((st) => st.state === 'doing')) {
    el.workList.append(
      stepEl({ state: 'doing', what: '다음 작업 생각 중', arg: w.thinkTokens ? `${fmtTok(w.thinkTokens)} 토큰` : '' }),
    );
  }
  el.workList.scrollTop = el.workList.scrollHeight;
  el.workList.classList.toggle('collapsed', w.collapsed);
  el.workToggle.textContent = w.collapsed ? `펼치기 (${w.steps.length})` : '접기';
  el.thinkToggle.classList.toggle('hidden', !w.thinking);
  el.thinkToggle.textContent = w.thinkOpen ? '생각 접기 ▴' : '생각 보기 ▾';
  el.thinkBox.classList.toggle('hidden', !w.thinkOpen);
  if (w.thinkOpen) el.thinkBox.textContent = w.thinking;
}

function fmtDur(ms) {
  const sec = Math.floor(ms / 1000);
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, '0')}초`;
}

/** 0.5초마다 경과 시간·무응답 안내를 갱신한다(활성 대화 기준). */
function tickWork() {
  // 다른 탭에서 도는 작업도 목록에 표시되므로 함께 갱신한다
  let anyBusy = false;
  for (const r of rt.values()) if (r.busy) anyBusy = true;
  if (anyBusy) renderHistory();

  const r = activeRt();
  if (!r || !r.busy) return;
  const w = r.work;
  const now = Date.now();
  const tools = w.steps.filter((x) => x.kind === 'tool').length;
  const think = w.thinkTokens ? ` · 생각 ${fmtTok(w.thinkTokens)} 토큰` : '';
  el.workMeta.textContent = `${fmtDur(now - w.startedAt)} 경과${tools ? ` · 작업 ${tools}건` : ''}${think}`;

  const cur = w.steps.find((x) => x.state === 'doing');
  if (cur && cur.startAt && !cur.fixedSec) {
    cur.sec = (now - cur.startAt) / 1000;
    const li = el.workList.querySelector('.work-step.doing .step-sec');
    if (li) li.textContent = `${Math.round(cur.sec)}초`;
  }

  const idle = now - w.lastAt;
  if (idle > 30000 && now > w.snooseUntil) {
    el.workStall.classList.remove('hidden');
    el.workStallText.textContent =
      `${fmtDur(idle)} 동안 새 소식이 없습니다. 오래 걸리는 작업일 수 있습니다. ` +
      `중지해도 지금까지 만든 파일은 그대로 남습니다.`;
  } else {
    el.workStall.classList.add('hidden');
  }
}

function startWork(r) {
  r.work = newWork();
  r.work.steps = [{ kind: 'think', state: 'doing', what: '생각 중', arg: '', startAt: Date.now() }];
  r.work.startedAt = Date.now();
  r.work.lastAt = Date.now();
  el.workTitle.textContent = '작업 중';
  el.workStall.classList.add('hidden');
  el.thinkBox.textContent = '';
  renderWork();
  tickWork();
}

function markLastDone(w, fail) {
  for (let i = w.steps.length - 1; i >= 0; i--) {
    if (w.steps[i].state === 'doing') {
      w.steps[i].state = fail ? 'fail' : 'done';
      break;
    }
  }
}

function addWorkStep(r, kind, what, arg, id) {
  const w = r.work;
  w.lastAt = Date.now();
  markLastDone(w, false);
  w.steps.push({ kind, state: 'doing', what, arg, id, startAt: Date.now() });
  if (w.steps.length > 60) w.steps.splice(0, w.steps.length - 60);
  if (isActive(r.id)) {
    renderWork();
    tickWork();
  }
}

function endWork(r, status) {
  markLastDone(r.work, status === 'error');
  const tools = r.work.steps.filter((x) => x.kind === 'tool').length;
  return { tools, elapsed: fmtDur(Date.now() - r.work.startedAt) };
}

function toggleThinking() {
  const r = activeRt();
  if (!r) return;
  r.work.thinkOpen = !r.work.thinkOpen;
  renderWork();
  if (r.work.thinkOpen) el.thinkBox.scrollTop = el.thinkBox.scrollHeight;
}

/** 전송 버튼·작업 패널의 표시 상태. */
function setBusyUI(v) {
  busy = v;
  el.work.classList.toggle('hidden', !v);
  el.stopBtn.classList.toggle('hidden', !v);
  updateSendBtn();
}

/** 대기 중인 요청 목록. */
function renderQueue() {
  const r = activeRt();
  const q = r?.queue ?? [];
  el.queueBar.classList.toggle('hidden', q.length === 0);
  if (!q.length) return;
  el.queueBar.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'queue-label';
  label.textContent = `대기 중 ${q.length}건 — 지금 작업이 끝나면 이어서 진행합니다`;
  el.queueBar.append(label);
  q.forEach((item, i) => {
    const chip = document.createElement('span');
    chip.className = 'queue-chip';
    chip.textContent = item.text.slice(0, 24) + (item.text.length > 24 ? '…' : '');
    const x = document.createElement('span');
    x.className = 'att-x';
    x.textContent = '✕';
    x.title = '대기 취소';
    x.addEventListener('click', () => {
      q.splice(i, 1);
      renderQueue();
      renderHistory();
    });
    chip.append(x);
    el.queueBar.append(chip);
  });
}

const TOOL_LABEL = {
  Read: '읽기',
  Write: '새 파일',
  Edit: '수정',
  Bash: '명령 실행',
  Glob: '파일 찾기',
  Grep: '내용 검색',
  TodoWrite: '계획 정리',
  WebSearch: '웹 검색',
  WebFetch: '웹 문서 읽기',
  ToolSearch: '도구 준비',
  Task: '하위 작업',
};

function toolArg(name, input) {
  if (!input) return '';
  if (input.file_path) return String(input.file_path).split('/').pop();
  if (input.command) return String(input.command).replace(/\s+/g, ' ').slice(0, 90);
  if (input.pattern) return String(input.pattern).slice(0, 60);
  return '';
}

function addToolLine(r, name, input, id) {
  const label = TOOL_LABEL[name] || name;
  const arg = toolArg(name, input);

  // 대화에 남는 기록 (활성 탭일 때만 DOM 에 붙인다)
  if (r.box) {
    const line = document.createElement('div');
    line.className = 'tool-line';
    const k = document.createElement('span');
    k.className = 'tool-kind';
    k.textContent = label;
    const a = document.createElement('span');
    a.className = 'tool-arg';
    a.textContent = arg;
    line.append(k, a);
    r.box.tools.append(line);
  }

  addWorkStep(r, 'tool', label, arg, id);
  if (isActive(r.id)) scrollDown();
}

// ---------- 첨부 ----------

function renderAttachments() {
  el.attachments.innerHTML = '';
  el.attachments.classList.toggle('hidden', attachments.length === 0);
  attachments.forEach((a, idx) => {
    const chip = document.createElement('div');
    chip.className = 'att-chip';
    if (a.dataUrl) {
      const img = document.createElement('img');
      img.src = a.dataUrl;
      chip.append(img);
    } else {
      chip.append(document.createTextNode(a.kind === 'folder' ? '📁' : '📄'));
    }
    const n = document.createElement('span');
    n.className = 'att-name';
    n.textContent = a.name;
    const x = document.createElement('span');
    x.className = 'att-x';
    x.textContent = '✕';
    x.addEventListener('click', () => {
      attachments.splice(idx, 1);
      renderAttachments();
    });
    chip.append(n, x);
    el.attachments.append(chip);
  });
}

// ---------- 미리보기 ----------

let htmlFiles = [];
let reloadTimer = null;
let previewOff = false; // 미리보기를 끈 상태
let autoPickNew = false; // 새로 생긴 파일이 나타나면 자동으로 띄운다
let knownFiles = new Set(); // 새 작업을 시작한 시점의 파일 목록

function setPvEmpty(text) {
  el.pvEmpty.textContent = text;
  el.pvEmpty.classList.remove('hidden');
  el.pvFoot.textContent = '';
}

/** 미리보기를 끈다. */
const PREVIEW_OFF_KEY = 'pb.previewOff';

/** 미리보기를 완전히 멈춘다 (숨기기만 하면 타이머·오류가 계속 돌아간다). */
function turnPreviewOff(message, remember) {
  previewOff = true;
  el.pvFile.value = '';
  void pb.previewStop();
  clearPreviewErrors();
  setPvEmpty(message);
  el.pvRestart.classList.add('hidden');
  if (remember) localStorage.setItem(PREVIEW_OFF_KEY, '1');
}

/**
 * HTML 패널은 필요할 때만 나타난다 — 새 HTML 파일(시뮬레이터·리포트)이 생기면 자동으로 열리고,
 * 채팅 상단의 [🖥 HTML 패널] 버튼으로 언제든 열고 닫을 수 있다.
 */
let panelOpen = false;
let externalPage = null; // 패널에 외부 웹페이지가 떠 있으면 그 URL

function setPanelOpen(v) {
  panelOpen = v;
  el.panel.classList.toggle('hidden', !v);
  el.dragbar.classList.toggle('hidden', !v);
  el.panelBtn.classList.toggle('on', v);
  if (v) {
    void refreshFiles();
    syncBounds();
  } else {
    void pb.previewHide();
  }
}

function renderFileList(keepSel) {
  const prev = keepSel ?? el.pvFile.value;
  el.pvFile.innerHTML = '';

  // '표시 안 함' 은 항상 맨 위에 둔다.
  const none = document.createElement('option');
  none.value = '';
  none.textContent = htmlFiles.length ? '표시 안 함' : 'HTML 파일 없음';
  el.pvFile.append(none);

  for (const f of htmlFiles) {
    const o = document.createElement('option');
    o.value = f.rel;
    o.textContent = f.rel;
    el.pvFile.append(o);
  }

  if (!htmlFiles.length) {
    el.pvFile.value = '';
    void pb.previewHide();
    setPvEmpty('표시할 HTML 파일이 없습니다.\n시뮬레이터나 리포트를 만들면 여기에 나타납니다.');
    return;
  }

  if (previewOff) {
    // 새 작업 이후 처음 생긴 파일이면 자동으로 띄운다.
    const fresh = autoPickNew ? htmlFiles.find((f) => !knownFiles.has(f.rel)) : null;
    if (fresh) {
      autoPickNew = false;
      el.pvFile.value = fresh.rel;
      void openPreview(fresh.rel);
    } else {
      el.pvFile.value = '';
      void pb.previewHide();
      setPvEmpty('미리보기를 끈 상태입니다.\n위에서 파일을 고르면 표시됩니다.');
    }
    return;
  }

  const target = htmlFiles.some((f) => f.rel === prev) ? prev : htmlFiles[0].rel;
  el.pvFile.value = target;
  if (target !== prev) void openPreview(target);
  else syncBounds();
}

async function refreshFiles() {
  htmlFiles = await pb.listHtml();
  renderFileList();
}

async function openPreview(rel) {
  if (!rel) return;
  externalPage = null;
  previewOff = false;
  autoPickNew = false;
  clearPreviewErrors();
  el.pvEmpty.classList.add('hidden');
  el.pvRestart.classList.add('hidden');
  const r = await pb.previewOpen(rel);
  if (!r?.ok) {
    el.pvFoot.textContent = '열기 실패: ' + (r?.error || '');
    return;
  }
  syncBounds();
}

function syncBounds() {
  if (!el.pvFile.value && !externalPage) {
    void pb.previewHide();
    return;
  }
  const r = el.pvStage.getBoundingClientRect();
  const dev = el.pvDevice.value;
  let b;
  if (dev === 'fit') {
    b = { x: r.left, y: r.top, width: r.width, height: r.height, zoom: 1 };
    el.pvFoot.textContent = `${Math.round(r.width)}×${Math.round(r.height)} · 100%`;
  } else {
    const [w, h] = dev.split('x').map(Number);
    const pad = 10;
    const s = Math.min(1, (r.width - pad * 2) / w, (r.height - pad * 2) / h);
    b = {
      x: r.left + (r.width - w * s) / 2,
      y: r.top + (r.height - h * s) / 2,
      width: w * s,
      height: h * s,
      zoom: s,
    };
    el.pvFoot.textContent = `${w}×${h} · ${Math.round(s * 100)}%`;
  }
  void pb.previewBounds(b);
}

function renderErrors() {
  const n = previewErrCount;
  el.pvErrBadge.classList.toggle('hidden', n === 0);
  el.pvErrBadge.textContent = n > 99 ? '99+' : String(n);
  el.errBar.classList.toggle('hidden', n === 0);
  if (n && previewErrLast) {
    el.errBarText.textContent = `미리보기 오류 ${n}건 — ${String(previewErrLast.message).slice(0, 70)}`;
  }
}

function clearPreviewErrors() {
  previewErrCount = 0;
  previewErrLast = null;
  renderErrors();
}

// ---------- 알림 토스트 ----------

let toastTimer = null;

/** 화면 오른쪽 아래에 잠깐 뜨는 안내. 누르면 해당 탭으로 간다. */
function showToast(text, onClick, status) {
  el.toast.textContent = text;
  el.toast.className = 'toast' + (status && status !== 'ok' ? ' warn' : '');
  el.toast.style.cursor = onClick ? 'pointer' : 'default';
  el.toast.onclick = () => {
    el.toast.classList.add('hidden');
    onClick?.();
  };
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 12000);
}

// ---------- 스킬 ----------
// 각 스킬은 앱에 내장된 SKILL.md(진짜 절차서)를 먼저 읽게 하는 짧은 프롬프트만 보낸다.
// 절차 전문을 여기 두지 않는 이유: 필요할 때만 읽어 토큰을 아끼기 위해서다.

const skillPrompt = (name, title, input) =>
  [
    `[스킬: ${title}]`,
    input ? `요청: ${input}` : '',
    '',
    `먼저 앱 내장 스킬 문서 skills/${name}/SKILL.md 를 Read 로 읽고 그 절차를 따르세요.`,
    '(시스템 지침에 스킬 폴더의 절대 경로가 있습니다. references/ 문서는 필요한 단계에서만 읽으세요.)',
    input ? '' : '요청이 비어 있으니, 이 스킬로 무엇을 할지 한 줄로 물어보고 기다리세요.',
  ]
    .filter(Boolean)
    .join('\n');

const SKILLS = {
  'design-doc': {
    ask: '기획서 관련 무엇을 할까요? (예: ○○ 기획서 읽고 질문 답변 / 예외처리 검수 / 새 기획서 작성)',
    optional: true,
    prompt: (input) => skillPrompt('design-doc', '기획서', input),
  },
  'data-table': {
    ask: '데이터 테이블 관련 무엇을 할까요? (예: ○○ 시트 오류 검수 / 값 수정 / 새 테이블 작성)',
    optional: true,
    prompt: (input) => skillPrompt('data-table', '데이터 테이블', input),
  },
  balance: {
    ask: '무엇을 밸런싱/검증할까요? (예: 5~10레벨 성장 곡선 검증 / 전투 시뮬레이터 제작)',
    optional: true,
    prompt: (input) => skillPrompt('balance', '밸런스 검증', input),
  },
  explore: {
    ask: '무엇을 찾거나 검사할까요? (예: ○○ 값 바꾸면 영향받는 곳 / 테이블↔코드 정합성 검사)',
    optional: true,
    prompt: (input) => skillPrompt('explore', '탐색·정합성', input),
  },
  qa: {
    ask: '어떤 기능/카드의 QA 케이스를 만들까요?',
    optional: true,
    prompt: (input) => skillPrompt('qa', 'QA 테스트 케이스', input),
  },
  archive: {
    ask: '무엇을 아카이빙할까요? (비워 두면 이번 대화의 중요 결정을 정리합니다)',
    optional: true,
    prompt: (input) => skillPrompt('archive', '아카이빙', input),
  },
};

/** 스킬 실행 — 프롬프트를 만들어 평소 전송 경로로 보낸다. */
async function runSkill(key) {
  const skill = SKILLS[key];
  if (!skill || !workDir) return;

  let input = '';
  if (skill.ask) {
    const answer = await promptDialog(skill.ask);
    if (answer === null) return; // 취소
    input = answer || '';
    if (!input.trim() && !skill.optional) return;
  }
  el.input.value = skill.prompt(input.trim());
  updateSendBtn();
  await doSend();
}

// ---------- 슬래시 명령 ----------

/**
 * `/` 로 시작하는 명령. kind:'agent' 는 클로드 코드가 처리하도록 그대로 넘기고,
 * kind:'local' 은 앱이 직접 답한다(토큰을 쓰지 않는다).
 * 여기 없는 명령도 그대로 전달되므로 클로드 코드가 아는 명령이면 동작한다.
 */
const COMMANDS = [
  {
    name: 'compact',
    args: '[요약할 때 신경 쓸 것]',
    desc: '대화를 요약해 컨텍스트를 비웁니다 (지금까지의 내용은 요약으로 남습니다)',
    kind: 'agent',
  },
  { name: 'context', desc: '지금 컨텍스트를 무엇이 차지하고 있는지 봅니다', kind: 'agent' },
  { name: 'usage', desc: '계정 사용량과 남은 한도를 봅니다', kind: 'agent' },
  {
    name: 'clear',
    desc: '대화 기억을 완전히 비웁니다 — 요약도 남기지 않습니다',
    kind: 'agent',
    warn: true,
    confirm:
      '이 대화의 기억을 완전히 비웁니다.\n' +
      '지금까지 정한 게임 내용을 에이전트가 더 이상 기억하지 못합니다.\n' +
      '(맥락을 남기고 정리만 하려면 /compact 를 쓰세요.)\n\n진행할까요?',
  },
  { name: 'help', desc: '쓸 수 있는 명령을 봅니다', kind: 'local' },
];

/** 클로드 코드가 영어로 돌려주는 흔한 안내를 우리말로 바꾼다. */
const CMD_MSG = {
  'Not enough messages to compact.':
    '정리할 만큼 대화가 쌓이지 않았습니다. 조금 더 진행한 뒤 다시 시도하세요.',
};
const cmdMsg = (t) => CMD_MSG[String(t).trim()] || t;

const cmdName = (text) => text.slice(1).split(/\s+/)[0].toLowerCase();
const findCmd = (text) => (text.startsWith('/') ? COMMANDS.find((c) => c.name === cmdName(text)) : null);

let cmdSel = 0;

/** 입력창이 `/이름` 꼴일 때만 후보를 띄운다. 인자를 적기 시작하면 닫는다. */
function cmdCandidates() {
  const v = el.input.value;
  if (!v.startsWith('/') || /\s/.test(v)) return null;
  const q = v.slice(1).toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q));
}

function renderCmdMenu() {
  const list = cmdCandidates();
  if (!list || !list.length) {
    el.cmdMenu.classList.add('hidden');
    return;
  }
  if (cmdSel >= list.length) cmdSel = 0;
  el.cmdMenu.innerHTML = '';
  list.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'cmd-item' + (i === cmdSel ? ' sel' : '');
    const name = document.createElement('span');
    name.className = 'cmd-name';
    name.textContent = '/' + c.name + (c.args ? ' ' + c.args : '');
    const desc = document.createElement('span');
    desc.className = 'cmd-desc' + (c.warn ? ' cmd-warn' : '');
    desc.textContent = c.desc;
    row.append(name, desc);
    // mousedown 이라야 입력창의 blur 보다 먼저 잡힌다
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickCmd(c);
    });
    el.cmdMenu.append(row);
  });
  const foot = document.createElement('div');
  foot.className = 'cmd-foot';
  foot.textContent = '↑↓ 이동 · Tab 자동완성 · Enter 실행 · 목록에 없는 클로드 코드 명령도 그대로 전달됩니다';
  el.cmdMenu.append(foot);
  el.cmdMenu.classList.remove('hidden');
}

function pickCmd(c) {
  el.input.value = '/' + c.name + (c.args ? ' ' : '');
  el.cmdMenu.classList.add('hidden');
  el.input.focus();
  updateSendBtn();
}

/** 명령 메뉴가 떠 있을 때의 키 처리. 처리했으면 true. */
function cmdMenuKey(e) {
  if (el.cmdMenu.classList.contains('hidden')) return false;
  const list = cmdCandidates();
  if (!list || !list.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    cmdSel = (cmdSel + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    renderCmdMenu();
    return true;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    pickCmd(list[cmdSel]);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    el.cmdMenu.classList.add('hidden');
    return true;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    const c = list[cmdSel];
    el.input.value = '/' + c.name;
    el.cmdMenu.classList.add('hidden');
    void doSend();
    return true;
  }
  return false;
}

/** 앱이 직접 답하는 명령 (모델을 부르지 않는다). */
function localCommand(name) {
  if (name !== 'help') return '알 수 없는 명령입니다.';
  const rows = COMMANDS.map(
    (c) => `| \`/${c.name}${c.args ? ' ' + c.args : ''}\` | ${c.desc} |`,
  ).join('\n');
  return [
    '**쓸 수 있는 명령**',
    '',
    '| 명령 | 하는 일 |',
    '|---|---|',
    rows,
    '',
    '여기 없는 명령도 클로드 코드로 그대로 전달됩니다.',
    '컨텍스트가 꽉 차 갈 때는 `/compact` 로 정리하면 대화를 이어서 할 수 있습니다.',
    '',
    '**단축키** — `⌘F`(맥) / `Ctrl+F`(윈도우) 이 대화에서 찾기 · `Esc` 닫기',
  ].join('\n');
}

function runLocalCommand(text) {
  touchConv(text);
  const at = Date.now();
  currentConv.msgs.push({ role: 'user', text, at });
  addUserMsg(text, [], true, at);
  const out = localCommand(cmdName(text));
  currentConv.msgs.push({ role: 'system', text: out });
  addSystemMsg(out);
  saveConvs();
  renderHistory();
}

// ---------- 전송 ----------

/** 사용자가 보낸 것을 지금 실행하거나(놀고 있으면) 대기열에 넣는다. */
async function doSend() {
  const text = el.input.value.trim();
  if (!text || !workDir) return;

  const slash = text.startsWith('/');
  const cmd = findCmd(text);
  if (cmd?.confirm && !(await confirmDialog(cmd.confirm))) return;

  // 명령에는 첨부·오류를 붙이지 않는다
  const atts = slash ? [] : attachments.slice();

  el.input.value = '';
  el.input.style.height = 'auto';
  el.cmdMenu.classList.add('hidden');
  if (!slash) {
    attachments = [];
    renderAttachments();
  }
  updateSendBtn();

  // 앱이 직접 답하는 명령은 모델을 부르지 않는다
  if (cmd?.kind === 'local') {
    runLocalCommand(text);
    return;
  }

  touchConv(text);
  const r = runtime(currentConv.id);
  r.id = currentConv.id;

  if (r.busy) {
    // 작업 중이면 멈추지 않고 뒤에 이어 붙인다
    r.queue.push({ text, atts, slash });
    renderQueue();
    renderHistory();
    return;
  }
  await startTurn(currentConv, r, text, atts, slash);
}

/** 한 턴을 실제로 실행한다. 끝나면 대기열에 있는 다음 요청을 이어서 돌린다. */
async function startTurn(c, r, text, atts, slash = false) {
  const includeErrors = !slash && previewErrCount > 0 && el.errInclude.checked;
  const at = Date.now();

  c.msgs.push({ role: 'user', text, at, atts: atts.map((a) => ({ name: a.name, kind: a.kind })) });
  if (isActive(c.id)) addUserMsg(text, atts, true, at);
  renderHistory();

  r.busy = true;
  r.buf = '';
  r.box = isActive(c.id) ? addAssistantMsg() : null;
  startWork(r);
  if (isActive(c.id)) setBusyUI(true);
  renderHistory();

  let res;
  try {
    res = await pb.ask(c.id, text, atts, { includeErrors });
  } catch (e) {
    res = { status: 'error', message: `앱 내부 오류: ${e?.message || e}` };
  }

  const summary = endWork(r, res.status);
  const finishedInBackground = !isActive(c.id);
  r.busy = false;
  if (!finishedInBackground) setBusyUI(false);

  let finalText =
    res.status === 'error'
      ? `⚠️ 오류: ${res.message}`
      : r.buf || res.result || (res.status === 'stopped' ? '_중지되었습니다._' : '');
  if (slash) finalText = cmdMsg(finalText);

  if (r.box) {
    r.box.md.innerHTML = renderMd(finalText);
    if (r.work.thinking) appendThinkingBlock(r.box, r.work.thinking);
    appendTurnSummary(r.box, res, summary);
  }
  r.box = null;

  if (res.sessionId) c.sessionId = res.sessionId;
  c.msgs.push({ role: 'assistant', text: finalText });
  saveConvs();
  if (isActive(c.id)) scrollDown();

  const doneLabel = res.status === 'ok' ? '작업 완료' : res.status === 'stopped' ? '작업 중지' : '작업 오류';
  if (finishedInBackground) {
    // 다른 탭에서 끝났으면 놓치기 쉬우므로 확실히 알린다
    c.unread = res.status;
    showToast(`${c.title || '작업'} — ${doneLabel} · ${summary.elapsed}`, () => openConv(c), res.status);
    void pb.notifyDone({
      title: doneLabel,
      body: `${c.title || '작업'} · ${summary.elapsed} · 작업 ${summary.tools}건`,
      force: true, // 창을 보고 있어도 다른 탭 결과는 알린다
    });
  } else if (Date.now() - r.work.startedAt > 20000) {
    void pb.notifyDone({
      title: doneLabel,
      body: `${c.title || '작업'} · ${summary.elapsed} · 작업 ${summary.tools}건`,
    });
  }

  if (includeErrors) clearPreviewErrors();
  if (findOpen()) runFind(el.findInput.value); // 새 글이 붙었으니 표시를 다시 잡는다
  if (!el.jumpPanel.classList.contains('hidden')) renderJump();
  void refreshCtx();
  void refreshUsage();
  void refreshFiles();
  renderHistory();

  // 대기열 이어서
  const next = r.queue.shift();
  renderQueue();
  if (next) await startTurn(c, r, next.text, next.atts, next.slash);
}

/** 대화에 남기는 사고 과정(접힘). */
function appendThinkingBlock(box, thinking) {
  const open = document.createElement('div');
  open.className = 'think-open';
  open.textContent = '생각 과정 보기 ▾';
  const boxEl = document.createElement('pre');
  boxEl.className = 'think-box hidden';
  boxEl.textContent = thinking;
  open.addEventListener('click', () => {
    const hidden = boxEl.classList.toggle('hidden');
    open.textContent = hidden ? '생각 과정 보기 ▾' : '생각 과정 접기 ▴';
  });
  box.tools.append(open, boxEl);
}

function appendTurnSummary(box, res, summary) {
  if (!summary.tools) return;
  const sum = document.createElement('div');
  sum.className = 'tool-summary';
  const cost = typeof res.costUsd === 'number' ? ` · $${res.costUsd.toFixed(2)}` : '';
  sum.textContent =
    `${res.status === 'ok' ? '완료' : res.status === 'stopped' ? '중지됨' : '오류'} · ` +
    `${summary.elapsed} · 작업 ${summary.tools}건${cost}`;
  box.tools.prepend(sum);
}

function fmtTok(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return String(n);
}

let lastCtx = null;

async function refreshCtx() {
  const u = await pb.getContextUsage();
  lastCtx = u;
  if (!u || typeof u.totalTokens !== 'number') {
    el.ctxUsage.classList.add('hidden');
    el.usageCtx.textContent = '컨텍스트 —';
    return;
  }
  const pct = u.percentage ?? Math.round((u.totalTokens / (u.maxTokens || 200000)) * 100);
  const label = `컨텍스트 ${pct}% (${fmtTok(u.totalTokens)}/${fmtTok(u.maxTokens)})`;
  el.ctxUsage.textContent = label;
  el.ctxUsage.title = u.isAutoCompactEnabled
    ? `${fmtTok(u.autoCompactThreshold)} 토큰을 넘으면 자동으로 요약됩니다`
    : label;
  el.ctxUsage.classList.remove('hidden');
  el.usageCtx.textContent = label;
}

/** ISO 시각을 "2시간 10분 후 재설정" / "(월) 오전 8:59에 재설정" 형태로 만든다. */
function fmtReset(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffMin = Math.round((t - Date.now()) / 60000);
  if (diffMin <= 0) return '곧 재설정';
  if (diffMin < 60) return `${diffMin}분 후 재설정`;
  if (diffMin < 60 * 24) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m ? `${h}시간 ${m}분 후 재설정` : `${h}시간 후 재설정`;
  }
  const d = new Date(t);
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  return `(${wd}) ${time}에 재설정`;
}

function bar(pct) {
  const v = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const cls = v >= 90 ? ' danger' : v >= 70 ? ' warn' : '';
  // CSP(style-src 'self')가 인라인 style 속성을 막으므로 폭은 나중에 CSSOM 으로 준다.
  return `<div class="bar"><div class="bar-fill${cls}" data-pct="${v}"></div></div>`;
}

/** data-pct 를 실제 폭으로 반영한다. */
function applyBars(root) {
  for (const f of root.querySelectorAll('.bar-fill[data-pct]')) {
    f.style.width = f.dataset.pct + '%';
  }
}

function usageRow(label, right, pct) {
  return `<div class="u-row"><div class="u-head"><span>${label}</span><span class="u-right">${right}</span></div>${bar(pct)}</div>`;
}

let lastAccount = null;

/** 사이드바 배지 갱신 — 계정 한도와 컨텍스트를 보여 준다. */
function renderUsageBadge() {
  const rl = lastAccount?.rate_limits;
  const five = rl?.five_hour?.utilization;
  const week = rl?.seven_day?.utilization;
  if (typeof five === 'number' || typeof week === 'number') {
    const parts = [];
    if (typeof five === 'number') parts.push(`5시간 ${Math.round(five)}%`);
    if (typeof week === 'number') parts.push(`주간 ${Math.round(week)}%`);
    el.usageCost.textContent = parts.shift() || '';
    el.usageTok.textContent = parts.join(' · ');
  } else {
    // 플랜 한도를 알 수 없는 계정(API 키 등)에서는 이번 실행 비용을 보여 준다.
    el.usageCost.textContent = '사용량';
    el.usageTok.textContent = lastAccount ? '한도 정보 없음' : '확인 중…';
  }
}

/** 사용량 상세 모달. */
async function refreshUsage() {
  const u = await pb.usage();
  const acc = await pb.accountUsage();
  if (acc) lastAccount = acc;
  renderUsageBadge();

  if (el.usageModal.classList.contains('hidden')) return;

  let html = '';

  if (lastCtx && typeof lastCtx.totalTokens === 'number') {
    const pct = lastCtx.percentage ?? Math.round((lastCtx.totalTokens / (lastCtx.maxTokens || 1)) * 100);
    html += '<div class="u-sec">컨텍스트 윈도우</div>';
    html += usageRow(
      lastCtx.model || '현재 작업',
      `${fmtTok(lastCtx.totalTokens)} / ${fmtTok(lastCtx.maxTokens)} (${pct}%)`,
      pct,
    );
  }

  const rl = lastAccount?.rate_limits;
  if (rl) {
    const plan = lastAccount.subscription_type ? ` · ${lastAccount.subscription_type}` : '';
    html += `<div class="u-sec">사용 한도${plan}</div>`;
    const win = (label, w) =>
      w && typeof w.utilization === 'number'
        ? usageRow(label, `${fmtReset(w.resets_at)}　${Math.round(w.utilization)}%`, w.utilization)
        : '';
    html += win('5시간 한도', rl.five_hour);
    html += win('주간 · 전체 모델', rl.seven_day);
    html += win('주간 · Opus', rl.seven_day_opus);
    html += win('주간 · Sonnet', rl.seven_day_sonnet);
    for (const m of rl.model_scoped ?? []) html += win(`주간 · ${m.display_name}`, m);
    const ex = rl.extra_usage;
    if (ex && ex.is_enabled) {
      // 금액은 최소 단위(센트 등)로 오므로 decimal_places 로 나눈다.
      const div = 10 ** (ex.decimal_places ?? 2);
      const cur = ex.currency === 'USD' ? 'US$' : ex.currency ? ex.currency + ' ' : '$';
      const limit = (ex.monthly_limit ?? 0) / div;
      const used = (ex.used_credits ?? 0) / div;
      html += usageRow(
        '사용 크레딧',
        `${cur}${limit.toFixed(2)} 중 ${cur}${used.toFixed(2)}`,
        ex.utilization ?? (limit ? (used / limit) * 100 : 0),
      );
    }
  } else if (lastAccount) {
    html += '<div class="u-sec">사용 한도</div><p class="u-note">이 계정에서는 플랜 한도를 조회할 수 없습니다.</p>';
  }

  // 이 앱에서 쓴 양 (참고용)
  const r = u?.run;
  if (r && r.turns > 0) {
    const tok = (r.input || 0) + (r.output || 0) + (r.cacheWrite || 0) + (r.cacheRead || 0);
    html += '<div class="u-sec">이 앱에서 쓴 양</div>';
    html += `<table>
      <tr><td>이번 실행</td><td>${r.turns || 0}턴 · ${fmtTok(tok)} 토큰 · $${(r.costUsd || 0).toFixed(3)}</td></tr>
      ${
        u.allTime
          ? `<tr><td>전체 누적</td><td>${u.allTime.turns || 0}턴 · ${fmtTok(
              (u.allTime.input || 0) + (u.allTime.output || 0) + (u.allTime.cacheWrite || 0) + (u.allTime.cacheRead || 0),
            )} 토큰 · $${(u.allTime.costUsd || 0).toFixed(3)}</td></tr>`
          : ''
      }
    </table>`;
  }

  try {
    const m = await pb.connMeter();
    const label = { google: '구글', slack: '슬랙', trello: '트렐로' };
    let sec = '';
    for (const [svc, v] of Object.entries(m || {})) {
      if (!v.today && !v.pausedSec) continue;
      const paused = v.pausedSec ? `　⏸ ${v.pausedSec}초 일시정지` : '';
      sec += usageRow(label[svc] || svc, `오늘 ${v.today}/${v.perDay}회 · 최근 1분 ${v.lastMin}/${v.perMin}회${paused}`, (v.today / v.perDay) * 100);
    }
    if (sec) html += '<div class="u-sec">외부 API 사용량 가드</div>' + sec;
  } catch {
    /* 미터 조회 실패는 무시 */
  }

  el.usageBody.innerHTML = html || '<p class="u-note">아직 사용 기록이 없습니다.</p>';
  applyBars(el.usageBody);

  if (u?.permissionMode && el.permSelect.value !== u.permissionMode) {
    el.permSelect.value = u.permissionMode;
  }
}

/** 권한 확인 요청을 하나씩 보여 준다. */
function showNextPerm() {
  const p = permQueue[0];
  if (!p) {
    el.permModal.classList.add('hidden');
    return;
  }
  el.permTool.textContent = p.displayName || p.tool;
  el.permTitle.textContent = p.title || '';
  el.permSummary.textContent = p.summary || '';
  el.permSummary.classList.toggle('hidden', !p.summary);
  el.permDesc.textContent = p.description || p.reason || '';
  const more = permQueue.length - 1;
  el.permCount.textContent = more > 0 ? `+ 대기 ${more}건` : '';
  el.permCount.classList.toggle('hidden', more <= 0);
  el.permAllowAll.textContent = `모두 허용 (${permQueue.length})`;
  el.permAllowAll.classList.toggle('hidden', permQueue.length < 2);
  el.permModal.classList.remove('hidden');
}

function replyPerm(decision) {
  const p = permQueue.shift();
  if (p) void pb.permissionReply({ id: p.id, decision });
  showNextPerm();
}

// ---------- 연동 설정 (구글·슬랙·트렐로) ----------

/** 드라이브 폴더 URL 을 붙여넣어도 ID 만 뽑아낸다. */
function parseFolderId(v) {
  const t = String(v || '').trim();
  const m = /folders\/([A-Za-z0-9_-]{10,})/.exec(t);
  return m ? m[1] : t;
}

// 선택 배열은 절대 재할당하지 않는다 — 체크박스 핸들러가 이 객체를 직접 참조하므로,
// 재할당하면 이미 그려진 체크가 옛 배열에 기록되어 저장 시 유실된다.
const connDocsIds = [];
const connSheetsIds = [];
const connUnityPaths = [];

/** 문자열 목록을 ✕ 삭제 칩으로 렌더. arr 는 제자리 갱신(재할당 금지). */
function renderChips(listEl, arr) {
  listEl.innerHTML = '';
  arr.forEach((v, i) => {
    const chip = document.createElement('span');
    chip.className = 'conn-chip';
    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = v;
    label.title = v;
    const x = document.createElement('span');
    x.className = 'chip-x';
    x.textContent = '✕';
    x.title = '제거';
    x.addEventListener('click', () => {
      arr.splice(i, 1);
      renderChips(listEl, arr);
    });
    chip.append(label, x);
    listEl.append(chip);
  });
}

function addChip(inputEl, listEl, arr, parse) {
  const v = (parse ? parse(inputEl.value) : inputEl.value).trim();
  if (!v || arr.includes(v)) return;
  arr.push(v);
  inputEl.value = '';
  renderChips(listEl, arr);
}

const connSlackSel = [];  // {id, name}
const connTrelloSel = []; // {id, name}

function seedSel(sel, items) {
  sel.length = 0;
  sel.push(...items);
}

function stateEl(elm, text, cls) {
  elm.textContent = text;
  elm.className = 'conn-state' + (cls ? ' ' + cls : '');
}

/** 연결 상태를 읽어 화면을 갱신한다. withProject=true(모달 열 때만)면 프로젝트 입력·선택도 다시 채운다. */
async function refreshConn(withProject = false) {
  const st = await pb.connStatus();

  // 구글
  if (st.google.connected) {
    stateEl(el.gState, '연결됨 — 확인 중…', 'ok');
    el.gOut.classList.remove('hidden');
    pb.connGoogleWho().then((w) => {
      if (w.ok) stateEl(el.gState, `연결됨 — ${w.email || w.name}`, 'ok');
      else stateEl(el.gState, '연결됨 (확인 실패: ' + w.error + ')', 'err');
    });
  } else {
    stateEl(el.gState, st.google.hasClient ? 'JSON 등록됨 — ② 로그인 필요' : '① JSON 가져오기부터 시작');
    el.gOut.classList.add('hidden');
  }

  // 슬랙
  if (st.slack.connected) {
    stateEl(el.sState, `연결됨 — ${st.slack.team} (@${st.slack.botUser})`, 'ok');
    el.sToken.classList.add('hidden');
    el.sSave.classList.add('hidden');
    el.sOut.classList.remove('hidden');
  } else {
    stateEl(el.sState, '미연결');
    el.sToken.classList.remove('hidden');
    el.sSave.classList.remove('hidden');
    el.sOut.classList.add('hidden');
  }

  // 트렐로
  if (st.trello.connected) {
    stateEl(el.tState, `연결됨 — @${st.trello.username}`, 'ok');
    el.tKey.classList.add('hidden');
    el.tToken.classList.add('hidden');
    el.tSave.classList.add('hidden');
    el.tOut.classList.remove('hidden');
  } else {
    stateEl(el.tState, '미연결');
    el.tKey.classList.remove('hidden');
    el.tToken.classList.remove('hidden');
    el.tSave.classList.remove('hidden');
    el.tOut.classList.add('hidden');
  }

  // 쓰기 자동 허용 목록
  try {
    const keys = await pb.connWriteAllow('get');
    el.waList.innerHTML = '';
    if (!keys.length) {
      const sp = document.createElement('span');
      sp.className = 'conn-state';
      sp.textContent = '없음 — 승인창에서 [이 도구는 항상 허용]을 누르면 여기에 쌓입니다';
      el.waList.append(sp);
    } else {
      for (const k of keys) {
        const b = document.createElement('button');
        b.className = 'ghost sm';
        b.textContent = `${k} ✕`;
        b.title = '자동 허용 해제 — 다시 물어봅니다';
        b.addEventListener('click', async () => {
          await pb.connWriteAllow('clear', k);
          void refreshConn();
        });
        el.waList.append(b);
      }
    }
  } catch {
    /* noop */
  }

  // 앱 업데이트 — 릴리스 폴더 프리필
  try {
    el.uFolder.value = (await pb.upGetFolder()) || '';
  } catch {
    /* noop */
  }

  // 인덱스 상태
  if (st.index?.syncedAt) {
    const c = st.index.counts || {};
    const parts = [];
    if (c.docs != null) parts.push(`기획서 ${c.docs}`);
    if (c.sheets != null) parts.push(`시트 ${c.sheets}`);
    if (c.slackChannels != null) parts.push(`채널 ${c.slackChannels}`);
    if (c.trelloLists != null) parts.push(`트렐로 리스트 ${c.trelloLists}`);
    if (c.csFiles != null) parts.push(`.cs ${c.csFiles}`);
    stateEl(el.idxState, `${String(st.index.syncedAt).slice(0, 16).replace('T', ' ')} 동기화 — ${parts.join(' · ')}`, 'ok');
  } else {
    stateEl(el.idxState, '아직 동기화 전');
  }

  // 프로젝트 연결 프리필 — 모달을 새로 열 때만. (서비스 버튼을 누를 때마다 하면
  // 사용자가 방금 체크한 채널·보드 선택이 저장 전에 풀려 버린다.)
  if (!withProject) return;
  const pj = st.project;
  el.connProjName.textContent = st.workDir ? `— ${st.workDir.split('/').pop()}` : '— 작업 폴더 필요';
  if (pj) {
    const gd = pj.google_drive ?? {};
    seedSel(connDocsIds, [...new Set([gd.docs_folder_id, ...(gd.docs_folder_ids ?? [])].filter(Boolean))]);
    seedSel(connSheetsIds, [...new Set([gd.sheets_folder_id, ...(gd.sheets_folder_ids ?? [])].filter(Boolean))]);
    const u = pj.unity ?? {};
    const paths = (u.projects ?? []).map((x) => x?.path).filter(Boolean);
    if (u.project_path && !paths.includes(u.project_path)) paths.unshift(u.project_path);
    seedSel(connUnityPaths, paths);
    renderChips(el.pDocsList, connDocsIds);
    renderChips(el.pSheetsList, connSheetsIds);
    renderChips(el.pUnityList, connUnityPaths);
    seedSel(connSlackSel, (pj.slack?.channels ?? []).map((c) => ({ id: c.id, name: c.name })));
    seedSel(connTrelloSel, (pj.trello?.boards ?? []).map((b) => ({ id: b.id, name: b.name })));
    renderConnSel(el.pSlackList, connSlackSel);
    renderConnSel(el.pTrelloList, connTrelloSel);
  }
}

/** 목록을 아직 안 불러왔을 때, 저장된 선택만 보여 준다. 모달을 다시 열면 항상 새로 그린다. */
function renderConnSel(listEl, sel) {
  listEl.innerHTML = '';
  listEl.classList.toggle('on', sel.length > 0);
  if (!sel.length) return;
  for (const it of sel) {
    const row = document.createElement('label');
    row.className = 'conn-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.addEventListener('change', () => {
      if (!box.checked) {
        const i = sel.findIndex((x) => x.id === it.id);
        if (i >= 0) sel.splice(i, 1);
      } else sel.push(it);
    });
    const name = document.createElement('span');
    name.textContent = it.name || it.id;
    row.append(box, name);
    listEl.append(row);
  }
}

/** 전체 후보 목록(채널/보드)을 체크박스로. */
function renderConnPicker(listEl, items, sel, extra) {
  listEl.classList.add('on');
  listEl.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('label');
    row.className = 'conn-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = sel.some((x) => x.id === it.id);
    box.addEventListener('change', () => {
      const i = sel.findIndex((x) => x.id === it.id);
      if (box.checked && i < 0) sel.push({ id: it.id, name: it.name });
      if (!box.checked && i >= 0) sel.splice(i, 1);
    });
    const name = document.createElement('span');
    name.textContent = (it.isPrivate ? '🔒 ' : '#') + it.name;
    row.append(box, name);
    const note = extra?.(it);
    if (note) {
      const d = document.createElement('span');
      d.className = 'dim';
      d.textContent = note;
      row.append(d);
    }
    listEl.append(row);
  }
}

/** 업데이트 배너 — 사이드바 하단에 고정, 처리 전까지 유지된다. */
function showUpdateBar(version) {
  el.updateVer.textContent = `v${version}`;
  el.updateGo.textContent = '업데이트';
  el.updateGo.disabled = false;
  el.updateBar.classList.remove('hidden', 'busy');
}

async function doUpdateDownload() {
  el.updateGo.disabled = true;
  el.updateGo.textContent = '내려받는 중…';
  el.updateBar.classList.add('busy');
  const r = await pb.upDownload();
  el.updateBar.classList.remove('busy');
  if (r.ok) {
    el.updateGo.textContent = '설치 파일 열림 ✓';
    showToast(`v${r.version} 다운로드 완료 — 설치 후 앱을 다시 실행하세요.`);
    setTimeout(() => el.updateBar.classList.add('hidden'), 8000);
  } else {
    el.updateGo.disabled = false;
    el.updateGo.textContent = '다시 시도';
    showToast('업데이트 다운로드 실패 — ' + (r.error || ''), null, 'warn');
  }
}

function openConn() {
  el.connMsg.textContent = '';
  el.connModal.classList.remove('hidden');
  void refreshConn(true);
}

function bindConn() {
  el.connBtn.addEventListener('click', openConn);
  el.connClose.addEventListener('click', () => el.connModal.classList.add('hidden'));
  el.connModal.addEventListener('click', (e) => {
    if (e.target === el.connModal) el.connModal.classList.add('hidden');
  });

  el.gImport.addEventListener('click', async () => {
    const r = await pb.connGoogleImportSecret();
    if (r.ok) showToast('클라이언트 JSON 등록 완료 — 이제 ② 구글 로그인');
    else if (!r.cancelled) showToast(r.error || '가져오기 실패', null, 'warn');
    void refreshConn();
  });
  el.gLogin.addEventListener('click', async () => {
    stateEl(el.gState, '브라우저에서 로그인을 완료하세요…');
    const r = await pb.connGoogleLogin();
    if (r.ok) showToast(`구글 연결 완료 — ${r.email || ''}`);
    else showToast(r.error || '로그인 실패', null, 'warn');
    void refreshConn();
  });
  el.gOut.addEventListener('click', async () => {
    if (!(await confirmDialog('구글 연결을 해제할까요?'))) return;
    await pb.connDisconnect('google');
    void refreshConn();
  });

  el.sSave.addEventListener('click', async () => {
    const token = el.sToken.value.trim();
    if (!token) return;
    stateEl(el.sState, '확인 중…');
    const r = await pb.connSlackSet(token);
    el.sToken.value = ''; // 화면에 남기지 않는다
    if (r.ok) showToast(`슬랙 연결 완료 — ${r.team}`);
    else showToast(r.error || '연결 실패', null, 'warn');
    void refreshConn();
  });
  el.sOut.addEventListener('click', async () => {
    if (!(await confirmDialog('슬랙 연결을 해제할까요?'))) return;
    await pb.connDisconnect('slack');
    void refreshConn();
  });

  el.tSave.addEventListener('click', async () => {
    const key = el.tKey.value.trim();
    const token = el.tToken.value.trim();
    if (!key || !token) return;
    stateEl(el.tState, '확인 중…');
    const r = await pb.connTrelloSet({ key, token });
    el.tKey.value = '';
    el.tToken.value = '';
    if (r.ok) showToast(`트렐로 연결 완료 — @${r.username}`);
    else showToast(r.error || '연결 실패', null, 'warn');
    void refreshConn();
  });
  el.tOut.addEventListener('click', async () => {
    if (!(await confirmDialog('트렐로 연결을 해제할까요?'))) return;
    await pb.connDisconnect('trello');
    void refreshConn();
  });

  el.pSlackLoad.addEventListener('click', async () => {
    el.pSlackLoad.textContent = '불러오는 중…';
    const r = await pb.connSlackChannels();
    el.pSlackLoad.textContent = '채널 불러오기';
    if (!r.ok) return showToast(r.error || '채널 조회 실패', null, 'warn');
    const items = [...r.channels].sort((a, b) => Number(b.isMember) - Number(a.isMember));
    renderConnPicker(el.pSlackList, items, connSlackSel, (c) => (c.isMember ? '봇 참여 중' : '⚠ /invite 필요'));
  });

  el.pTrelloLoad.addEventListener('click', async () => {
    el.pTrelloLoad.textContent = '불러오는 중…';
    const r = await pb.connTrelloBoards();
    el.pTrelloLoad.textContent = '보드 불러오기';
    if (!r.ok) return showToast(r.error || '보드 조회 실패', null, 'warn');
    renderConnPicker(el.pTrelloList, r.boards.map((b) => ({ ...b, isPrivate: false })), connTrelloSel);
  });

  el.pDocsAdd.addEventListener('click', () => addChip(el.pDocsFolder, el.pDocsList, connDocsIds, parseFolderId));
  el.pSheetsAdd.addEventListener('click', () => addChip(el.pSheetsFolder, el.pSheetsList, connSheetsIds, parseFolderId));
  el.pUnityPick.addEventListener('click', async () => {
    const d = await pb.connPickUnityDir();
    if (d && !connUnityPaths.includes(d)) {
      connUnityPaths.push(d);
      renderChips(el.pUnityList, connUnityPaths);
    }
  });

  el.uSave.addEventListener('click', async () => {
    await pb.upSetFolder(parseFolderId(el.uFolder.value));
    showToast('릴리스 폴더 저장 완료');
  });
  el.uCheck.addEventListener('click', async () => {
    stateEl(el.uState, '확인 중…');
    const r = await pb.upCheck();
    if (r?.version && !r.skip && !r.upToDate) {
      stateEl(el.uState, `새 버전 ${r.version} 발견!`, 'ok');
      showUpdateBar(r.version);
      el.connModal.classList.add('hidden');
    } else if (r?.upToDate) stateEl(el.uState, `최신입니다 (v${r.current})`, 'ok');
    else stateEl(el.uState, r?.reason || '확인 실패', 'err');
  });

  el.idxSync.addEventListener('click', async () => {
    stateEl(el.idxState, '동기화 중…');
    const r = await pb.connSyncIndex();
    if (r?.ok) showToast('인덱스 동기화 완료');
    else showToast('인덱스 동기화 실패 — ' + (r?.error || r?.reason || ''), null, 'warn');
    void refreshConn();
  });
  pb.onIndexStatus((p) => {
    if (p.msg) stateEl(el.idxState, '동기화 중 — ' + p.msg);
    else if (p.done && p.ok) void refreshConn();
    else if (p.done && p.ok === false) stateEl(el.idxState, '실패: ' + (p.error || ''), 'err');
  });

  el.connSave.addEventListener('click', async () => {
    // 입력칸에 남아 있는 값도 [추가] 없이 저장되게 흡수한다
    addChip(el.pDocsFolder, el.pDocsList, connDocsIds, parseFolderId);
    addChip(el.pSheetsFolder, el.pSheetsList, connSheetsIds, parseFolderId);
    const links = {
      docsFolderIds: [...connDocsIds],
      sheetsFolderIds: [...connSheetsIds],
      slackChannels: connSlackSel,
      trelloBoards: connTrelloSel,
      unityPaths: [...connUnityPaths],
    };
    const r = await pb.connProjectSave(links);
    if (r.ok) {
      el.connMsg.textContent = '';
      showToast('프로젝트 설정 저장 완료 (.ddalgi/project.yaml)');
      el.connModal.classList.add('hidden');
    } else {
      el.connMsg.textContent = r.error || '저장 실패';
    }
  });
}

// ---------- 인증·버전 ----------

async function refreshAuth() {
  const s = await pb.authStatus();
  if (s?.loggedIn) {
    el.acctLabel.textContent = s.email || s.account || '로그인됨';
    el.acctLabel.title = el.acctLabel.textContent;
    el.authBtn.textContent = '로그아웃';
    el.authBtn.classList.remove('hidden');
    el.authBtn.onclick = async () => {
      if (!(await confirmDialog('Claude 계정에서 로그아웃할까요?'))) return;
      await pb.authLogout();
      void refreshAuth();
    };
  } else {
    el.acctLabel.textContent = '로그인 필요';
    el.authBtn.textContent = '로그인';
    el.authBtn.classList.remove('hidden');
    el.authBtn.onclick = async () => {
      el.acctLabel.textContent = '로그인 중…';
      const r = await pb.authLogin();
      if (!r?.ok) el.acctLabel.textContent = '로그인 실패';
      void refreshAuth();
    };
  }
}

/** 한 줄 입력을 받는다. 취소하면 null. */
function promptDialog(msg, initial = '') {
  return new Promise((resolve) => {
    el.promptMsg.textContent = msg;
    el.promptInput.value = initial;
    el.promptModal.classList.remove('hidden');
    el.promptInput.focus();
    const done = (v) => {
      el.promptModal.classList.add('hidden');
      el.promptInput.onkeydown = null;
      resolve(v);
    };
    el.promptYes.onclick = () => done(el.promptInput.value);
    el.promptNo.onclick = () => done(null);
    el.promptInput.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(el.promptInput.value);
      if (e.key === 'Escape') done(null);
    };
  });
}

function confirmDialog(msg) {
  return new Promise((resolve) => {
    el.confirmMsg.textContent = msg;
    el.confirmModal.classList.remove('hidden');
    const done = (v) => {
      el.confirmModal.classList.add('hidden');
      resolve(v);
    };
    el.confirmYes.onclick = () => done(true);
    el.confirmNo.onclick = () => done(false);
  });
}

// ---------- 초기화 ----------

async function applyInit(r) {
  if (r.status === 'ready') {
    workDir = r.workDir;
    setStatus(r.workDir.split('/').pop(), 'ok');
    htmlFiles = r.htmlFiles || [];
    knownFiles = new Set(htmlFiles.map((f) => f.rel));
    renderFileList();
    el.setup.classList.add('hidden');
    el.chat.classList.remove('hidden');
    el.input.focus();
    void refreshCtx();
    return;
  }
  if (r.status === 'need-folder' || r.status === 'cancelled') {
    el.chat.classList.add('hidden');
    el.setup.classList.remove('hidden');
    setStatus('작업 폴더 필요');
    return;
  }
  el.setup.classList.remove('hidden');
  el.setupMsg.textContent = r.message || '알 수 없는 오류';
  setStatus('오류', 'err');
}

/** 새 작업 — 새 채팅방을 연다. 이전 대화는 최근 작업 목록에 그대로 남는다. */
function startFresh() {
  startNew();
  el.input.focus();
}

async function openGuide(which) {
  el.guideModal.classList.remove('hidden');
  el.guideBody.innerHTML = '<p>불러오는 중…</p>';
  for (const b of document.querySelectorAll('.tab-btn')) {
    b.classList.toggle('active', b.dataset.guide === which);
  }
  el.guideFoot.textContent =
    which === 'patch'
      ? '버전별 변경 내역입니다. 사이드바의 버전을 눌러도 열립니다.'
      : '이 문서는 앱에 내장되어 있습니다. 매 작업마다 에이전트가 먼저 읽습니다.';
  const text = await pb.readGuide(which);
  el.guideBody.innerHTML = renderMd(text);
  el.guideBody.scrollTop = 0;
}

function bind() {
  el.chooseBtn.addEventListener('click', async () => {
    el.setupMsg.textContent = '';
    await applyInit(await pb.chooseFolder());
  });

  el.input.addEventListener('input', () => {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(220, el.input.scrollHeight) + 'px';
    cmdSel = 0;
    renderCmdMenu();
    updateSendBtn();
  });

  el.input.addEventListener('keydown', (e) => {
    if (cmdMenuKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void doSend();
    }
  });
  el.input.addEventListener('blur', () => setTimeout(() => el.cmdMenu.classList.add('hidden'), 120));

  // ---- 이 대화에서 찾기 ----
  el.findBtn.addEventListener('click', openFind);
  el.findClose.addEventListener('click', closeFind);
  el.findNext.addEventListener('click', () => stepFind(1));
  el.findPrev.addEventListener('click', () => stepFind(-1));
  let findTimer = null;
  el.findInput.addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => runFind(el.findInput.value), 140);
  });
  el.findInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
      el.input.focus();
    }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      openFind();
    }
  });

  // ---- 내가 한 말 목록 ----
  el.jumpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleJump();
  });
  el.jumpPanel.addEventListener('click', (e) => e.stopPropagation());

  // ---- 맨 아래로 ----
  el.toBottom.addEventListener('click', () => scrollDown(true));
  el.messages.addEventListener(
    'scroll',
    () => {
      followBottom = atBottom();
      updateToBottom();
    },
    { passive: true },
  );

  el.sendBtn.addEventListener('click', () => void doSend());
  el.stopBtn.addEventListener('click', () => {
    if (currentConv) void pb.stop(currentConv.id);
  });
  el.thinkToggle.addEventListener('click', toggleThinking);
  el.stallStop.addEventListener('click', () => {
    if (currentConv) void pb.stop(currentConv.id);
  });
  el.stallWait.addEventListener('click', () => {
    const r = activeRt();
    if (r) r.work.snooseUntil = Date.now() + 120000; // 2분 동안 다시 알리지 않는다
    el.workStall.classList.add('hidden');
  });
  el.workToggle.addEventListener('click', () => {
    const r = activeRt();
    if (!r) return;
    r.work.collapsed = !r.work.collapsed;
    renderWork();
  });
  el.newChat.addEventListener('click', startFresh);
  bindConn();
  el.folderBtn.addEventListener('click', () => void pb.openWorkDir());

  // HTML 패널 열기/닫기
  el.panelBtn.addEventListener('click', () => setPanelOpen(!panelOpen));

  // 도구 지침 모달
  for (const b of document.querySelectorAll('.theme-btn')) {
    b.addEventListener('click', async () => {
      applyTheme(b.dataset.theme);
      await pb.setTheme(b.dataset.theme);
    });
  }
  // auto 일 때 OS 테마가 바뀌면 따라간다.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themePref === 'auto') applyTheme('auto');
  });
  pb.onThemeChanged(() => {
    if (themePref === 'auto') applyTheme('auto');
  });

  el.guideBtn.addEventListener('click', () => void openGuide('rules'));
  el.versionLabel.addEventListener('click', () => void openGuide('patch'));
  el.guideClose.addEventListener('click', () => el.guideModal.classList.add('hidden'));
  el.guideModal.addEventListener('click', (e) => {
    if (e.target === el.guideModal) el.guideModal.classList.add('hidden');
  });
  for (const b of document.querySelectorAll('.tab-btn')) {
    b.addEventListener('click', () => void openGuide(b.dataset.guide));
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    el.guideModal.classList.add('hidden');
    el.usageModal.classList.add('hidden');
    el.connModal.classList.add('hidden');
    el.cmdMenu.classList.add('hidden');
    if (!el.jumpPanel.classList.contains('hidden')) toggleJump();
    if (findOpen()) closeFind();
    closeTabMenu();
  });

  el.modelSelect.addEventListener('change', () => {
    localStorage.setItem(MODEL_KEY, el.modelSelect.value);
    void pb.setModel(el.modelSelect.value);
  });

  el.permSelect.addEventListener('change', () => {
    void pb.setPermissionMode(el.permSelect.value);
  });

  // 사용량
  el.usageBtn.addEventListener('click', async () => {
    el.usageModal.classList.remove('hidden');
    await refreshUsage();
  });
  el.usageClose.addEventListener('click', () => el.usageModal.classList.add('hidden'));
  el.usageModal.addEventListener('click', (e) => {
    if (e.target === el.usageModal) el.usageModal.classList.add('hidden');
  });
  el.usageReset.addEventListener('click', async () => {
    if (!(await confirmDialog('누적 사용량 기록을 지우시겠어요?'))) return;
    await pb.resetUsage();
    await refreshUsage();
  });

  // 권한 확인
  el.permAllow.addEventListener('click', () => replyPerm('allow'));
  el.permAlways.addEventListener('click', () => replyPerm('always'));
  el.permDeny.addEventListener('click', () => replyPerm('deny'));
  el.permAllowAll.addEventListener('click', () => {
    while (permQueue.length) {
      const p = permQueue.shift();
      void pb.permissionReply({ id: p.id, decision: 'allow' });
    }
    showNextPerm();
  });
  pb.onUpdateAvailable(({ version }) => showUpdateBar(version));
  el.updateGo.addEventListener('click', () => void doUpdateDownload());
  el.updateLater.addEventListener('click', () => el.updateBar.classList.add('hidden'));
  pb.onAutoAllowed(({ title, summary }) => {
    showToast(`✓ 자동 허용 — ${title}: ${summary}`);
  });
  pb.onPermissionAsk((p) => {
    permQueue.push(p);
    if (permQueue.length === 1) showNextPerm();
  });
  pb.onPermissionClose(({ id }) => {
    permQueue = permQueue.filter((x) => x.id !== id);
    showNextPerm();
  });

  // 첨부
  el.attachBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.attachMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    el.attachMenu.classList.add('hidden');
    el.skillMenu.classList.add('hidden');
    if (!el.jumpPanel.classList.contains('hidden')) toggleJump();
    closeTabMenu();
  });
  window.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.hist-item')) closeTabMenu();
  });
  el.attachMenu.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    el.attachMenu.classList.add('hidden');
    const got = act === 'file' ? await pb.pickFiles() : [await pb.pickFolder()];
    attachments.push(...got.filter(Boolean));
    renderAttachments();
  });

  // 이미지 붙여넣기 (Cmd/Ctrl+V)
  window.addEventListener('paste', async (e) => {
    const items = [...(e.clipboardData?.items || [])].filter((it) => it.type.startsWith('image/'));
    if (!items.length) return;
    e.preventDefault();
    for (const it of items) {
      const file = it.getAsFile();
      if (!file) continue;
      const dataUrl = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(file);
      });
      const saved = await pb.savePastedImage({ dataUrl, ext: (it.type.split('/')[1] || 'png').replace('jpeg', 'jpg') });
      if (saved) attachments.push(saved);
    }
    renderAttachments();
  });

  const stopEv = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  el.composer.addEventListener('dragover', (e) => {
    stopEv(e);
    el.composer.classList.add('drop');
  });
  el.composer.addEventListener('dragleave', () => el.composer.classList.remove('drop'));
  el.composer.addEventListener('drop', async (e) => {
    stopEv(e);
    el.composer.classList.remove('drop');
    const paths = [...e.dataTransfer.files].map((f) => pb.getPathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    attachments.push(...(await pb.describePaths(paths)));
    renderAttachments();
  });

  // 스킬
  el.skillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.skillMenu.classList.toggle('hidden');
  });
  el.skillMenu.addEventListener('click', async (e) => {
    // ℹ = 스킬 상세 보기 (실행 아님)
    const info = e.target.closest('.skill-info');
    if (info) {
      e.stopPropagation();
      el.skillMenu.classList.add('hidden');
      el.guideModal.classList.remove('hidden');
      el.guideBody.innerHTML = '<p>불러오는 중…</p>';
      for (const b of document.querySelectorAll('.tab-btn')) b.classList.remove('active');
      el.guideFoot.textContent = '이 스킬이 무엇을 하고 어떤 절차로 움직이는지에 대한 내장 지침입니다.';
      const text = await pb.readSkill(info.dataset.info);
      el.guideBody.innerHTML = renderMd(text);
      el.guideBody.scrollTop = 0;
      return;
    }
    const item = e.target.closest('.attach-menu-item');
    if (!item) return;
    el.skillMenu.classList.add('hidden');
    void runSkill(item.dataset.skill);
  });

  // 작업 폴더 바꾸기
  el.folderChangeBtn.addEventListener('click', async () => {
    if (!(await confirmDialog('다른 작업 폴더로 바꿀까요? 지금 대화는 그대로 남습니다.'))) return;
    const r = await pb.chooseFolder();
    if (r?.status === 'cancelled') return;
    await applyInit(r);
  });

  // 오류 바
  el.errClear.addEventListener('click', () => {
    void pb.previewClearErrors();
    clearPreviewErrors();
  });
  el.pvErrBadge.addEventListener('click', () => el.input.focus());

  // 미리보기
  el.pvFile.addEventListener('change', () => {
    const v = el.pvFile.value;
    if (!v) {
      autoPickNew = false; // 사용자가 직접 끈 것이므로 자동으로 되살리지 않는다
      turnPreviewOff('미리보기를 끈 상태입니다.\n위에서 파일을 고르면 표시됩니다.', true);
      return;
    }
    localStorage.removeItem(PREVIEW_OFF_KEY);
    void openPreview(v);
  });
  el.pvDevice.addEventListener('change', () => {
    localStorage.setItem(DEVICE_KEY, el.pvDevice.value);
    syncBounds();
  });
  el.pvReveal.addEventListener('click', () => {
    if (el.pvFile.value) void pb.previewReveal(el.pvFile.value);
  });
  el.pvReload.addEventListener('click', () => {
    clearPreviewErrors();
    void pb.previewReload();
  });
  el.pvDev.addEventListener('click', () => void pb.previewDevtools());
  el.pvRestart.addEventListener('click', () => {
    el.pvRestart.classList.add('hidden');
    previewOff = false;
    localStorage.removeItem(PREVIEW_OFF_KEY);
    void refreshFiles();
  });

  window.addEventListener('resize', syncBounds);
  new ResizeObserver(syncBounds).observe(el.pvStage);

  // 패널 폭 드래그
  let dragging = false;
  el.dragbar.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(300, Math.min(window.innerWidth - 520, window.innerWidth - e.clientX));
    el.panel.style.flex = `0 0 ${w}px`;
    el.panel.style.width = `${w}px`;
    syncBounds();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    localStorage.setItem(PANEL_KEY, String(parseInt(el.panel.style.width, 10) || 470));
  });

  // 메인 이벤트
  pb.onStatus((m) => setStatus(m));
  pb.onAgentText(({ convId, text }) => {
    const r = rt.get(convId);
    if (!r) return;
    if (!r.buf) addWorkStep(r, 'text', '설명 작성', '');
    r.work.lastAt = Date.now();
    r.buf += text;
    if (r.box) {
      r.box.md.innerHTML = renderMd(r.buf);
      if (isActive(convId)) scrollDown();
    }
  });
  pb.onAgentTool(({ convId, name, input, id }) => {
    const r = rt.get(convId);
    if (r) addToolLine(r, name, input, id);
  });
  pb.onAgentToolDone(({ convId, isError }) => {
    const r = rt.get(convId);
    if (!r) return;
    r.work.lastAt = Date.now();
    markLastDone(r.work, isError);
    if (isActive(convId)) renderWork();
  });
  pb.onAgentThinking(({ convId, text }) => {
    const r = rt.get(convId);
    if (!r || !text) return;
    r.work.lastAt = Date.now();
    r.work.thinking += (r.work.thinking ? '\n\n' : '') + text;
    if (isActive(convId)) renderWork();
  });
  pb.onAgentThinkTokens(({ convId, tokens }) => {
    const r = rt.get(convId);
    if (!r) return;
    r.work.thinkTokens = tokens;
    r.work.lastAt = Date.now();
    if (isActive(convId)) tickWork();
  });
  pb.onAgentStatus(({ convId, status, result, error }) => {
    const r = rt.get(convId);
    if (!r) return;
    r.work.lastAt = Date.now();
    if (status === 'compacting') {
      addWorkStep(r, 'think', '컨텍스트 압축', '지금까지의 대화를 요약하는 중');
    } else if (result) {
      markLastDone(r.work, result !== 'success');
      if (result === 'success') showToast('컨텍스트를 정리했습니다');
      else showToast('압축하지 못했습니다 — ' + cmdMsg(error || '이유 불명'), null, 'warn');
      void refreshCtx();
    }
    if (isActive(convId)) renderWork();
  });
  pb.onAgentToolProgress(({ convId, id, sec }) => {
    const r = rt.get(convId);
    if (!r) return;
    r.work.lastAt = Date.now();
    const st = r.work.steps.find((x) => x.id && x.id === id);
    if (st) {
      st.sec = sec;
      st.fixedSec = true;
    }
    if (isActive(convId)) tickWork();
  });
  pb.onFilesChanged(() => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      htmlFiles = await pb.listHtml();
      // 새로 생긴 HTML 파일(시뮬레이터·리포트)은 패널을 자동으로 열어 보여 준다.
      const fresh = htmlFiles.find((f) => !knownFiles.has(f.rel));
      for (const f of htmlFiles) knownFiles.add(f.rel);
      if (fresh) {
        previewOff = false;
        localStorage.removeItem(PREVIEW_OFF_KEY);
        if (!panelOpen) setPanelOpen(true);
        renderFileList(fresh.rel);
        el.pvFile.value = fresh.rel;
        void openPreview(fresh.rel);
        return;
      }
      const had = el.pvFile.value;
      renderFileList(had);
      if (had && htmlFiles.some((f) => f.rel === had)) {
        clearPreviewErrors();
        void pb.previewReload();
      }
    }, 300);
  });
  pb.onPreviewError(({ count, last }) => {
    previewErrCount = count || 0;
    previewErrLast = last;
    renderErrors();
  });
  pb.onPreviewStopped(({ file }) => {
    // 오류 폭주로 메인이 미리보기를 멈춤
    previewOff = true;
    autoPickNew = false;
    el.pvFile.value = '';
    setPvEmpty(
      `오류가 계속 발생해 미리보기를 멈췄습니다.\n(${file ?? ''})\n` +
        `HTML 파일의 반복 오류를 고친 뒤 다시 시작하세요.`,
    );
    el.pvRestart.classList.remove('hidden');
  });
  pb.onExternalPage(({ url }) => {
    externalPage = url;
    el.pvFile.value = '';
    el.pvEmpty.classList.add('hidden');
    if (!panelOpen) setPanelOpen(true);
    if (el.pvDevice.value !== 'fit') el.pvDevice.value = 'fit';
    syncBounds();
    el.pvFoot.textContent = url;
  });
  pb.onMeterEvent((ev) => {
    if (ev.kind === 'soft') showToast(`⚠ ${ev.service} API 오늘 사용량이 80%를 넘었습니다 (${ev.used}/${ev.limit})`, null, 'warn');
    else if (ev.kind === '429') showToast(`⏸ ${ev.service} API 한도 초과 — ${ev.pausedSec}초 일시정지`, null, 'warn');
  });
  pb.onAuthProgress((m) => {
    el.acctLabel.textContent = m;
  });
}

async function main() {
  bind();
  loadConvs();
  renderHistory();

  const savedModel = localStorage.getItem(MODEL_KEY);
  const hasOption = savedModel && [...el.modelSelect.options].some((o) => o.value === savedModel);
  if (hasOption) el.modelSelect.value = savedModel;
  else localStorage.removeItem(MODEL_KEY);
  void pb.setModel(el.modelSelect.value);

  if (localStorage.getItem(PREVIEW_OFF_KEY) === '1') previewOff = true;

  const savedDevice = localStorage.getItem(DEVICE_KEY);
  if (savedDevice) el.pvDevice.value = savedDevice;

  const savedPanel = parseInt(localStorage.getItem(PANEL_KEY) || '', 10);
  if (savedPanel > 300) {
    el.panel.style.flex = `0 0 ${savedPanel}px`;
    el.panel.style.width = `${savedPanel}px`;
  }

  const t = await pb.getTheme();
  applyTheme(t?.theme || 'auto');

  setPanelOpen(false);
  setInterval(tickWork, 500);
  updateSendBtn();
  void refreshAuth();
  void refreshUsage();
  // 한도는 자주 바뀌지 않으므로 3분마다만 갱신한다.
  setInterval(() => void refreshUsage(), 180000);
  pb.getVersions().then((v) => {
    el.versionLabel.textContent = `v${v.app} · 엔진 ${v.engine} · Electron ${v.electron}`;
  });

  await applyInit(await pb.init());
}

main().catch((e) => {
  // 초기화 실패를 조용히 삼키지 않는다.
  window.__pbInitError = String(e && (e.stack || e.message || e));
  console.error('초기화 실패', e);
  setStatus('초기화 오류', 'err');
});
