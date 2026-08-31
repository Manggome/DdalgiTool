import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  dialog,
  shell,
  screen,
  Notification,
  nativeTheme,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { loadConfig, saveConfig, flog, isUsableDir, LOG_FILE } from './config.mjs';
import {
  WarmSession,
  getContextUsage,
  getAccountUsage,
  setToolContext,
  setWriteApproval,
} from './agent.mjs';
import { PreviewServer } from './preview-server.mjs';
import { setMeterListener, meterStats } from './metering.mjs';
import { loadProject, saveProjectLinks } from './project.mjs';
import { syncIndex, indexStatus } from './indexer.mjs';
import { routeRequest, routerHint } from './router.mjs';
import {
  importClientSecret,
  hasGoogleClient,
  googleLogin,
  googleLogout,
  googleConnected,
  googleWhoAmI,
} from './connectors/google-auth.mjs';
import { slackConnect, slackDisconnect, slackStatus, slackChannels } from './connectors/slack.mjs';
import { trelloConnect, trelloDisconnect, trelloStatus, trelloBoards } from './connectors/trello.mjs';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const preview = new PreviewServer();

/**
 * 대화(탭)별 세션. 탭을 바꿔도 진행 중인 작업이 죽지 않게 각자 스트림을 가진다.
 * id -> { warm, sessionId, busy }
 */
const convs = new Map();

function conv(id) {
  let c = convs.get(id);
  if (!c) {
    c = { warm: new WarmSession(), sessionId: undefined, busy: false };
    convs.set(id, c);
  }
  return c;
}

/** 활성 대화(사용량·컨텍스트 조회에 쓴다). */
let activeConvId = null;

/** 앱에 내장된 도구 지침 폴더. */
const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
/** 앱에 내장된 스킬(기획서·테이블·밸런스·탐색·QA·아카이빙) 폴더. */
const SKILLS_DIR = path.join(__dirname, 'skills');

let win = null;
let previewView = null;
let workDir = null;
let currentModel = 'claude-sonnet-5';
// 권한 모드는 메인이 소유하고 설정 파일에 저장한다. PB_PERMISSION_MODE 로 덮어쓸 수 있다(개발용).
let permissionMode =
  process.env.PB_PERMISSION_MODE || loadConfig()?.permissionMode || 'bypassPermissions';
let lastRateLimit = null;
/** 이번 실행 동안의 사용량 합계. 전체 누적은 설정 파일에 쌓는다. */
const runUsage = { turns: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, thinking: 0, costUsd: 0 };
/** 권한 확인 대기 목록 (canUseTool → 렌더러 → 응답). */
const pendingPerms = new Map();
let permSeq = 0;
let watcher = null;
let currentPreviewFile = null;
const previewErrors = [];

process.on('uncaughtException', (e) => flog('uncaughtException: ' + (e?.stack || e)));
process.on('unhandledRejection', (e) => flog('unhandledRejection: ' + String(e)));

const send = (ch, payload) => win?.webContents.send(ch, payload);
const sendStatus = (m) => send('pb:status', m);

// ---- 창 ----

function createWindow() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1500, wa.width),
    height: Math.min(940, wa.height - 40),
    minWidth: 900,
    minHeight: 600,
    center: true,
    title: '딸각기획',
    backgroundColor: THEME_BG[resolvedTheme()] || THEME_BG.navy,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on('did-fail-load', (_e, code, desc) => flog(`did-fail-load: ${code} ${desc}`));
  if (process.env.PB_DEV_RENDERER_LOG) {
    win.webContents.on('console-message', (...a) => {
      const f = a[0];
      const msg = f && typeof f === 'object' && f.message ? `${f.level}: ${f.message}` : `${a[1]}: ${a[2]}`;
      flog('renderer ' + String(msg).slice(0, 300));
    });
  }
  win.webContents.on('render-process-gone', (_e, d) => flog('render-process-gone: ' + JSON.stringify(d)));
  win.on('closed', () => {
    win = null;
    previewView = null;
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html')).then(
    () => flog('loadFile 성공'),
    (e) => flog('loadFile 실패: ' + String(e)),
  );
}

app.whenReady().then(
  () => {
    flog('=== app ready ===');
    // dev 실행(npx electron .)에서는 번들 아이콘이 없어 Dock 에 Electron 기본이 뜬다 — 직접 지정.
    if (process.platform === 'darwin' && !app.isPackaged) {
      try {
        app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
      } catch {
        /* noop */
      }
    }
    createWindow();
  },
  (e) => flog('whenReady 실패: ' + String(e)),
);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  preview.close();
  watcher?.close();
  app.quit();
});

// ---- 미리보기 패널 ----

function ensurePreviewView() {
  if (previewView || !win) return previewView;

  previewView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 프로토타입은 http://127.0.0.1 로 서비스하므로 웹 보안을 끌 필요가 없다.
      webSecurity: true,
    },
  });
  win.contentView.addChildView(previewView);
  previewView.setBackgroundColor(resolvedTheme() === 'light' ? '#ffffff' : '#000000');
  previewView.setVisible(false);

  const wc = previewView.webContents;
  // 프로토타입 안의 링크는 기본 브라우저로 보낸다(미리보기 패널을 벗어나지 않게).
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 프로토타입의 런타임 오류는 콘솔 메시지로 받는다.
  wc.on('console-message', (...args) => {
    let message;
    let where = '';
    const first = args[0];
    if (first && typeof first === 'object' && typeof first.level === 'string') {
      // Electron 35+ : 이벤트 객체 하나로 전달된다.
      if (first.level !== 'error') return;
      message = first.message;
      where = first.sourceId ? ` (${String(first.sourceId).split('/').pop()}:${first.lineNumber})` : '';
    } else {
      const [, level, msg, line, sourceId] = args;
      if (level < 3) return; // 0~3 = verbose·info·warning·error
      message = msg;
      where = sourceId ? ` (${String(sourceId).split('/').pop()}:${line})` : '';
    }
    pushPreviewError({ kind: 'console', message: `${message}${where}` });
  });
  wc.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return; // 사용자 취소
    pushPreviewError({ kind: 'load', message: `로드 실패 ${code} ${desc} — ${url}` });
  });
  wc.on('render-process-gone', (_e, d) => {
    pushPreviewError({ kind: 'crash', message: `미리보기 프로세스 종료: ${d.reason}` });
  });
  return previewView;
}

