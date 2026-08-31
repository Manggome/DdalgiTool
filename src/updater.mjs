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

/** 릴리스 폴더 ID — 프로젝트 설정(project.yaml)이 우선, 없으면 전역 설정. */
export function releaseFolderId(workDir) {
  return (workDir && loadProject(workDir)?.app_update?.release_folder_id) || loadConfig()?.releaseFolderId || '';
}

/** 새 버전이 있으면 {version, id, name}, 최신이면 {upToDate}, 확인 불가면 {skip, reason}. */
export async function checkUpdate(workDir) {
  const folderId = releaseFolderId(workDir);
  if (!folderId) return { skip: true, reason: '릴리스 폴더가 설정되지 않았습니다.' };
  if (!googleConnected()) return { skip: true, reason: '구글 미연결' };
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
