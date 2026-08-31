import fs from 'node:fs';
import path from 'node:path';
import { loadProject, docsFolderIds, sheetsFolderIds, unityProjects } from './project.mjs';
import { flog } from './config.mjs';
import { googleConnected } from './connectors/google-auth.mjs';
import { slackStatus } from './connectors/slack.mjs';
import { trelloStatus, trelloBoardCards } from './connectors/trello.mjs';
import * as g from './connectors/google.mjs';

/**
 * 인덱서 — 프로젝트의 소스 카탈로그(어떤 문서·시트·탭·채널·보드가 있는지)를
 * 로컬(.ddalgi/index/)에 유지한다. 에이전트는 매 질문마다 API 를 훑는 대신
 * catalog.md 를 먼저 읽어 조회 범위를 좁힌다 — 토큰 절약의 핵심 계층.
 * 모든 외부 호출은 metering(사용량 가드)을 통과한다.
 */

const MAX_SHEETS_META = 8; // 탭 목록까지 읽는 스프레드시트 수 상한
const MAX_FILES = 100;

function indexDir(workDir) {
  return path.join(workDir, '.ddalgi', 'index');
}

export function indexStatus(workDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(indexDir(workDir), 'catalog.json'), 'utf-8'));
    return { syncedAt: j.syncedAt, counts: j.counts ?? {}, errors: j.errors ?? [] };
  } catch {
    return null;
  }
}

