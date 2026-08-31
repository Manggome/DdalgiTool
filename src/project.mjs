import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/** 작업 폴더의 .ddalgi/project.yaml — 프로젝트 연결 정보(폴더·채널·보드·매핑)의 진실. */

export function projectPath(workDir) {
  return path.join(workDir, '.ddalgi', 'project.yaml');
}

export function loadProject(workDir) {
  if (!workDir) return null;
  try {
    return YAML.parse(fs.readFileSync(projectPath(workDir), 'utf-8')) ?? null;
  } catch {
    return null;
  }
}

/** 기획서(독스) 폴더 목록 — 복수 지원. 단수 필드(docs_folder_id)는 하위 호환으로 흡수한다. */
export function docsFolderIds(pj) {
  const gd = pj?.google_drive ?? {};
  return [...new Set([gd.docs_folder_id, ...(gd.docs_folder_ids ?? [])].filter(Boolean))];
}

/** 데이터 시트 폴더 목록 — 복수 지원. */
export function sheetsFolderIds(pj) {
  const gd = pj?.google_drive ?? {};
  return [...new Set([gd.sheets_folder_id, ...(gd.sheets_folder_ids ?? [])].filter(Boolean))];
}

/** 유니티 프로젝트 목록 — 복수 지원. 단수 필드(project_path)는 하위 호환으로 흡수한다. */
export function unityProjects(pj) {
  const u = pj?.unity ?? {};
  const list = [...(u.projects ?? [])].filter((x) => x?.path);
  if (u.project_path && !list.some((x) => x.path === u.project_path)) {
    list.unshift({ path: u.project_path, scripts_root: u.scripts_root ?? 'Assets/Scripts' });
  }
  return list.map((x) => ({ path: x.path, scripts_root: x.scripts_root ?? 'Assets/Scripts' }));
}

/** 마법사가 만드는 기본 골격. 기존 파일이 있으면 연결 항목만 갈아끼우고 나머지(매핑 등)는 보존한다. */
export function saveProjectLinks(workDir, links) {
  const prev = loadProject(workDir) ?? {};
  const docsIds = [...new Set((links.docsFolderIds ?? docsFolderIds(prev)).filter(Boolean))];
  const sheetsIds = [...new Set((links.sheetsFolderIds ?? sheetsFolderIds(prev)).filter(Boolean))];
  const unity = (links.unityPaths ?? unityProjects(prev).map((x) => x.path))
    .filter(Boolean)
    .map((p) => ({ path: p, scripts_root: prev.unity?.scripts_root ?? 'Assets/Scripts' }));
  const next = {
    ...prev,
    project_name: links.projectName || prev.project_name || path.basename(workDir),
    google_drive: {
      ...(prev.google_drive ?? {}),
      // 첫 항목을 단수 필드에도 남겨 예전 버전과 호환한다.
      docs_folder_id: docsIds[0] ?? '',
      docs_folder_ids: docsIds,
      sheets_folder_id: sheetsIds[0] ?? '',
      sheets_folder_ids: sheetsIds,
    },
    slack: { channels: links.slackChannels ?? prev.slack?.channels ?? [] },
    trello: { boards: links.trelloBoards ?? prev.trello?.boards ?? [] },
    unity: {
      ...(prev.unity ?? {}),
      project_path: unity[0]?.path ?? '',
      projects: unity,
      scripts_root: prev.unity?.scripts_root ?? 'Assets/Scripts',
    },
    table_code_mappings: prev.table_code_mappings ?? [],
    archive: prev.archive ?? { path: 'archive' },
  };
  const dir = path.dirname(projectPath(workDir));
  fs.mkdirSync(dir, { recursive: true });
  const header =
    '# 딸기툴 프로젝트 설정 — [🔗 연동 설정]에서 관리됩니다.\n' +
    '# table_code_mappings(테이블↔코드 매핑) 등은 직접 편집해도 유지됩니다.\n';
  fs.writeFileSync(projectPath(workDir), header + YAML.stringify(next), 'utf-8');
  return next;
}
