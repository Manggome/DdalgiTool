import { meteredFetch } from '../metering.mjs';
import { googleAccessToken } from './google-auth.mjs';

/** 구글 워크스페이스 REST 클라이언트 (Drive/Docs/Sheets). 모든 호출은 사용량 가드를 통과한다. */

async function gget(url) {
  const token = await googleAccessToken();
  const r = await meteredFetch('google', url, { headers: { authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (!r.ok) throw new Error(`구글 API 오류 ${r.status}: ${d.error?.message || ''}`);
  return d;
}

async function gpost(url, body, method = 'POST') {
  const token = await googleAccessToken();
  const r = await meteredFetch('google', url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`구글 API 오류 ${r.status}: ${d.error?.message || ''}`);
  return d;
}

const esc = (s) => String(s).replace(/'/g, "\\'");

/**
 * 드라이브 검색. folderIds 가 있으면 그 폴더들(직계) 안에서만 찾는다.
 * 반환: [{id, name, mimeType, modifiedTime}]
 */
export async function driveSearch(query, folderIds = [], pageSize = 20) {
  const parts = ['trashed=false'];
  if (query) {
    // Drive 의 name contains 는 단어 접두 매칭이라 대괄호가 든 긴 문구는 통째로 넣으면 안 잡힌다.
    // 단어별 AND 로 나눠 이름을 매칭하고, 본문은 원문 그대로 fullText 로 찾는다.
    const words = String(query).split(/\s+/).filter(Boolean).slice(0, 6);
    const nameClause = words.map((w) => `name contains '${esc(w)}'`).join(' and ');
    parts.push(`((${nameClause}) or fullText contains '${esc(query)}')`);
  }
  if (folderIds.length) parts.push('(' + folderIds.map((id) => `'${esc(id)}' in parents`).join(' or ') + ')');
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.search = new URLSearchParams({
    q: parts.join(' and '),
    pageSize: String(Math.min(pageSize, 50)),
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  }).toString();
  return (await gget(u.toString())).files ?? [];
}

/** 폴더 안 파일 목록 (검색어 없이). */
export function driveList(folderId, pageSize = 50) {
  return driveSearch('', [folderId], pageSize);
}

/** 구글 독스 본문을 평문으로. 표는 셀을 탭으로 구분한다. 너무 길면 잘라서 표시한다. */
export async function docRead(docId, maxChars = 60000) {
  const d = await gget(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`);
  const lines = [];
  const walk = (content) => {
    for (const el of content ?? []) {
      if (el.paragraph) {
        const style = el.paragraph.paragraphStyle?.namedStyleType || '';
        const text = (el.paragraph.elements ?? [])
          .map((e) => e.textRun?.content ?? '')
          .join('')
          .replace(/\n$/, '');
        if (!text.trim()) continue;
        const h = /HEADING_(\d)/.exec(style);
        lines.push(h ? `${'#'.repeat(Number(h[1]))} ${text}` : text);
      } else if (el.table) {
        for (const row of el.table.tableRows ?? []) {
          const cells = (row.tableCells ?? []).map((c) => {
            const buf = [];
            for (const cc of c.content ?? [])
              for (const e of cc.paragraph?.elements ?? []) buf.push(e.textRun?.content ?? '');
            return buf.join('').replace(/\n/g, ' ').trim();
          });
          lines.push('| ' + cells.join(' | ') + ' |');
        }
      }
    }
  };
  walk(d.body?.content);
  let text = lines.join('\n');
  let truncated = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }
  return { title: d.title, text, truncated };
}

/** 시트 메타 (탭 목록·크기). */
export async function sheetMeta(spreadsheetId) {
  const d = await gget(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))`,
  );
  return {
    title: d.properties?.title,
    tabs: (d.sheets ?? []).map((s) => ({
      title: s.properties?.title,
      rows: s.properties?.gridProperties?.rowCount,
      cols: s.properties?.gridProperties?.columnCount,
    })),
  };
}

/** 범위 값 조회. 반환은 TSV 텍스트 (토큰 절약). formulas=true 면 계산값 대신 수식 원문을 돌려준다. */
export async function sheetRead(spreadsheetId, range, formulas = false) {
  const d = await gget(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
      (formulas ? '?valueRenderOption=FORMULA' : ''),
  );
  const rows = d.values ?? [];
  return { range: d.range, rows: rows.length, tsv: rows.map((r) => r.join('\t')).join('\n') };
}

/** 범위 값 쓰기 (USER_ENTERED). 호출 전 반드시 앱 승인 절차를 거칠 것. */
export async function sheetUpdate(spreadsheetId, range, values) {
  const d = await gpost(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { values },
    'PUT',
  );
  return { updatedCells: d.updatedCells, updatedRange: d.updatedRange };
}

/** 구글 슬라이드 텍스트 추출 — 슬라이드별로 텍스트 요소를 모은다. */
export async function slidesRead(presentationId, maxChars = 60000) {
  const d = await gget(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`);
  const out = [];
  (d.slides ?? []).forEach((slide, i) => {
    const texts = [];
    const collect = (elements) => {
      for (const el of elements ?? []) {
        for (const te of el.shape?.text?.textElements ?? []) {
          const t = te.textRun?.content;
          if (t && t.trim()) texts.push(t.replace(/\n$/, ''));
        }
        for (const row of el.table?.tableRows ?? []) {
          const cells = (row.tableCells ?? []).map((c) =>
            (c.text?.textElements ?? []).map((te) => te.textRun?.content ?? '').join('').replace(/\n/g, ' ').trim(),
          );
          texts.push('| ' + cells.join(' | ') + ' |');
        }
        if (el.elementGroup?.children) collect(el.elementGroup.children);
      }
    };
    collect(slide.pageElements);
    const note = (slide.slideProperties?.notesPage?.pageElements ?? [])
      .flatMap((el) => (el.shape?.text?.textElements ?? []).map((te) => te.textRun?.content ?? ''))
      .join('')
      .trim();
    out.push(`--- 슬라이드 ${i + 1} ---\n${texts.join('\n')}${note ? `\n(발표자 노트) ${note.replace(/\n/g, ' ')}` : ''}`);
  });
  let text = out.join('\n\n');
  let truncated = false;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }
  return { title: d.title, slideCount: (d.slides ?? []).length, text, truncated };
}

// ---- 쓰기 (호출 전 반드시 앱 승인 절차를 거칠 것) ----

const CREATE_MIME = {
  doc: 'application/vnd.google-apps.document',
  slides: 'application/vnd.google-apps.presentation',
  sheet: 'application/vnd.google-apps.spreadsheet',
};

/** 드라이브에 새 독스/슬라이드/시트 파일 생성. */
export async function driveCreate(name, type, folderId) {
  const mime = CREATE_MIME[type];
  if (!mime) throw new Error('type 은 doc | slides | sheet 중 하나여야 합니다.');
  const body = { name, mimeType: mime, ...(folderId ? { parents: [folderId] } : {}) };
  return gpost('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink', body);
}

function docBatch(docId, requests) {
  return gpost(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, { requests });
}

/** 문서 끝에 텍스트 추가 (줄바꿈 포함). */
export async function docAppend(docId, text) {
  await docBatch(docId, [{ insertText: { endOfSegmentLocation: {}, text: '\n' + text } }]);
  return { ok: true };
}

/** 문서 전체에서 find → replace 치환. 바뀐 횟수를 돌려준다. */
export async function docReplace(docId, find, replace, matchCase = true) {
  const d = await docBatch(docId, [
    { replaceAllText: { containsText: { text: find, matchCase }, replaceText: replace } },
  ]);
  return d.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
}

function slidesBatch(pid, requests) {
  return gpost(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(pid)}:batchUpdate`, { requests });
}

/** 프레젠테이션 전체에서 find → replace 치환. */
export async function slidesReplace(pid, find, replace, matchCase = true) {
  const d = await slidesBatch(pid, [
    { replaceAllText: { containsText: { text: find, matchCase }, replaceText: replace } },
  ]);
  return d.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;
}

/** 제목+본문 레이아웃 슬라이드 1장을 끝에 추가. */
export async function slidesAddSlide(pid, title, body) {
  const stamp = Date.now().toString(36);
  const titleId = `ddalgi_title_${stamp}`;
  const bodyId = `ddalgi_body_${stamp}`;
  await slidesBatch(pid, [
    {
      createSlide: {
        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: 'TITLE' }, objectId: titleId },
          { layoutPlaceholder: { type: 'BODY' }, objectId: bodyId },
        ],
      },
    },
    { insertText: { objectId: titleId, text: title } },
    ...(body ? [{ insertText: { objectId: bodyId, text: body } }] : []),
  ]);
  return { ok: true };
}

// ---- 드라이브 파일 관리 (호출 전 반드시 앱 승인 절차를 거칠 것) ----

/** 파일 이름·부모 폴더 조회 (승인 창에 파일명을 보여주기 위함). */
export async function driveFileMeta(fileId) {
  return gget(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`,
  );
}

/** 사본 만들기. */
export async function driveCopy(fileId, newName, folderId) {
  const body = { ...(newName ? { name: newName } : {}), ...(folderId ? { parents: [folderId] } : {}) };
  return gpost(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true&fields=id,name,webViewLink`,
    body,
  );
}

/** 이름 변경. */
export async function driveRename(fileId, newName) {
  return gpost(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name`,
    { name: newName },
    'PATCH',
  );
}

/** 다른 폴더로 이동. */
export async function driveMove(fileId, targetFolderId) {
  const meta = await driveFileMeta(fileId);
  const remove = (meta.parents ?? []).join(',');
  const u =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?addParents=${encodeURIComponent(targetFolderId)}${remove ? `&removeParents=${encodeURIComponent(remove)}` : ''}` +
    `&supportsAllDrives=true&fields=id,name,parents`;
  return gpost(u, {}, 'PATCH');
}

// 삭제·휴지통 기능은 정책상 제공하지 않는다 — 삭제가 필요하면 이름에 [삭제용] 을 붙여 표시하고 사람이 지운다.