/** 카탈로그를 (재)생성한다. force 가 아니면 동기화 주기 내 재실행을 건너뛴다. */
export async function syncIndex(workDir, { force = false, onStatus } = {}) {
  const pj = loadProject(workDir);
  if (!pj) return { ok: false, reason: 'project.yaml 없음' };

  const intervalH = Number(pj.indexer?.sync_interval_hours) || 6;
  const prev = indexStatus(workDir);
  if (!force && prev?.syncedAt && Date.now() - new Date(prev.syncedAt).getTime() < intervalH * 3600_000) {
    return { ok: true, skipped: true, syncedAt: prev.syncedAt };
  }

  const say = (m) => {
    flog('인덱서: ' + m);
    onStatus?.(m);
  };
  const errors = [];
  const counts = {};
  const md = [];
  md.push(`# 프로젝트 카탈로그 — ${pj.project_name ?? path.basename(workDir)}`);
  md.push('');
  md.push('이 파일은 인덱서가 자동 생성한다. 조회 전에 여기서 대상(파일 id·탭·채널·카드)을 먼저 좁힌다.');

  // ---- 구글 드라이브 (기획서 + 시트 — 폴더 복수 지원) ----
  const docsIds = docsFolderIds(pj);
  const sheetsIds = sheetsFolderIds(pj);
  if (googleConnected() && (docsIds.length || sheetsIds.length)) {
    try {
      for (let i = 0; i < docsIds.length; i++) {
        say(`드라이브 기획서 폴더 조회 (${i + 1}/${docsIds.length})`);
        const files = await g.driveList(docsIds[i], MAX_FILES);
        counts.docs = (counts.docs || 0) + files.length;
        md.push('', `## 기획서 폴더${docsIds.length > 1 ? ` ${i + 1}` : ''} (구글 드라이브, ${files.length}개)`);
        for (const f of files) {
          const kind = f.mimeType.includes('presentation') ? 'slides' : f.mimeType.includes('document') ? 'doc' : f.mimeType.split('.').pop();
          md.push(`- ${f.name} [${kind}] id=${f.id} (수정 ${f.modifiedTime?.slice(0, 10)})`);
        }
      }
      let sheetMetaBudget = MAX_SHEETS_META;
      for (let i = 0; i < sheetsIds.length; i++) {
        say(`드라이브 시트 폴더 조회 (${i + 1}/${sheetsIds.length})`);
        const files = await g.driveList(sheetsIds[i], MAX_FILES);
        counts.sheets = (counts.sheets || 0) + files.length;
        md.push('', `## 데이터 테이블 폴더${sheetsIds.length > 1 ? ` ${i + 1}` : ''} (구글 드라이브, ${files.length}개)`);
        const spreads = files.filter((f) => f.mimeType.includes('spreadsheet'));
        for (const f of files) {
          const kind = f.mimeType.includes('spreadsheet') ? 'sheet' : f.mimeType.split('.').pop();
          md.push(`- ${f.name} [${kind}] id=${f.id} (수정 ${f.modifiedTime?.slice(0, 10)})`);
        }
        // 주요 스프레드시트의 탭 목록 — '사본'·'[삭제용]' 파일은 파일명만 남긴다.
        const primary = spreads.filter((f) => !/사본|\[삭제용\]|백업|test|테스트/i.test(f.name));
        for (const f of primary.slice(0, sheetMetaBudget)) {
          say(`시트 탭 목록: ${f.name}`);
          try {
            const meta = await g.sheetMeta(f.id);
            md.push('', `### 시트 "${f.name}" 탭 (${meta.tabs.length}개) — id=${f.id}`);
            md.push(meta.tabs.map((t) => `${t.title}(${t.rows}×${t.cols})`).join(' · '));
            sheetMetaBudget -= 1;
          } catch (e) {
            errors.push(`시트 ${f.name}: ${e.message}`);
          }
        }
      }
    } catch (e) {
      errors.push('구글: ' + e.message);
    }
  } else {
    md.push('', '## 구글 드라이브 — 미연결 또는 폴더 미지정');
  }

  // ---- 슬랙 (등록 채널만) ----
  const chans = pj.slack?.channels ?? [];
  md.push('', `## 슬랙 채널 (등록 ${chans.length}개 — 이 채널만 조회 가능)`);
  if (slackStatus().connected && chans.length) {
    for (const c of chans) md.push(`- ${c.name ?? '?'} (${c.id})`);
    counts.slackChannels = chans.length;
  } else {
    md.push('- (미연결 또는 등록 채널 없음)');
  }

  // ---- 트렐로 (등록 보드) ----
  const boards = pj.trello?.boards ?? [];
  if (trelloStatus().connected && boards.length) {
    for (const b of boards.slice(0, 3)) {
      say(`트렐로 보드: ${b.name}`);
      try {
        const d = await trelloBoardCards(b.id);
        counts.trelloLists = (counts.trelloLists || 0) + d.lists;
        md.push('', `## 트렐로 보드 "${b.name}" (id=${b.id})`);
        md.push(d.text.slice(0, 4000));
      } catch (e) {
        errors.push(`트렐로 ${b.name}: ${e.message}`);
      }
    }
  } else {
    md.push('', '## 트렐로 — 미연결 또는 등록 보드 없음');
  }

  // ---- 유니티 (로컬 — API 비용 없음, 복수 프로젝트 지원) ----
  for (const proj of unityProjects(pj)) {
    if (!fs.existsSync(proj.path)) continue;
    const scriptsRoot = path.join(proj.path, proj.scripts_root);
    md.push('', `## 유니티 프로젝트 — ${proj.path}`);
    try {
      let csCount = 0;
      const dirs = [];
      const walk = (dir, depth) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue;
          if (e.isDirectory() && depth < 2) {
            dirs.push(path.relative(scriptsRoot, path.join(dir, e.name)));
            walk(path.join(dir, e.name), depth + 1);
          } else if (e.name.endsWith('.cs')) csCount += 1;
        }
      };
      if (fs.existsSync(scriptsRoot)) walk(scriptsRoot, 0);
      counts.csFiles = (counts.csFiles || 0) + csCount;
      md.push(`- 스크립트 루트: ${scriptsRoot} (.cs ${csCount}개)`);
      if (dirs.length) md.push('- 하위 폴더: ' + dirs.slice(0, 40).join(', '));
      md.push('- 코드 검색: Grep, 변경 이력: `git -C "' + proj.path + '" log --oneline -- <파일>` (읽기 전용)');
    } catch (e) {
      errors.push('유니티: ' + e.message);
    }
  }

  // ---- 아카이브 (로컬) ----
  const archDir = path.join(workDir, pj.archive?.path ?? 'archive', 'decisions');
  try {
    const files = fs.readdirSync(archDir).filter((f) => f.endsWith('.md'));
    counts.decisions = files.length;
    md.push('', `## 아카이브 — 의사결정 기록 (${files.length}건, ${archDir})`);
    for (const f of files.slice(-30)) md.push(`- ${f}`);
  } catch {
    md.push('', '## 아카이브 — 아직 기록 없음');
  }

  if (errors.length) {
    md.push('', '## 인덱서 오류 (이 소스들은 카탈로그가 불완전할 수 있음)');
    for (const e of errors) md.push(`- ${e}`);
  }

  const syncedAt = new Date().toISOString();
  md.splice(1, 0, `(동기화: ${syncedAt.slice(0, 16).replace('T', ' ')} UTC — 오래됐으면 연동 설정에서 [지금 동기화])`);

  fs.mkdirSync(indexDir(workDir), { recursive: true });
  fs.writeFileSync(path.join(indexDir(workDir), 'catalog.md'), md.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(indexDir(workDir), 'catalog.json'), JSON.stringify({ syncedAt, counts, errors }), 'utf-8');
  say(`완료 — ${JSON.stringify(counts)}`);
  return { ok: true, syncedAt, counts, errors };
}
