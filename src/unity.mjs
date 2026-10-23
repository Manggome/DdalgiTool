import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * 유니티 QA 연결 — 에디터 찾기·열기, 실행 여부 확인, MCP for Unity 서버 설정.
 * 에디터 조종은 프로젝트에 설치된 MCP for Unity(com.coplaydev.unity-mcp) 패키지가 맡고,
 * 딸기툴은 같은 버전의 서버(mcpforunityserver)를 uvx 로 띄워 대화에 붙인다.
 */

const pexec = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const MCP_PKG = 'com.coplaydev.unity-mcp';

/** ProjectSettings/ProjectVersion.txt 의 에디터 버전. */
function projectVersion(projectPath) {
  try {
    const t = fs.readFileSync(path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'utf-8');
    return /m_EditorVersion:\s*(\S+)/.exec(t)?.[1] || null;
  } catch {
    return null;
  }
}

/** Unity Hub 가 에디터를 설치하는 위치 후보 (기본 + 사용자가 바꾼 추가 설치 위치). */
function editorRoots() {
  const roots = IS_WIN
    ? ['C:\\Program Files\\Unity\\Hub\\Editor']
    : ['/Applications/Unity/Hub/Editor'];
  try {
    const cfg = IS_WIN
      ? path.join(process.env.APPDATA || '', 'UnityHub', 'secondaryInstallPath.json')
      : path.join(os.homedir(), 'Library', 'Application Support', 'UnityHub', 'secondaryInstallPath.json');
    const p = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
    if (typeof p === 'string' && p) roots.unshift(p);
  } catch {
    /* 추가 설치 위치 없음 */
  }
  return roots;
}

