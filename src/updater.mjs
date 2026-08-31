import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { loadConfig } from './config.mjs';
import { loadProject } from './project.mjs';
import { driveList } from './connectors/google.mjs';
import { googleAccessToken, googleConnected } from './connectors/google-auth.mjs';
import { meteredFetch } from './metering.mjs';

/**
 * 앱 업데이트 — 구글 드라이브의 릴리스 폴더를 채널로 쓴다.
 * 저장소가 비공개라 GitHub Releases 를 팀원 앱이 읽을 수 없고,
 * 팀 전원이 이미 구글에 연결돼 있으므로 각자의 인증으로 릴리스 폴더를 조회한다.
 * 폴더에 Ddalgi-x.y.z-….dmg/exe 를 올려두면 감지 → 알림 → 클릭 한 번에 내려받아 연다.
 */

const PATTERN =
  process.platform === 'darwin'
    ? /^Ddalgi-(\d+\.\d+\.\d+)(?:-arm64)?\.dmg$/
    : /^Ddalgi-(\d+\.\d+\.\d+)-x64-setup\.exe$/;

function cmpVer(a, b) {
  const A = String(a).split('.').map(Number);
  const B = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0);
  return 0;
}

const GH_REPO = 'Manggome/DdalgiTool';

/** 1순위 채널: GitHub Releases (공개 저장소 — 팀원 설정 없이 동작). 릴리스가 없으면 null. */
async function checkGithub() {
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const ver = String(d.tag_name || '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(ver)) return null;
    const asset = (d.assets || []).find((a) => PATTERN.test(a.name));
    if (!asset) return null;
    return { version: ver, name: asset.name, url: asset.browser_download_url, source: 'github' };
  } catch {
    return null;
  }
}

/** 릴리스 폴더 ID — 프로젝트 설정(project.yaml)이 우선, 없으면 전역 설정. */
export function releaseFolderId(workDir) {
  return (workDir && loadProject(workDir)?.app_update?.release_folder_id) || loadConfig()?.releaseFolderId || '';
}

/** 새 버전이 있으면 {version, id, name}, 최신이면 {upToDate}, 확인 불가면 {skip, reason}. */
export async function checkUpdate(workDir) {
  // 1순위: GitHub Releases (설정 불필요)
  const gh = await checkGithub();
  if (gh) {
    if (cmpVer(gh.version, app.getVersion()) <= 0) return { upToDate: true, current: app.getVersion(), latest: gh.version };
    return gh;
  }
  // 2순위: 드라이브 릴리스 폴더 (예비 — 저장소를 다시 비공개로 돌릴 경우)
  const folderId = releaseFolderId(workDir);
  if (!folderId) return { skip: true, reason: 'GitHub 릴리스가 없고 드라이브 릴리스 폴더도 미설정입니다.' };
  if (!googleConnected()) return { skip: true, reason: 'GitHub 릴리스 없음 · 구글 미연결' };
  const files = await driveList(folderId, 50);
  let best = null;
  for (const f of files) {
    const m = PATTERN.exec(f.name);
    if (m && (!best || cmpVer(m[1], best.version) > 0)) best = { version: m[1], id: f.id, name: f.name };
  }
  if (!best) return { skip: true, reason: '릴리스 폴더에 이 플랫폼용 설치 파일이 없습니다.' };
  if (cmpVer(best.version, app.getVersion()) <= 0) return { upToDate: true, current: app.getVersion(), latest: best.version };
  return best;
}

/** 설치 파일을 다운로드 폴더로 내려받고 경로를 돌려준다. */
export async function downloadUpdate(file) {
  // GitHub 자산은 공개 URL 그대로 받는다.
  if (file.source === 'github') {
    const r = await fetch(file.url);
    if (!r.ok) throw new Error(`다운로드 실패 (${r.status})`);
    const dest = path.join(app.getPath('downloads'), file.name);
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    return dest;
  }
  const token = await googleAccessToken();
  const r = await meteredFetch(
    'google',
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`다운로드 실패 (${r.status})`);
  const dest = path.join(app.getPath('downloads'), file.name);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  return dest;
}
