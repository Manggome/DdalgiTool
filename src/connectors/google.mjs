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
        // 들여쓰기(36pt=1단계)와 목록 중첩을 함께 표현한다 — 적용 결과를 읽기로 검증할 수 있게.
        const indentPt = el.paragraph.paragraphStyle?.indentStart?.magnitude || 0;
        const indentLv = Math.round(indentPt / 36);
        if (h) {
          lines.push(`${'#'.repeat(Number(h[1]))} ${text}`);
        } else if (el.paragraph.bullet) {
          // 불릿은 기본 36pt 가 있으므로 초과분만 중첩으로 센다.
          const nest = Math.max(el.paragraph.bullet.nestingLevel || 0, Math.max(0, indentLv - 1));
          lines.push(`${'  '.repeat(nest)}- ${text}`);
        } else {
          lines.push(`${'  '.repeat(indentLv)}${text}`);
        }
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

/** 이름 있는 문단 스타일 매핑 (도구 입력은 한국어). */
export const DOC_NAMED_STYLES = {
  제목: 'TITLE',
  부제: 'SUBTITLE',
  제목1: 'HEADING_1',
  제목2: 'HEADING_2',
  제목3: 'HEADING_3',
  제목4: 'HEADING_4',
  제목5: 'HEADING_5',
  제목6: 'HEADING_6',
  본문: 'NORMAL_TEXT',
};

/**
 * find 문구가 포함된 문단에 이름 있는 스타일(제목1 등)을 적용한다.
 * all=false 면 첫 번째 일치 문단만. 적용한 문단 수를 돌려준다.
 * 호출 전 반드시 앱 승인 절차를 거칠 것.
 */
export async function docSetParagraphStyle(docId, find, styleKo, all = false) {
  const named = DOC_NAMED_STYLES[styleKo];
  if (!named) throw new Error(`지원하지 않는 스타일: ${styleKo} (가능: ${Object.keys(DOC_NAMED_STYLES).join(', ')})`);
  const d = await gget(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`);
  const matches = [];
  for (const el of d.body?.content ?? []) {
    if (!el.paragraph) continue;
    const text = (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? '').join('');
    if (text.includes(find)) matches.push({ start: el.startIndex, end: el.endIndex });
  }
  if (!matches.length) return 0;
  const targets = all ? matches : [matches[0]];
  await docBatch(
    docId,
    targets.map((p) => ({
      updateParagraphStyle: {
        range: { startIndex: p.start, endIndex: p.end },
        paragraphStyle: { namedStyleType: named },
        fields: 'namedStyleType',
      },
    })),
  );
  return targets.length;
}

/** 문서의 문단 목록 [{text,start,end}] — find 매칭용 공통 헬퍼. */
async function docParagraphs(docId) {
  const d = await gget(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`);
  const out = [];
  for (const el of d.body?.content ?? []) {
    if (!el.paragraph) continue;
    const text = (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? '').join('');
    out.push({ text, start: el.startIndex, end: el.endIndex, bullet: !!el.paragraph.bullet });
  }
  return out;
}

/**
 * find 문구가 포함된 문단의 들여쓰기를 level 단계(1단계=36pt, 독스 UI 들여쓰기 버튼과 동일)로 맞춘다.
 * level 0 = 들여쓰기 해제. 호출 전 반드시 앱 승인 절차를 거칠 것.
 */
export async function docSetIndent(docId, find, level, all = false) {
  const lv = Math.max(0, Math.min(5, Number(level) || 0));
  const paras = await docParagraphs(docId);
  const matches = paras.filter((p) => p.text.includes(find));
  if (!matches.length) return 0;
  const targets = all ? matches : [matches[0]];
  await docBatch(
    docId,
    targets.map((p) => {
      // 불릿 문단은 기본 들여쓰기가 이미 36pt 이므로, 단계를 그 위에 얹어야 실제로 밀린다.
      const base = p.bullet ? 36 : 0;
      const pt = base + lv * 36;
      return {
        updateParagraphStyle: {
          range: { startIndex: p.start, endIndex: p.end },
          paragraphStyle: {
            indentStart: { magnitude: pt, unit: 'PT' },
            indentFirstLine: { magnitude: pt, unit: 'PT' },
          },
          fields: 'indentStart,indentFirstLine',
        },
      };
    }),
  );
  return targets.length;
}

const BULLET_PRESETS = {
  불릿: 'BULLET_DISC_CIRCLE_SQUARE',
  번호: 'NUMBERED_DECIMAL_ALPHA_ROMAN',
  체크박스: 'BULLET_CHECKBOX',
};

/**
 * find 문단(through 지정 시 그 문단까지의 범위)을 목록으로 만들거나(remove=false) 해제한다.
 * 중첩 단계는 문단 들여쓰기를 따른다 — 깊게 넣으려면 docSetIndent 후 적용.
 * 호출 전 반드시 앱 승인 절차를 거칠 것.
 */
export async function docSetBullets(docId, find, { through, style = '불릿', remove = false } = {}) {
  const paras = await docParagraphs(docId);
  const first = paras.find((p) => p.text.includes(find));
  if (!first) return { ok: false, reason: `"${find}" 문단 없음` };
  let end = first.end;
  if (through) {
    const last = paras.find((p) => p.start >= first.start && p.text.includes(through));
    if (!last) return { ok: false, reason: `"${through}" 문단 없음 (find 이후 범위)` };
    end = last.end;
  }
  const range = { startIndex: first.start, endIndex: end };
  if (remove) {
    await docBatch(docId, [{ deleteParagraphBullets: { range } }]);
  } else {
    const preset = BULLET_PRESETS[style];
    if (!preset) throw new Error(`지원하지 않는 목록 유형: ${style} (가능: ${Object.keys(BULLET_PRESETS).join(', ')})`);
    await docBatch(docId, [{ createParagraphBullets: { range, bulletPreset: preset } }]);
  }
  return { ok: true };
}