function editorPathFor(version) {
  if (!version) return null;
  for (const root of editorRoots()) {
    const p = IS_WIN
      ? path.join(root, version, 'Editor', 'Unity.exe')
      : path.join(root, version, 'Unity.app', 'Contents', 'MacOS', 'Unity');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 프로젝트에 MCP for Unity 패키지가 있는지와 그 버전 (서버 버전을 맞추기 위해). */
function mcpPackage(projectPath) {
  let inManifest = false;
  try {
    inManifest = fs.readFileSync(path.join(projectPath, 'Packages', 'manifest.json'), 'utf-8').includes(MCP_PKG);
  } catch {
    return { installed: false, version: null };
  }
  if (!inManifest) return { installed: false, version: null };
  try {
    const cache = path.join(projectPath, 'Library', 'PackageCache');
    const dir = fs.readdirSync(cache).find((d) => d.startsWith(MCP_PKG + '@'));
    const v = dir ? JSON.parse(fs.readFileSync(path.join(cache, dir, 'package.json'), 'utf-8')).version : null;
    return { installed: true, version: v || null };
  } catch {
    return { installed: true, version: null };
  }
}

/** uvx(파이썬 패키지 실행기) 위치. 없으면 null — 설치 안내가 필요하다. */
export function findUvx() {
  const home = os.homedir();
  const cands = IS_WIN
    ? [path.join(home, '.local', 'bin', 'uvx.exe'), path.join(home, '.cargo', 'bin', 'uvx.exe')]
    : [path.join(home, '.local', 'bin', 'uvx'), '/opt/homebrew/bin/uvx', '/usr/local/bin/uvx', path.join(home, '.cargo', 'bin', 'uvx')];
  return cands.find((p) => fs.existsSync(p)) || null;
}

/** 이 프로젝트가 유니티 에디터에 열려 있는지. */
export async function isUnityRunning(projectPath) {
  const want = path.resolve(projectPath).toLowerCase();
  try {
    if (IS_WIN) {
      const { stdout } = await pexec(
        'powershell',
        ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" | Select-Object -ExpandProperty CommandLine"],
        { timeout: 8000, windowsHide: true },
      );
      return stdout.toLowerCase().split(/\r?\n/).some((l) => l.includes(want));
    }
    const { stdout } = await pexec('ps', ['-axo', 'command'], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
    return stdout
      .split('\n')
      .some((l) => /Unity\.app\/Contents\/MacOS\/Unity/.test(l) && l.toLowerCase().includes('-projectpath ' + want));
  } catch {
    return false;
  }
}

/** 유니티 QA 준비 상태 — 무엇이 되고 무엇이 모자란지 한 번에. */
export async function unityInfo(projectPath) {
  const exists = !!projectPath && fs.existsSync(path.join(projectPath, 'ProjectSettings'));
  const version = exists ? projectVersion(projectPath) : null;
  const editorPath = editorPathFor(version);
  const pkg = exists ? mcpPackage(projectPath) : { installed: false, version: null };
  const uvx = findUvx();
  const running = exists ? await isUnityRunning(projectPath) : false;
  const missing = [];
  if (!exists) missing.push('유니티 프로젝트 경로가 없거나 잘못됨 — [🔗 연동 설정]에서 유니티 경로를 지정하세요');
  else {
    if (!editorPath) missing.push(`Unity ${version || '(버전 모름)'} 에디터가 설치돼 있지 않음 — Unity Hub 에서 이 버전을 설치하세요`);
    if (!pkg.installed) missing.push('프로젝트에 MCP for Unity 패키지가 없음 — 패키지 매니저에서 https://github.com/CoplayDev/unity-mcp.git?path=/MCPForUnity 추가');
    if (!uvx) missing.push(IS_WIN ? 'uv 가 설치돼 있지 않음 — PowerShell: irm https://astral.sh/uv/install.ps1 | iex' : 'uv 가 설치돼 있지 않음 — 터미널: curl -LsSf https://astral.sh/uv/install.sh | sh');
  }
  return {
    projectPath,
    exists,
    version,
    editorPath,
    mcpPackage: pkg,
    uvx,
    running,
    ready: exists && !!editorPath && pkg.installed && !!uvx,
    missing,
  };
}

/** 에디터로 프로젝트를 연다 (딸기툴과 분리된 프로세스 — 딸기툴을 꺼도 유니티는 계속 켜져 있다). */
export function openUnity(info) {
  if (!info?.editorPath) throw new Error('유니티 에디터를 찾지 못했습니다.');
  const child = spawn(info.editorPath, ['-projectPath', info.projectPath], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return child.pid;
}

/** 대화에 붙일 MCP for Unity 서버 설정 (프로젝트 패키지와 같은 버전으로 고정). */
export function unityServerConfig(info) {
  if (!info?.uvx) return null;
  const spec = info.mcpPackage?.version ? `mcpforunityserver==${info.mcpPackage.version}` : 'mcpforunityserver';
  return { type: 'stdio', command: info.uvx, args: ['--from', spec, 'mcp-for-unity', '--transport', 'stdio'] };
}

// ---------- QA 안전 범위 (PreToolUse 훅이 쓴다) ----------

/** 그냥 허용 — 읽기·조회·테스트 실행 */
const SAFE_TOOLS = new Set([
  'read_console', 'find_gameobjects', 'run_tests', 'get_test_job', 'unity_docs', 'unity_reflect',
  'set_active_instance', 'get_sha', 'debug_request_context', 'find_in_file', 'validate_script', 'manage_script_capabilities',
]);
/** 도구 안에서 동작(action)별로 허용 */
const SAFE_ACTIONS = {
  manage_editor: ['play', 'pause', 'stop', 'telemetry_status', 'telemetry_ping'],
  manage_scene: ['get_hierarchy', 'get_active', 'get_build_settings', 'get_loaded_scenes', 'scene_view_frame'],
  manage_camera: ['screenshot', 'screenshot_multiview', 'list_cameras', 'ping', 'get_brain_status'],
  manage_ui: ['ping', 'read', 'get_visual_tree', 'list', 'render_ui'],
  execute_code: ['get_history'],
};
/** 매번 승인 — 무엇이든 할 수 있거나 작업을 날릴 수 있는 것 */
const ASK_ACTIONS = {
  execute_code: ['execute', 'replay'],
  manage_scene: ['load'],
};
const ASK_TOOLS = new Set(['execute_menu_item']);
/** 스크린샷은 프로젝트 Assets 가 아니라 Temp(유니티가 가져오지 않고 깃에도 안 들어감)에 저장 */
const SHOT_FOLDER = 'Temp/DdalgiQA';

/**
 * 유니티 도구 호출 판정. 반환: { decision:'allow'|'deny'|'ask', reason, updatedInput?, playConsent? }
 * 'ask' 는 호출부가 승인 카드를 띄운다.
 */
export function judgeUnityTool(toolName, input) {
  const tool = String(toolName).replace(/^mcp__unity__/, '');
  const action = input && typeof input === 'object' ? String(input.action ?? '') : '';
  if (SAFE_TOOLS.has(tool)) {
    if (tool === 'read_console' && action === 'clear') return { decision: 'allow', reason: '콘솔 비우기(프로젝트 데이터 아님)' };
    return { decision: 'allow', reason: '읽기·테스트' };
  }
  if (ASK_TOOLS.has(tool)) return { decision: 'ask', reason: `유니티 메뉴 실행: ${input?.menu_path ?? input?.menuPath ?? ''}` };
  if (ASK_ACTIONS[tool]?.includes(action)) {
    const what = tool === 'execute_code' ? '유니티 안에서 코드 실행' : '씬 불러오기 (저장 안 된 작업이 있으면 사라질 수 있음)';
    return { decision: 'ask', reason: what };
  }
  if (SAFE_ACTIONS[tool]?.includes(action)) {
    const out = { decision: 'allow', reason: `${tool}.${action}` };
    if (tool === 'manage_editor' && action === 'play') out.playConsent = true;
    if ((tool === 'manage_camera' && action.startsWith('screenshot')) || (tool === 'manage_ui' && action === 'render_ui')) {
      out.updatedInput = {
        ...input,
        output_folder: SHOT_FOLDER,
        include_image: input?.include_image ?? true,
        max_resolution: input?.max_resolution ?? 960,
      };
    }
    return out;
  }
  return {
    decision: 'deny',
    reason: `QA 모드에서는 유니티 프로젝트를 바꾸는 동작을 쓸 수 없습니다 (${tool}${action ? '.' + action : ''}). 읽기·플레이·스크린샷·콘솔·테스트만 가능합니다.`,
  };
}
