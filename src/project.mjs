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

/** 마법사가 만드는 기본 골격. 기존 파일이 있으면 연결 항목만 갈아끼우고 나머지(매핑 등)는 보존한다. */
export function saveProjectLinks(workDir, links) {
  const prev = loadProject(workDir) ?? {};
  const next = {
    ...prev,
    project_name: links.projectName || prev.project_name || path.basename(workDir),
    google_drive: {
      ...(prev.google_drive ?? {}),
      docs_folder_id: links.docsFolderId ?? prev.google_drive?.docs_folder_id ?? '',
      sheets_folder_id: links.sheetsFolderId ?? prev.google_drive?.sheets_folder_id ?? '',
    },
    slack: { channels: links.slackChannels ?? prev.slack?.channels ?? [] },
    trello: { boards: links.trelloBoards ?? prev.trello?.boards ?? [] },
    unity: {
      ...(prev.unity ?? {}),
      project_path: links.unityPath ?? prev.unity?.project_path ?? '',
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