/**
 * 에이전트가 스스로 점검할 수 있도록 미리보기 오류를 작업 폴더의 로그 파일에도 쓴다.
 * 점(.)으로 시작하므로 파일 감시에서 걸러진다.
 */
const ERROR_LOG_NAME = '.pb-preview-errors.log';

/**
 * 미리보기 오류는 폭주할 수 있다 (매 프레임 던지는 프로토타입이면 초당 60회 이상).
 * 오류마다 동기 쓰기·IPC 를 하면 메인 프로세스가 에이전트 스트림을 읽지 못해
 * 작업이 멈춘 것처럼 보인다. 그래서 합치고, 초당 상한을 두고, 비동기로 쓴다.
 */
const errAgg = { flushTimer: null, burstStart: 0, burst: 0, stopped: false };
let previewStopped = false;

/** 테마: auto | navy | dark | light. auto 는 OS 설정을 따른다. */
let theme = loadConfig()?.theme || 'auto';

const THEME_BG = { navy: '#0f1117', dark: '#0d0d0d', light: '#ffffff' };

function resolvedTheme() {
  if (theme !== 'auto') return theme;
  return nativeTheme.shouldUseDarkColors ? 'navy' : 'light';
}

/** 네이티브로 칠해지는 부분(창 배경·미리보기 배경)을 테마에 맞춘다. */
function applyNativeTheme() {
  const bg = THEME_BG[resolvedTheme()] || THEME_BG.navy;
  try {
    win?.setBackgroundColor(bg);
    previewView?.setBackgroundColor(resolvedTheme() === 'light' ? '#ffffff' : '#000000');
  } catch {
    /* noop */
  }
}

function writePreviewErrorLog() {
  if (!workDir) return;
  const body = previewErrors.length
    ? previewErrors
        .map(
          (e) =>
            `[${e.at}] ${e.kind} ${e.file ?? ''} — ${e.message}` + (e.count > 1 ? ` (${e.count}회 반복)` : ''),
        )
        .join('\n') + '\n'
    : '';
  // 비동기 쓰기. 실패는 무시한다.
  fs.writeFile(path.join(workDir, ERROR_LOG_NAME), body, 'utf-8', () => {});
}

function flushPreviewErrors() {
  writePreviewErrorLog();
  send('pb:previewError', {
    count: previewErrors.reduce((n, e) => n + (e.count || 1), 0),
    kinds: previewErrors.length,
    last: previewErrors[previewErrors.length - 1] ?? null,
  });
}

/** 오류가 폭주하면 미리보기를 멈춘다. 에이전트가 읽을 로그에도 이유를 남긴다. */
function stopRunawayPreview() {
  errAgg.stopped = true;
  previewStopped = true;
  previewErrors.push({
    kind: 'runaway',
    message:
      `오류가 5초에 100회를 넘어 미리보기를 자동으로 멈췄습니다. ` +
      `루프 안에서 오류가 반복되는지 확인하세요. (${currentPreviewFile ?? '?'})`,
    file: currentPreviewFile,
    at: new Date().toISOString(),
    count: 1,
  });
  writePreviewErrorLog();
  try {
    previewView?.webContents.loadURL('about:blank');
    previewView?.setVisible(false);
  } catch {
    /* noop */
  }
  flog('미리보기 자동 정지 (오류 폭주): ' + currentPreviewFile);
  send('pb:previewStopped', { file: currentPreviewFile, reason: 'runaway' });
}

function pushPreviewError(err) {
  if (errAgg.stopped) return;
  const now = Date.now();

  // 같은 오류가 반복되면 줄을 늘리지 않고 횟수만 센다.
  const last = previewErrors[previewErrors.length - 1];
  if (last && last.kind === err.kind && last.message === err.message) {
    last.count = (last.count || 1) + 1;
  } else {
    previewErrors.push({ ...err, file: currentPreviewFile, at: new Date().toISOString(), count: 1 });
    if (previewErrors.length > 50) previewErrors.shift();
  }

  // 폭주 감지 (5초 창)
  if (now - errAgg.burstStart > 5000) {
    errAgg.burstStart = now;
    errAgg.burst = 0;
  }
  errAgg.burst += 1;
  if (errAgg.burst > 100) {
    stopRunawayPreview();
    return;
  }

  // 초당 4회까지만 파일·화면에 반영한다.
  if (!errAgg.flushTimer) {
    errAgg.flushTimer = setTimeout(() => {
      errAgg.flushTimer = null;
      flushPreviewErrors();
    }, 250);
  }
}

function resetPreviewErrors() {
  previewErrors.length = 0;
  errAgg.burst = 0;
  errAgg.burstStart = 0;
  errAgg.stopped = false;
  previewStopped = false;
  writePreviewErrorLog();
}

ipcMain.handle('pb:preview:bounds', (_e, r) => {
  const v = previewView;
  if (!v) return;
  if (!r || r.width <= 0 || r.height <= 0) {
    v.setVisible(false);
    return;
  }
  v.setBounds({
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  });
  // 기기 해상도를 유지한 채 패널 크기에 맞춰 축소해 보여 준다.
  if (r.zoom && r.zoom > 0) v.webContents.setZoomFactor(r.zoom);
  v.setVisible(true);
});

ipcMain.handle('pb:preview:open', async (_e, relPath) => {
  if (!workDir) return { ok: false, error: '작업 폴더가 없습니다.' };
  const v = ensurePreviewView();
  if (!v) return { ok: false, error: '창이 없습니다.' };
  currentPreviewFile = relPath;
  resetPreviewErrors();
  const url = preview.urlFor(relPath);
  try {
    await v.webContents.loadURL(url);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('pb:preview:reload', () => {
  resetPreviewErrors();
  previewView?.webContents.reload();
});

ipcMain.handle('pb:preview:devtools', () => {
  previewView?.webContents.openDevTools({ mode: 'detach' });
});

ipcMain.handle('pb:preview:hide', () => {
  previewView?.setVisible(false);
});

/** 미리보기를 완전히 정지한다. 숨기기만 하면 타이머·오류가 계속 돌아간다. */
ipcMain.handle('pb:preview:stop', () => {
  previewStopped = true;
  currentPreviewFile = null;
  try {
    previewView?.setVisible(false);
    previewView?.webContents.loadURL('about:blank');
  } catch {
    /* noop */
  }
  resetPreviewErrors();
});

ipcMain.handle('pb:preview:errors', () => previewErrors.slice());

ipcMain.handle('pb:preview:clearErrors', () => {
  resetPreviewErrors();
});

// ---- 작업 폴더 ----

/** 작업 폴더 안의 HTML 파일 목록(깊이 3까지). */
function listHtml(root) {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__']);
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (depth < 3) walk(abs, r, depth + 1);
      } else if (/\.html?$/i.test(e.name)) {
        let size = 0;
        let mtime = 0;
        try {
          const st = fs.statSync(abs);
          size = st.size;
          mtime = st.mtimeMs;
        } catch {
          /* noop */
        }
        out.push({ rel: r, name: e.name, size, mtime });
      }
    }
  };
  walk(root, '', 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** 파일 변경을 감지해 미리보기를 자동 새로고침한다. */
function startWatch(root) {
  watcher?.close();
  let timer = null;
  try {
    watcher = fs.watch(root, { recursive: true }, (_type, filename) => {
      if (!filename) return;
      const f = String(filename);
      if (f.includes('node_modules') || f.includes('/.git/') || f.startsWith('.git')) return;
      if (path.basename(f).startsWith('.')) return; // 에디터 임시 파일
      clearTimeout(timer);
      timer = setTimeout(() => {
        send('pb:filesChanged', { file: f });
      }, 250);
    });
  } catch (e) {
    flog('watch 실패: ' + e.message);
  }
}

let indexTimer = null;

/** 인덱스 동기화 — 백그라운드에서 돌고, 진행·완료를 화면에 알린다. */
async function runIndexSync(force) {
  if (!workDir) return { ok: false };
  try {
    const r = await syncIndex(workDir, { force, onStatus: (m) => send('pb:indexStatus', { msg: m }) });
    if (!r.skipped) send('pb:indexStatus', { done: true, ...r });
    return r;
  } catch (e) {
    flog('인덱스 동기화 실패: ' + e.message);
    send('pb:indexStatus', { done: true, ok: false, error: e.message });
    return { ok: false, error: e.message };
  }
}

async function useWorkDir(dir) {
  workDir = dir;
  setToolContext({ workDir: dir });
  const prev = loadConfig() ?? {};
  saveConfig({ ...prev, workDir: dir });
  await preview.serve(dir);
  startWatch(dir);
  // 앱을 막지 않게 3초 뒤 백그라운드 동기화 (주기 내면 인덱서가 알아서 건너뛴다)
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => void runIndexSync(false), 3000);
  setInterval(() => void runIndexSync(false), 3600_000).unref?.();
  return { status: 'ready', workDir: dir, htmlFiles: listHtml(dir) };
}

ipcMain.handle('pb:init', async () => {
  try {
    const cfg = loadConfig();
    if (cfg?.workDir && isUsableDir(cfg.workDir)) return await useWorkDir(cfg.workDir);
    return { status: 'need-folder' };
  } catch (e) {
    flog('init 실패: ' + e.message);
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('pb:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '프로젝트 작업 폴더를 선택하세요',
    buttonLabel: '이 폴더 사용',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { status: 'cancelled' };
  try {
    return await useWorkDir(r.filePaths[0]);
  } catch (e) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('pb:listHtml', () => (workDir ? listHtml(workDir) : []));

ipcMain.handle('pb:openWorkDir', () => {
  if (workDir) shell.openPath(workDir);
});

/** 앱에 내장된 도구 지침 원문(모달에 보여 주기 위함). */
ipcMain.handle('pb:readGuide', (_e, which) => {
  // 패치노트는 에이전트가 읽는 문서가 아니라 사용자용이라 knowledge 밖에 둔다.
  const target =
    which === 'patch' ? path.join(__dirname, '패치노트.md') : path.join(KNOWLEDGE_DIR, '도구지침.md');
  try {
    return fs.readFileSync(target, 'utf-8');
  } catch (e) {
    return `문서를 읽을 수 없습니다: ${e.message}`;
  }
});

ipcMain.handle('pb:openLog', () => shell.openPath(LOG_FILE));

// ---- 첨부 ----

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'svg'];

function describePath(p) {
  try {
    const st = fs.statSync(p);
    const name = path.basename(p);
    if (st.isDirectory()) return { path: p, name, kind: 'folder' };
    const ext = path.extname(p).slice(1).toLowerCase();
    const isImg = IMG_EXT.includes(ext);
    let dataUrl;
    if (isImg && st.size < 8 * 1024 * 1024) {
      const mime = ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext;
      dataUrl = `data:image/${mime};base64,${fs.readFileSync(p).toString('base64')}`;
    }
    return { path: p, name, kind: isImg ? 'image' : 'file', dataUrl };
  } catch {
    return null;
  }
}

ipcMain.handle('pb:pickFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '파일 또는 이미지 추가',
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths.map(describePath).filter(Boolean);
});

ipcMain.handle('pb:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: '폴더 추가', properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : describePath(r.filePaths[0]);
});

ipcMain.handle('pb:describePaths', (_e, paths) => (paths || []).map(describePath).filter(Boolean));

/**
 * 붙여넣은 이미지를 파일로 저장한다. 에이전트는 경로로 읽기 때문에 디스크에 있어야 한다.
 * 점으로 시작하는 폴더에 두어 파일 감시와 결과물에서 제외한다.
 */
ipcMain.handle('pb:savePastedImage', (_e, { dataUrl, ext }) => {
  if (!workDir || !dataUrl) return null;
  try {
    const m = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) return null;
    const dir = path.join(workDir, '.pb-paste');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `paste-${stamp}.${ext || (m[1] === 'jpeg' ? 'jpg' : m[1])}`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    return describePath(file);
  } catch (e) {
    flog('붙여넣기 이미지 저장 실패: ' + e.message);
    return null;
  }
});

// ---- 에이전트 ----

ipcMain.handle('pb:setModel', (_e, m) => {
  if (m) currentModel = m;
});

ipcMain.handle('pb:getTheme', () => ({ theme, resolved: resolvedTheme() }));

ipcMain.handle('pb:setTheme', (_e, t) => {
  const ok = ['auto', 'navy', 'dark', 'light'];
  if (!ok.includes(t)) return { theme, resolved: resolvedTheme() };
  theme = t;
  const cfg = loadConfig() ?? {};
  saveConfig({ ...cfg, theme });
  applyNativeTheme();
  return { theme, resolved: resolvedTheme() };
});

// OS 테마가 바뀌면 auto 인 경우에만 따라간다.
nativeTheme.on('updated', () => {
  if (theme !== 'auto') return;
  applyNativeTheme();
  send('pb:themeChanged', { theme, resolved: resolvedTheme() });
});

ipcMain.handle('pb:setPermissionMode', (_e, m) => {
  const ok = ['bypassPermissions', 'acceptEdits', 'default', 'plan'];
  if (ok.includes(m) && m !== permissionMode) {
    permissionMode = m;
    const cfg = loadConfig() ?? {};
    saveConfig({ ...cfg, permissionMode: m });
  }
  return permissionMode;
});

// ---- 권한 확인 (canUseTool) ----

/** 도구 입력을 요약한다. 줄바꿈은 살려서 승인창에서 그대로 읽히게 한다. */
function summarizeToolInput(name, input) {
  if (!input) return '';
  if (input.command) return String(input.command).slice(0, 1200);
  if (input.file_path) return String(input.file_path);
  if (input.pattern) return String(input.pattern).slice(0, 120);
  if (input.url) return String(input.url).slice(0, 200);
  if (input.query) return String(input.query).slice(0, 200);
  try {
    return JSON.stringify(input).slice(0, 300);
  } catch {
    return '';
  }
}

/** 렌더러에 허용/거부를 물어본다. 창이 없으면 거부한다. */
function askPermission(toolName, input, opts) {
  if (!win) return Promise.resolve({ behavior: 'deny', message: '창이 없어 확인할 수 없습니다.' });
  const id = String(++permSeq);
  flog('권한 확인 요청: ' + toolName);  // 어떤 도구에서 확인을 받았는지 남긴다
  const payload = {
    id,
    tool: toolName,
    title: opts?.title || '',
    displayName: opts?.displayName || toolName,
    description: opts?.description || '',
    reason: opts?.decisionReason || '',
    summary: summarizeToolInput(toolName, input),
    writeKey: opts?.writeKey || '',
  };
  return new Promise((resolve) => {
    pendingPerms.set(id, { resolve, suggestions: opts?.suggestions, writeKey: opts?.writeKey });
    send('pb:permissionAsk', payload);
    // 사용자가 턴을 중지하면 대기 중인 확인도 정리한다.
    opts?.signal?.addEventListener('abort', () => {
      if (pendingPerms.delete(id)) {
        send('pb:permissionClose', { id });
        resolve({ behavior: 'deny', message: '사용자가 작업을 중지했습니다.' });
      }
    });
  });
}

/** 에이전트의 open_page — 오른쪽 패널(WebContentsView)에 외부 페이지를 띄운다. 실패하면 기본 브라우저. */
async function openExternalPage(url, where) {
  if (where === 'browser') {
    shell.openExternal(url);
    return { where: 'browser' };
  }
  try {
    const v = ensurePreviewView();
    if (!v) throw new Error('창 없음');
    currentPreviewFile = null;
    resetPreviewErrors();
    await v.webContents.loadURL(url);
    send('pb:externalPage', { url });
    return { where: 'panel' };
  } catch (e) {
    flog('패널 페이지 열기 실패, 브라우저로 폴백: ' + e.message);
    shell.openExternal(url);
    return { where: 'browser' };
  }
}
setToolContext({ openPage: openExternalPage });

// 외부 서비스 쓰기(시트/슬랙/트렐로)는 권한 모드와 무관하게 항상 이 창으로 승인을 받는다.
setWriteApproval(async (title, summary) => {
  // 개발·자동 테스트 전용: 승인 창 없이 허용 (배포 빌드에서는 환경변수가 없다).
  if (process.env.PB_DEV_AUTO_APPROVE) {
    flog('DEV 자동 승인: ' + title);
    return true;
  }
  // 사용자가 [이 도구는 항상 허용] 으로 저장한 종류는 묻지 않고 토스트로만 알린다.
  if (loadConfig()?.writeAllow?.[title]) {
    flog('자동 허용(항상 허용 저장됨): ' + title);
    send('pb:autoAllowed', { title, summary: String(summary).slice(0, 160) });
    return true;
  }
  const r = await askPermission(
    'ExternalWrite',
    { command: summary },
    {
      title,
      displayName: '외부 서비스에 쓰기',
      description: '외부 서비스(구글/슬랙/트렐로)에 실제로 기록됩니다. [항상 허용]을 누르면 이 종류는 다시 묻지 않습니다 (연동 설정에서 해제 가능).',
      writeKey: title,
    },
  );
  return r?.behavior === 'allow';
});

// 사용량 가드 경고(80% 도달·429 일시정지)를 화면 토스트로.
setMeterListener((ev) => send('pb:meterEvent', ev));

// ---- 연동 설정 (자격증명·프로젝트 연결) ----

ipcMain.handle('conn:status', async () => {
  const out = {
    google: { hasClient: hasGoogleClient(), connected: googleConnected() },
    slack: slackStatus(),
    trello: trelloStatus(),
    project: workDir ? (loadProject(workDir) ?? null) : null,
    index: workDir ? indexStatus(workDir) : null,
    workDir,
  };
  return out;
});

ipcMain.handle('conn:googleImportSecret', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '구글 OAuth 클라이언트 JSON 선택 (client_secret_….json)',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
  try {
    importClientSecret(fs.readFileSync(r.filePaths[0], 'utf-8'));
    flog('구글 클라이언트 JSON 등록됨');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('conn:googleLogin', async () => {
  try {
    await googleLogin((url) => shell.openExternal(url));
    const who = await googleWhoAmI();
    flog('구글 로그인 완료');
    return { ok: true, ...who };
  } catch (e) {
    flog('구글 로그인 실패: ' + e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('conn:googleWho', async () => {
  try {
    return { ok: true, ...(await googleWhoAmI()) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('conn:slackSet', async (_e, token) => {
  try {
    const d = await slackConnect(String(token || '').trim());
    flog('슬랙 연결됨: ' + d.team);
    return { ok: true, ...d };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('conn:trelloSet', async (_e, { key, token }) => {
  try {
    const d = await trelloConnect(String(key || '').trim(), String(token || '').trim());
    flog('트렐로 연결됨: ' + d.username);
    return { ok: true, ...d };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('conn:disconnect', (_e, service) => {
  if (service === 'google') googleLogout();
  else if (service === 'slack') slackDisconnect();
  else if (service === 'trello') trelloDisconnect();
  return { ok: true };
});

ipcMain.handle('conn:slackChannels', async () => {
  try {
    return { ok: true, channels: await slackChannels() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('conn:trelloBoards', async () => {
  try {
    return { ok: true, boards: await trelloBoards() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('conn:pickUnityDir', async () => {
  const r = await dialog.showOpenDialog(win, { title: '유니티 프로젝트 폴더 선택', properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});

ipcMain.handle('conn:projectSave', (_e, links) => {
  if (!workDir) return { ok: false, error: '작업 폴더가 없습니다.' };
  try {
    const saved = saveProjectLinks(workDir, links);
    flog('project.yaml 저장됨');
    return { ok: true, project: saved };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('conn:syncIndex', () => runIndexSync(true));

ipcMain.handle('conn:writeAllow', (_e, action, key) => {
  const cfg = loadConfig() ?? {};
  const cur = { ...(cfg.writeAllow ?? {}) };
  if (action === 'clear') {
    if (key) delete cur[key];
    else for (const k of Object.keys(cur)) delete cur[k];
    saveConfig({ ...cfg, writeAllow: cur });
  }
  return Object.keys(cur);
});

ipcMain.handle('conn:meter', () => meterStats());

ipcMain.handle('pb:permissionReply', (_e, { id, decision }) => {
  const p = pendingPerms.get(id);
  if (!p) return;
  pendingPerms.delete(id);
  if (decision === 'allow') {
    p.resolve({ behavior: 'allow' });
  } else if (decision === 'always') {
    // 외부 쓰기 종류면 설정에 저장 — 이후 자동 허용(토스트 알림), 연동 설정에서 해제 가능.
    if (p.writeKey) {
      const cfg = loadConfig() ?? {};
      saveConfig({ ...cfg, writeAllow: { ...(cfg.writeAllow ?? {}), [p.writeKey]: true } });
      flog('항상 허용 저장: ' + p.writeKey);
    }
    p.resolve({ behavior: 'allow', ...(p.suggestions ? { updatedPermissions: p.suggestions } : {}) });
  } else {
    p.resolve({ behavior: 'deny', message: '사용자가 이 작업을 거부했습니다.' });
  }
});

// ---- 사용량 집계 ----

/** 한 턴의 usage 를 이번 실행 합계와 전체 누적에 더한다. */
function addUsage(u, costUsd) {
  if (!u) return;
  const add = {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    thinking: u.output_tokens_details?.thinking_tokens || 0,
    costUsd: costUsd || 0,
  };
  runUsage.turns += 1;
  for (const k of Object.keys(add)) runUsage[k] += add[k];

  const cfg = loadConfig() ?? {};
  const all = cfg.usage ?? { turns: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, thinking: 0, costUsd: 0 };
  all.turns += 1;
  for (const k of Object.keys(add)) all[k] = (all[k] || 0) + add[k];
  saveConfig({ ...cfg, usage: all });
}

/** 계정(플랜) 사용 한도. 5시간·주간 창과 크레딧 소진율. */
ipcMain.handle('pb:accountUsage', async () => {
  if (!workDir) return null;
  try {
    const live = [...convs.values()].find((c) => c.warm.hasLive());
    if (live) {
      const u = await live.warm.accountUsage();
      if (u) return u;
    }
    return await getAccountUsage(workDir, currentModel);
  } catch {
    return null;
  }
});

ipcMain.handle('pb:usage', () => {
  const cfg = loadConfig() ?? {};
  return { run: { ...runUsage }, allTime: cfg.usage ?? null, rateLimit: lastRateLimit, permissionMode };
});

ipcMain.handle('pb:resetUsage', () => {
  const cfg = loadConfig() ?? {};
  saveConfig({ ...cfg, usage: null });
  for (const k of Object.keys(runUsage)) runUsage[k] = 0;
  return { ok: true };
});

/** 대화를 새로 시작한다(그 대화의 세션만 끊는다). */
ipcMain.handle('pb:newSession', (_e, convId) => {
  const c = convs.get(convId);
  if (c) {
    void c.warm.reset();
    convs.delete(convId);
  }
});

/** 화면에 보이는 대화를 알려 준다. 다른 대화의 작업은 그대로 둔다. */
ipcMain.handle('pb:setActiveConv', (_e, convId) => {
  activeConvId = convId || null;
});

/** 이어 하기용으로 기존 Claude 세션 id 를 붙인다. */
ipcMain.handle('pb:attachSession', (_e, { convId, sessionId }) => {
  if (!convId) return;
  const c = conv(convId);
  if (sessionId && sessionId !== c.sessionId) c.sessionId = sessionId;
});

/** 지금 작업 중인 대화 id 목록. */
ipcMain.handle('pb:busyConvs', () => [...convs.entries()].filter(([, c]) => c.busy).map(([id]) => id));

/**
 * 아카이빙(M5) — 모든 턴을 작업 폴더의 archive/logs/ 에 jsonl 로 자동 기록한다.
 * 로컬 기록이라 승인이 필요 없고, 인덱서가 카탈로그에 포함해 "예전에 뭐 했지?" 질문에 쓴다.
 */
function appendTurnLog(entry) {
  if (!workDir) return;
  try {
    const dir = path.join(workDir, loadProject(workDir)?.archive?.path ?? 'archive', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, new Date().toISOString().slice(0, 10) + '.jsonl');
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    flog('턴 로그 기록 실패: ' + e.message);
  }
}

/** 한 턴 실행. 대화별로 독립이라 탭을 바꿔도 계속 돈다. */
async function runAsk(convId, prompt, attachments, opts) {
  if (!workDir) return { status: 'error', message: '작업 폴더가 아직 준비되지 않았습니다.' };
  const c = conv(convId);

  let fullPrompt = prompt;
  // 내장 문서·스킬 폴더는 작업 폴더 밖이므로 항상 접근 권한을 열어 준다.
  const extraDirs = [KNOWLEDGE_DIR, SKILLS_DIR];
  // 유니티 프로젝트(코드·깃)도 읽을 수 있게 연다.
  const unityPath = loadProject(workDir)?.unity?.project_path;
  if (unityPath && isUsableDir(unityPath)) extraDirs.push(unityPath);

  if (attachments?.length) {
    const lines = attachments.map((a) => {
      extraDirs.push(a.kind === 'folder' ? a.path : path.dirname(a.path));
      const label = a.kind === 'folder' ? '폴더' : a.kind === 'image' ? '이미지' : '파일';
      return `- (${label}) ${a.path}`;
    });
    fullPrompt += `\n\n[첨부]\n${lines.join('\n')}\n첨부된 파일·이미지는 Read 도구로 열어 내용을 확인하고, 폴더는 내부를 탐색(Glob/Grep/Read)해서 작업에 활용하세요.`;
  }

  if (opts?.includeErrors && previewErrors.length) {
    const lines = previewErrors.slice(-15).map((e) => `- [${e.kind}] ${e.message}`);
    fullPrompt += `\n\n[미리보기 오류] 현재 열린 파일: ${currentPreviewFile ?? '?'}\n${lines.join('\n')}\n이 오류의 원인을 찾아 고치세요.`;
  }

  const ev = (ch, payload) => send(ch, { convId, ...payload });
  const startedAt = Date.now();
  c.busy = true;

  // 소프트 라우터 — Haiku 가 카탈로그를 보고 소스·스킬 힌트를 앞에 붙인다 (실패 시 그냥 진행)
  if (!String(prompt).startsWith('/') && loadConfig()?.router !== false) {
    const route = await routeRequest(workDir, prompt);
    const hint = routerHint(route);
    if (hint) fullPrompt = hint + fullPrompt;
  }
  flog(
    `턴 시작 (conv=${convId}, model=${currentModel}, mode=${permissionMode}) ` +
      `프롬프트: ${String(prompt).replace(/\s+/g, ' ').slice(0, 50)}`,
  );
  try {
    const res = await c.warm.ask({
      workDir,
      knowledgeDir: KNOWLEDGE_DIR,
      skillsDir: SKILLS_DIR,
      prompt: fullPrompt,
      sessionId: c.sessionId,
      model: currentModel,
      permissionMode,
      canUseTool: permissionMode === 'bypassPermissions' ? undefined : askPermission,
      additionalDirectories: [...new Set(extraDirs)],
      onText: (t) => ev('pb:agentText', { text: t }),
      onToolUse: (name, input, id) => ev('pb:agentTool', { name, input, id }),
      onToolDone: (isError) => ev('pb:agentToolDone', { isError }),
      onThinking: (text) => ev('pb:agentThinking', { text }),
      onThinkingTokens: (tokens) => ev('pb:agentThinkTokens', { tokens }),
      onToolProgress: (id, name, sec) => ev('pb:agentToolProgress', { id, name, sec }),
      onStatus: (status, result, error) => ev('pb:agentStatus', { status, result, error }),
    });
    c.sessionId = res.sessionId;
    if (res.rateLimit) lastRateLimit = res.rateLimit;
    addUsage(res.usage, res.costUsd);
    const meta = {
      sessionId: res.sessionId,
      usage: res.usage,
      costUsd: res.costUsd,
      rateLimit: res.rateLimit,
      numTurns: res.numTurns,
      toolCounts: res.toolCounts,
    };
    flog(`턴 종료 (conv=${convId}, ${res.aborted ? '중지' : '정상'}, ${((Date.now() - startedAt) / 1000).toFixed(1)}초)`);
    appendTurnLog({
      ts: new Date().toISOString(),
      conv: convId,
      status: res.aborted ? 'stopped' : 'ok',
      model: currentModel,
      mode: permissionMode,
      sec: Math.round((Date.now() - startedAt) / 1000),
      tools: res.toolCounts,
      costUsd: res.costUsd,
      prompt: String(prompt).replace(/\s+/g, ' ').slice(0, 200),
    });
    return { status: res.aborted ? 'stopped' : 'ok', result: res.resultText, ...meta };
  } catch (e) {
    flog(`턴 오류 (conv=${convId}, ${((Date.now() - startedAt) / 1000).toFixed(1)}초): ${e.message}`);
    appendTurnLog({
      ts: new Date().toISOString(),
      conv: convId,
      status: 'error',
      model: currentModel,
      sec: Math.round((Date.now() - startedAt) / 1000),
      error: String(e.message).slice(0, 200),
      prompt: String(prompt).replace(/\s+/g, ' ').slice(0, 200),
    });
    return { status: 'error', message: e.message };
  } finally {
    c.busy = false;
  }
}

ipcMain.handle('pb:ask', (_e, convId, prompt, attachments, opts) =>
  runAsk(convId, prompt, attachments, opts),
);

/** 작업이 끝났을 때 알림. force 면 창을 보고 있어도 알린다(다른 탭에서 끝난 경우). */
ipcMain.handle('pb:notifyDone', (_e, { title, body, force }) => {
  try {
    if (!Notification.isSupported()) return;
    if (win && win.isFocused() && !force && !process.env.PB_DEV_FORCE_NOTIFY) return;
    const n = new Notification({ title: title || '딸각기획', body: body || '작업이 끝났습니다.' });
    n.on('click', () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
    n.show();
    flog('알림 표시: ' + (body || ''));
  } catch (e) {
    flog('알림 실패: ' + e.message);
  }
});

ipcMain.handle('pb:stop', (_e, convId) => {
  const c = convs.get(convId);
  void c?.warm.interrupt();
});

ipcMain.handle('pb:getContextUsage', async () => {
  if (!workDir) return null;
  try {
    const c = activeConvId ? convs.get(activeConvId) : null;
    if (c?.warm.hasLive()) {
      const u = await c.warm.contextUsage();
      if (u) return u;
    }
    return await getContextUsage(workDir, c?.sessionId, currentModel);
  } catch {
    return null;
  }
});

// ---- 인증 (사용자 각자의 Claude 계정) ----

/** 번들된 claude 실행 파일 경로. hoisted/nested 양쪽을 확인한다. */
function claudeBin() {
  const pkg = `claude-agent-sdk-${process.platform}-${process.arch}`;
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const roots = [
    path.join(__dirname, '..', 'node_modules', '@anthropic-ai'),
    path.join(process.resourcesPath ?? '', 'app', 'node_modules', '@anthropic-ai'),
  ];
  const candidates = [];
  for (const at of roots) {
    candidates.push(path.join(at, pkg, exe));
    candidates.push(path.join(at, 'claude-agent-sdk', 'node_modules', '@anthropic-ai', pkg, exe));
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* noop */
    }
  }
  flog('claudeBin 못 찾음: ' + JSON.stringify(candidates));
  return candidates[0];
}

ipcMain.handle('pb:authStatus', async () => {
  try {
    const { stdout } = await execFileP(claudeBin(), ['auth', 'status', '--json'], { timeout: 15000 });
    return { ok: true, ...JSON.parse(stdout) };
  } catch (e) {
    try {
      return { ok: true, ...JSON.parse(e.stdout || '') };
    } catch {
      flog('authStatus 실패: ' + e.message);
      return { ok: false, loggedIn: false, error: e.message };
    }
  }
});

ipcMain.handle('pb:authLogin', async () => {
  return await new Promise((resolve) => {
    const p = spawn(claudeBin(), ['auth', 'login', '--claudeai'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let opened = false;
    const onData = (d) => {
      out += d.toString();
      const m = out.match(/https?:\/\/[^\s'"]+/);
      if (m && !opened) {
        opened = true;
        shell.openExternal(m[0]);
        send('pb:authProgress', '브라우저에서 로그인을 완료하세요…');
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('exit', (code) => resolve({ ok: code === 0 }));
    p.on('error', (err) => resolve({ ok: false, error: String(err) }));
  });
});

ipcMain.handle('pb:authLogout', async () => {
  try {
    await execFileP(claudeBin(), ['auth', 'logout'], { timeout: 15000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- 개발용: 프롬프트를 한 번 자동 실행한다 (PB_DEV_ASK=프롬프트, PB_DEV_ASK_OUT=결과파일). ----

if (process.env.PB_DEV_ASK) {
  app.whenReady().then(() => {
    setTimeout(async () => {
      const out = process.env.PB_DEV_ASK_OUT || '/tmp/pb-dev-ask.json';
      const res = await runAsk('dev', process.env.PB_DEV_ASK, [], {});
      fs.writeFileSync(out, JSON.stringify(res, null, 2));
      flog('PB_DEV_ASK 완료 -> ' + out);
    }, Number(process.env.PB_DEV_ASK_DELAY || 3000));
  });
}

// ---- 개발용: 렌더러에서 표현식을 평가해 로그에 남긴다 (PB_DEV_EVAL=표현식). ----

if (process.env.PB_DEV_EVAL) {
  app.whenReady().then(() => {
    setTimeout(() => {
      win?.webContents
        .executeJavaScript(process.env.PB_DEV_EVAL)
        .then((v) => flog('PB_DEV_EVAL = ' + JSON.stringify(v)))
        .catch((e) => flog('PB_DEV_EVAL 오류: ' + e.message));
    }, Number(process.env.PB_DEV_EVAL_DELAY || 5000));
  });
}

// ---- 개발용: 사고 원문 표시 경로를 시험한다 (PB_DEV_FAKE_THINK=1). ----

if (process.env.PB_DEV_FAKE_THINK) {
  app.whenReady().then(() => {
    setTimeout(() => {
      send(
        'pb:agentThinking',
        '카운터 UI를 어떻게 구성할지 검토 중.\n- 상단에 숫자, 하단에 +/- 버튼\n- 상태는 S 하나에 두고 draw()는 읽기만\n- 저장은 localStorage, pagehide 자동저장까지',
      );
      flog('PB_DEV_FAKE_THINK 전송');
    }, Number(process.env.PB_DEV_FAKE_THINK_DELAY || 9000));
  });
}

// ---- 개발용: 권한 확인 흐름만 시험한다 (PB_DEV_FAKE_PERM=1). ----

if (process.env.PB_DEV_FAKE_PERM) {
  app.whenReady().then(() => {
    setTimeout(async () => {
      const r = await askPermission(
        'Bash',
        { command: 'echo "권한 확인 흐름 시험"' },
        { title: 'Claude 가 명령을 실행하려 합니다', displayName: '명령 실행', description: '시험용 요청입니다.' },
      );
      flog('FAKE_PERM 결과: ' + JSON.stringify(r));
    }, 4000);
  });
}

// ---- 개발용: 렌더러의 특정 요소를 클릭한다 (PB_DEV_CLICK=CSS선택자). ----

if (process.env.PB_DEV_CLICK) {
  app.whenReady().then(() => {
    setTimeout(() => {
      const sel = JSON.stringify(process.env.PB_DEV_CLICK);
      win?.webContents
        .executeJavaScript(`document.querySelector(${sel})?.click(); true`)
        .then(() => flog('PB_DEV_CLICK 실행: ' + process.env.PB_DEV_CLICK))
        .catch((e) => flog('PB_DEV_CLICK 실패: ' + e.message));
    }, Number(process.env.PB_DEV_CLICK_DELAY || 5000));
  });
}

// ---- 개발용: 창을 파일로 캡처한다 (PB_DEV_SHOT=/경로/접두어). 배포 시에는 쓰이지 않는다. ----

if (process.env.PB_DEV_SHOT) {
  const prefix = process.env.PB_DEV_SHOT;
  app.whenReady().then(() => {
    setTimeout(async () => {
      try {
        const ui = await win.webContents.capturePage();
        fs.writeFileSync(`${prefix}-ui.png`, ui.toPNG());
        if (previewView) {
          const pv = await previewView.webContents.capturePage();
          fs.writeFileSync(`${prefix}-preview.png`, pv.toPNG());
        }
        flog('PB_DEV_SHOT 캡처 완료');
      } catch (e) {
        flog('PB_DEV_SHOT 실패: ' + e.message);
      }
    }, Number(process.env.PB_DEV_SHOT_DELAY || 6000));
  });
}

ipcMain.handle('pb:versions', async () => {
  let engine = '?';
  try {
    const { stdout } = await execFileP(claudeBin(), ['--version'], { timeout: 15000 });
    engine = (stdout.match(/\d+\.\d+\.\d+/) || ['?'])[0];
  } catch {
    /* noop */
  }
  return { app: app.getVersion(), engine, electron: process.versions.electron };
});
