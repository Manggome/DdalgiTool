import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { loadProject } from './project.mjs';
import * as g from './connectors/google.mjs';
import * as sl from './connectors/slack.mjs';
import * as tr from './connectors/trello.mjs';

// ---- 연동 도구 (앱 내장 MCP) ----

/** 도구가 참조하는 현재 컨텍스트. main 이 작업 폴더를 바꿀 때 갱신한다. */
const toolCtx = { workDir: null };
export function setToolContext(ctx) {
  Object.assign(toolCtx, ctx);
}

/** 외부 쓰기 승인 경로. main 이 권한 모달을 연결한다. 승인 없이는 어떤 쓰기 도구도 실행되지 않는다. */
let writeApproval = async () => false;
export function setWriteApproval(fn) {
  writeApproval = fn;
}

const project = () => loadProject(toolCtx.workDir) ?? {};

/** project.yaml 에 등록된 슬랙 채널만 조회를 허용한다 (프라이버시 원칙). */
function assertChannelAllowed(channelId) {
  const chans = project().slack?.channels ?? [];
  if (!chans.length) {
    throw new Error('project.yaml 에 등록된 슬랙 채널이 없습니다. [🔗 연동 설정]에서 채널을 등록해야 조회할 수 있습니다.');
  }
  if (!chans.some((c) => c.id === channelId)) {
    const list = chans.map((c) => `${c.id}(${c.name ?? ''})`).join(', ');
    throw new Error(`채널 ${channelId} 는 project.yaml 에 등록되어 있지 않아 조회할 수 없습니다. 등록된 채널: ${list}`);
  }
}

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
const errText = (e) => ({ content: [{ type: 'text', text: '오류: ' + e.message }], isError: true });

/** 쓰기 도구 공통 래퍼 — 앱 승인(권한 모드와 무관하게 항상) 후에만 실행. */
async function approvedWrite(title, summary, run) {
  const ok = await writeApproval(title, summary);
  if (!ok) return { content: [{ type: 'text', text: '사용자가 이 쓰기 작업을 거부했습니다. 다른 방법을 논의하세요.' }], isError: true };
  return text(await run());
}

const ddalgiTools = createSdkMcpServer({
  name: 'ddalgi',
  version: '1.0.0',
  instructions:
    '딸기툴이 제공하는 구글 드라이브/독스/시트·슬랙·트렐로 연동 도구. ' +
    '쓰기 도구(update/post/create/comment)는 실행 전에 앱이 사용자 승인을 받는다.',
  tools: [
    // ---- 구글 ----
    tool(
      'drive_search',
      '구글 드라이브에서 파일을 검색합니다. project.yaml 에 폴더가 지정돼 있으면 그 폴더 안에서만 찾습니다.',
      { query: z.string().describe('검색어 (파일 이름·본문)'), scope: z.enum(['docs', 'sheets', 'all']).optional().describe('검색 범위 폴더 (기본 all)') },
      async ({ query: q, scope }) => {
        try {
          const gd = project().google_drive ?? {};
          const folders = [];
          if ((scope ?? 'all') !== 'sheets' && gd.docs_folder_id) folders.push(gd.docs_folder_id);
          if ((scope ?? 'all') !== 'docs' && gd.sheets_folder_id) folders.push(gd.sheets_folder_id);
          const files = await g.driveSearch(q, folders);
          if (!files.length) return text('검색 결과 없음' + (folders.length ? ' (project.yaml 지정 폴더 내)' : ''));
          return text(files.map((f) => `- ${f.name} [${f.mimeType.split('.').pop()}] id=${f.id} (수정 ${f.modifiedTime?.slice(0, 10)})`).join('\n'));
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'doc_read',
      '구글 독스 문서를 평문(마크다운 헤딩 유지)으로 읽습니다.',
      { doc_id: z.string().describe('문서 ID (drive_search 결과의 id)') },
      async ({ doc_id }) => {
        try {
          const d = await g.docRead(doc_id);
          return text(`# ${d.title}\n\n${d.text}${d.truncated ? '\n\n…(길어서 잘림 — 필요한 절만 다시 요청)' : ''}`);
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'slides_read',
      '구글 슬라이드(프레젠테이션)의 텍스트를 슬라이드별로 읽습니다 (발표자 노트 포함). 기획서가 슬라이드로 작성된 경우 사용.',
      { presentation_id: z.string().describe('프레젠테이션 ID (drive_search 결과의 id, [presentation] 타입)') },
      async ({ presentation_id }) => {
        try {
          const d = await g.slidesRead(presentation_id);
          return text(`# ${d.title} (${d.slideCount}장)\n\n${d.text}${d.truncated ? '\n\n…(길어서 잘림)' : ''}`);
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'sheet_read',
      '구글 시트를 읽습니다. range 를 생략하면 탭 목록과 크기(스키마 파악용)만 돌려줍니다. 전체를 한 번에 읽지 말고 헤더 행부터 확인하세요.',
      {
        spreadsheet_id: z.string().describe('시트 ID'),
        range: z.string().optional().describe("예: 'Main!A1:F1'(헤더), 'Main!A2:F50'. 생략 시 탭 목록"),
        formulas: z.boolean().optional().describe('true 면 계산값 대신 수식 원문(=VLOOKUP…)을 봅니다 — 수정 전 수식 여부 확인용'),
      },
      async ({ spreadsheet_id, range, formulas }) => {
        try {
          if (!range) {
            const m = await g.sheetMeta(spreadsheet_id);
            return text(`시트: ${m.title}\n탭:\n` + m.tabs.map((t) => `- ${t.title} (${t.rows}행 × ${t.cols}열)`).join('\n'));
          }
          const d = await g.sheetRead(spreadsheet_id, range, !!formulas);
          return text(`범위 ${d.range} (${d.rows}행${formulas ? ', 수식 원문' : ''}, 탭 구분):\n${d.tsv}`);
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'sheet_update',
      '[쓰기·승인 필요] 구글 시트의 범위에 값을 씁니다. 반드시 변경 전/후를 사용자에게 먼저 보여준 뒤 호출하세요.',
      {
        spreadsheet_id: z.string(),
        range: z.string().describe("예: 'Main!C5'"),
        values_tsv: z.string().describe('쓸 값 — 행은 줄바꿈, 셀은 탭으로 구분'),
      },
      async ({ spreadsheet_id, range, values_tsv }) => {
        try {
          const values = values_tsv.split('\n').map((r) => r.split('\t'));
          return await approvedWrite(
            '구글 시트에 쓰기',
            `시트 ${spreadsheet_id} 의 ${range} 에 ${values.length}행 기록:\n${values_tsv.slice(0, 400)}`,
            async () => {
              const d = await g.sheetUpdate(spreadsheet_id, range, values);
              return `기록 완료: ${d.updatedRange} (${d.updatedCells}셀)`;
            },
          );
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'drive_create',
      '[쓰기·승인 필요] 새 구글 독스/슬라이드/시트 파일을 만듭니다. 신규 기획서·테이블 작성용.',
      {
        title: z.string().describe('파일 이름'),
        type: z.enum(['doc', 'slides', 'sheet']),
        folder: z.enum(['docs', 'sheets']).optional().describe('만들 위치 — project.yaml 의 폴더 (기본: doc/slides→docs, sheet→sheets)'),
      },
      async ({ title, type, folder }) => {
        try {
          const gd = project().google_drive ?? {};
          const folderId = (folder ?? (type === 'sheet' ? 'sheets' : 'docs')) === 'sheets' ? gd.sheets_folder_id : gd.docs_folder_id;
          return await approvedWrite('구글 드라이브에 새 파일', `${type} 파일 "${title}" 생성${folderId ? ' (프로젝트 폴더 안)' : ''}`, async () => {
            const d = await g.driveCreate(title, type, folderId);
            return `생성 완료: ${d.name} (id=${d.id})\n${d.webViewLink || ''}`;
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'doc_append',
      '[쓰기·승인 필요] 구글 독스 문서 끝에 텍스트를 추가합니다.',
      { doc_id: z.string(), text: z.string().describe('추가할 내용 (여러 줄 가능)') },
      async ({ doc_id, text: body }) => {
        try {
          return await approvedWrite('구글 독스에 추가', `문서 ${doc_id} 끝에 추가:\n${body.slice(0, 400)}`, async () => {
            await g.docAppend(doc_id, body);
            return '추가 완료';
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'doc_replace',
      '[쓰기·승인 필요] 구글 독스에서 find 문자열을 전부 replace 로 바꿉니다. 의도한 곳만 바뀌도록 find 는 문서에서 유일한(충분히 긴) 문구를 쓰세요. 바꾸기 전에 doc_read 로 원문을 확인하세요.',
      {
        doc_id: z.string(),
        find: z.string().describe('바꿀 원문 (모든 일치 항목이 바뀝니다)'),
        replace: z.string(),
      },
      async ({ doc_id, find, replace }) => {
        try {
          return await approvedWrite('구글 독스 수정', `문서 ${doc_id} 치환:\n"${find.slice(0, 180)}"\n→ "${replace.slice(0, 180)}"`, async () => {
            const n = await g.docReplace(doc_id, find, replace);
            return n ? `치환 완료 (${n}곳)` : '일치하는 문구가 없어 아무것도 바뀌지 않았습니다 — find 문자열을 원문과 정확히 맞춰 다시 시도하세요.';
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'doc_set_style',
      '[쓰기·승인 필요] 구글 독스에서 find 문구가 포함된 문단에 이름 있는 스타일을 적용합니다 (제목 계층 정리용). find 는 대상 문단을 특정할 만큼 유일한 문구로 주세요.',
      {
        doc_id: z.string(),
        find: z.string().describe('스타일을 바꿀 문단에 들어 있는 문구'),
        style: z.enum(['제목', '부제', '제목1', '제목2', '제목3', '제목4', '제목5', '제목6', '본문']),
        all: z.boolean().optional().describe('true 면 일치하는 모든 문단에 적용 (기본: 첫 번째만)'),
      },
      async ({ doc_id, find, style, all }) => {
        try {
          return await approvedWrite(
            '구글 독스 문단 스타일',
            `문서 ${doc_id}\n"${find.slice(0, 120)}" 문단 → ${style}${all ? ' (일치 전부)' : ''}`,
            async () => {
              const n = await g.docSetParagraphStyle(doc_id, find, style, !!all);
              return n ? `적용 완료 (${n}개 문단 → ${style})` : '일치하는 문단이 없습니다 — doc_read 로 원문을 확인해 find 를 맞춰 주세요.';
            },
          );
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'doc_set_indent',
      '[쓰기·승인 필요] 구글 독스에서 find 문구가 든 문단의 들여쓰기를 level 단계로 맞춥니다 (1단계=36pt, 독스 UI와 동일. 0=해제).',
      {
        doc_id: z.string(),
        find: z.string().describe('대상 문단을 특정할 문구'),
        level: z.number().describe('0~5'),
        all: z.boolean().optional().describe('true 면 일치하는 모든 문단'),
      },
      async ({ doc_id, find, level, all }) => {
        try {
          return await approvedWrite(
            '구글 독스 들여쓰기',
            `문서 ${doc_id}\n"${find.slice(0, 120)}" 문단 → 들여쓰기 ${level}단계${all ? ' (일치 전부)' : ''}`,
            async () => {
              const n = await g.docSetIndent(doc_id, find, level, !!all);
              return n ? `적용 완료 (${n}개 문단)` : '일치하는 문단이 없습니다.';
            },
          );
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'doc_set_bullets',
      '[쓰기·승인 필요] 구글 독스에서 find 문단(through 지정 시 그 문단까지 연속 범위)을 목록(불릿/번호/체크박스)으로 만들거나 해제합니다. 중첩은 문단 들여쓰기를 따르므로 깊은 항목은 doc_set_indent 먼저.',
      {
        doc_id: z.string(),
        find: z.string().describe('목록 시작 문단의 문구'),
        through: z.string().optional().describe('목록 끝 문단의 문구 (생략 시 find 문단 하나만)'),
        style: z.enum(['불릿', '번호', '체크박스']).optional().describe('기본 불릿'),
        remove: z.boolean().optional().describe('true 면 목록 해제'),
      },
      async ({ doc_id, find, through, style, remove }) => {
        try {
          const what = remove ? '목록 해제' : `${style ?? '불릿'} 목록 적용`;
          return await approvedWrite(
            '구글 독스 목록',
            `문서 ${doc_id}\n"${find.slice(0, 80)}"${through ? ` ~ "${through.slice(0, 80)}"` : ''} → ${what}`,
            async () => {
              const r = await g.docSetBullets(doc_id, find, { through, style: style ?? '불릿', remove: !!remove });
              return r.ok ? `${what} 완료` : `실패: ${r.reason} — doc_read 로 원문을 확인하세요.`;
            },
          );
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'slides_replace',
      '[쓰기·승인 필요] 구글 슬라이드 전체에서 find 문자열을 replace 로 바꿉니다. slides_read 로 원문을 먼저 확인하고, 유일한 문구로 치환하세요.',
      { presentation_id: z.string(), find: z.string(), replace: z.string() },
      async ({ presentation_id, find, replace }) => {
        try {
          return await approvedWrite('구글 슬라이드 수정', `프레젠테이션 ${presentation_id} 치환:\n"${find.slice(0, 180)}"\n→ "${replace.slice(0, 180)}"`, async () => {
            const n = await g.slidesReplace(presentation_id, find, replace);
            return n ? `치환 완료 (${n}곳)` : '일치하는 문구가 없어 아무것도 바뀌지 않았습니다.';
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'slides_add_slide',
      '[쓰기·승인 필요] 구글 슬라이드 끝에 제목+본문 슬라이드 1장을 추가합니다.',
      { presentation_id: z.string(), title: z.string(), body: z.string().optional().describe('본문 (줄바꿈으로 불릿 구분)') },
      async ({ presentation_id, title, body }) => {
        try {
          return await approvedWrite('구글 슬라이드에 장 추가', `프레젠테이션 ${presentation_id} 에 슬라이드 추가: "${title}"`, async () => {
            await g.slidesAddSlide(presentation_id, title, body || '');
            return '슬라이드 추가 완료';
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'drive_copy',
      '[쓰기·승인 필요] 드라이브 파일의 사본을 만듭니다 (양식 복제, 백업 등).',
      {
        file_id: z.string(),
        new_name: z.string().optional().describe('사본 이름 (생략 시 "사본 - 원본이름")'),
        folder: z.enum(['docs', 'sheets']).optional().describe('사본을 둘 프로젝트 폴더 (생략 시 원본과 같은 위치)'),
      },
      async ({ file_id, new_name, folder }) => {
        try {
          const meta = await g.driveFileMeta(file_id);
          const gd = project().google_drive ?? {};
          const folderId = folder ? (folder === 'sheets' ? gd.sheets_folder_id : gd.docs_folder_id) : undefined;
          return await approvedWrite('드라이브 사본 만들기', `"${meta.name}" 의 사본 생성${new_name ? ` → "${new_name}"` : ''}`, async () => {
            const d = await g.driveCopy(file_id, new_name, folderId);
            return `사본 생성 완료: ${d.name} (id=${d.id})\n${d.webViewLink || ''}`;
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'drive_rename',
      '[쓰기·승인 필요] 드라이브 파일의 이름을 바꿉니다.',
      { file_id: z.string(), new_name: z.string() },
      async ({ file_id, new_name }) => {
        try {
          const meta = await g.driveFileMeta(file_id);
          return await approvedWrite('드라이브 이름 변경', `"${meta.name}" → "${new_name}"`, async () => {
            await g.driveRename(file_id, new_name);
            return `이름 변경 완료: ${new_name}`;
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'drive_move',
      '[쓰기·승인 필요] 드라이브 파일을 다른 폴더로 옮깁니다.',
      {
        file_id: z.string(),
        target: z.string().describe("'docs' | 'sheets' (프로젝트 폴더) 또는 대상 폴더 ID"),
      },
      async ({ file_id, target }) => {
        try {
          const gd = project().google_drive ?? {};
          const folderId = target === 'docs' ? gd.docs_folder_id : target === 'sheets' ? gd.sheets_folder_id : target;
          if (!folderId) return errText(new Error('대상 폴더를 찾을 수 없습니다.'));
          const meta = await g.driveFileMeta(file_id);
          return await approvedWrite('드라이브 파일 이동', `"${meta.name}" 을(를) ${target} 폴더로 이동`, async () => {
            await g.driveMove(file_id, folderId);
            return '이동 완료';
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'open_page',
      '웹 페이지를 앱 오른쪽 패널에 띄워 사용자에게 보여줍니다 (구글 시트/독스/트렐로 화면 확인 등). 패널에서 안 열리는 페이지는 where=browser 로 기본 브라우저를 띄웁니다.',
      {
        url: z.string().describe('http(s) 주소'),
        where: z.enum(['panel', 'browser']).optional().describe('기본 panel — 앱 오른쪽 패널'),
      },
      async ({ url, where }) => {
        try {
          if (!/^https?:\/\//.test(url)) return errText(new Error('http(s) 주소만 열 수 있습니다.'));
          if (!toolCtx.openPage) return errText(new Error('페이지 열기가 준비되지 않았습니다.'));
          const r = await toolCtx.openPage(url, where ?? 'panel');
          return text(r.where === 'browser' ? '기본 브라우저에서 열었습니다.' : '오른쪽 패널에 띄웠습니다. (로그인이 필요한 페이지면 패널 안에서 한 번 로그인하면 유지됩니다)');
        } catch (e) {
          return errText(e);
        }
      },
    ),
    // ---- 슬랙 ----
    tool(
      'slack_channels',
      'project.yaml 에 등록된 슬랙 채널 목록을 봅니다 (딸기툴은 등록된 채널만 조회할 수 있습니다).',
      {},
      async () => {
        try {
          const chans = project().slack?.channels ?? [];
          if (!chans.length) return text('등록된 채널 없음 — [🔗 연동 설정]에서 채널을 등록하세요.');
          return text(chans.map((c) => `- ${c.name ?? '?'} (${c.id})`).join('\n'));
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'slack_history',
      '등록된 슬랙 채널의 최근 메시지를 읽습니다. 각 줄 끝의 <ts:…> 는 스레드 조회용입니다.',
      {
        channel_id: z.string().describe('채널 ID (slack_channels 참고)'),
        limit: z.number().optional().describe('최대 100, 기본 50'),
        oldest: z.string().optional().describe('이 유닉스 ts 이후만'),
      },
      async ({ channel_id, limit, oldest }) => {
        try {
          assertChannelAllowed(channel_id);
          const d = await sl.slackHistory(channel_id, limit ?? 50, oldest);
          return text(`${d.count}건${d.hasMore ? ' (더 있음 — oldest 로 범위 조절)' : ''}\n${d.text}`);
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'slack_replies',
      '슬랙 스레드의 답글을 읽습니다.',
      { channel_id: z.string(), thread_ts: z.string().describe('부모 메시지의 ts') },
      async ({ channel_id, thread_ts }) => {
        try {
          assertChannelAllowed(channel_id);
          const d = await sl.slackReplies(channel_id, thread_ts);
          return text(d.text || '(답글 없음)');
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'slack_post',
      '[쓰기·승인 필요] 등록된 슬랙 채널에 메시지를 보냅니다 (아카이브 게시 등).',
      { channel_id: z.string(), text: z.string().describe('보낼 내용') },
      async ({ channel_id, text: body }) => {
        try {
          assertChannelAllowed(channel_id);
          return await approvedWrite('슬랙 메시지 발송', `채널 ${channel_id} 에 발송:\n${body.slice(0, 400)}`, async () => {
            const d = await sl.slackPost(channel_id, body);
            return `발송 완료 (ts=${d.ts})`;
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    // ---- 트렐로 ----
    tool(
      'trello_boards',
      '내 트렐로 보드 목록을 봅니다 (project.yaml 에 보드가 등록되지 않았을 때 탐색용).',
      {},
      async () => {
        try {
          const d = await tr.trelloBoards();
          return text(d.map((b) => `- ${b.name} (${b.id}) ${b.url}`).join('\n') || '(보드 없음)');
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'trello_board_cards',
      '트렐로 보드의 리스트·카드 요약을 봅니다. board_id 생략 시 project.yaml 의 첫 보드.',
      { board_id: z.string().optional() },
      async ({ board_id }) => {
        try {
          const id = board_id || project().trello?.boards?.[0]?.id;
          if (!id) return text('보드가 지정되지 않았습니다 — [🔗 연동 설정]에서 보드를 등록하세요.');
          const d = await tr.trelloBoardCards(id);
          return text(d.text);
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'trello_card',
      '트렐로 카드 하나의 상세(설명 전문 + 코멘트)를 봅니다.',
      { card_id: z.string().describe('trello_board_cards 결과의 [id]') },
      async ({ card_id }) => {
        try {
          const c = await tr.trelloCard(card_id);
          return text(`# ${c.name}\n라벨: ${c.labels.join(', ') || '없음'} · ${c.url}\n\n## 설명\n${c.desc}\n\n## 코멘트\n${c.comments}`);
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'trello_card_create',
      '[쓰기·승인 필요] 트렐로 리스트에 카드를 만듭니다 (QA 케이스 등록 등).',
      { list_id: z.string().describe('trello_lists 결과의 id'), name: z.string(), desc: z.string().optional() },
      async ({ list_id, name, desc }) => {
        try {
          return await approvedWrite('트렐로 카드 생성', `리스트 ${list_id} 에 카드 "${name}" 생성`, async () => {
            const d = await tr.trelloCardCreate(list_id, name, desc);
            return `카드 생성 완료: ${d.url}`;
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'trello_card_comment',
      '[쓰기·승인 필요] 트렐로 카드에 코멘트를 남깁니다.',
      { card_id: z.string(), text: z.string() },
      async ({ card_id, text: body }) => {
        try {
          return await approvedWrite('트렐로 코멘트', `카드 ${card_id} 에 코멘트:\n${body.slice(0, 300)}`, async () => {
            await tr.trelloCardComment(card_id, body);
            return '코멘트 완료';
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'trello_card_update',
      '[쓰기·승인 필요] 트렐로 카드를 변경합니다 — 리스트 이동, 이름 변경. (카드 삭제·보관은 지원하지 않습니다 — 필요하면 이름 앞에 [삭제용] 을 붙이세요.)',
      {
        card_id: z.string(),
        list_id: z.string().optional().describe('옮길 리스트 (trello_lists 참고)'),
        name: z.string().optional().describe('새 카드 이름'),
      },
      async ({ card_id, list_id, name }) => {
        try {
          if (!list_id && !name) return errText(new Error('바꿀 항목(list_id/name)을 하나 이상 지정하세요.'));
          const changes = [list_id ? `리스트 이동 → ${list_id}` : '', name ? `이름 → "${name}"` : '']
            .filter(Boolean)
            .join(' · ');
          return await approvedWrite('트렐로 카드 변경', `카드 ${card_id}: ${changes}`, async () => {
            const d = await tr.trelloCardUpdate(card_id, { listId: list_id, name });
            return `변경 완료: ${d.name}`;
          });
        } catch (e) {
          return errText(e);
        }
      },
    ),
    tool(
      'trello_lists',
      '트렐로 보드의 리스트(컬럼) 목록을 봅니다. board_id 생략 시 project.yaml 의 첫 보드.',
      { board_id: z.string().optional() },
      async ({ board_id }) => {
        try {
          const id = board_id || project().trello?.boards?.[0]?.id;
          if (!id) return text('보드가 지정되지 않았습니다.');
          const d = await tr.trelloLists(id);
          return text(d.map((l) => `- ${l.name} (${l.id})`).join('\n'));
        } catch (e) {
          return errText(e);
        }
      },
    ),
  ],
});

/**
 * 프리셋(claude_code) 뒤에 덧붙이는 지침.
 * 세부 절차는 앱에 내장된 skills 폴더의 SKILL.md 가 담당한다 (필요할 때만 읽어 토큰을 아낀다).
 */
function buildAppendPrompt(knowledgeDir, skillsDir) {
  return [
    '## 딸각기획 (딸기툴 🍓)',
    '당신은 게임 기획자를 돕는 **딸각기획** 에이전트입니다.',
    '기획서·데이터 테이블·밸런스·QA·프로젝트 탐색을 자연어 대화로 처리합니다.',
    '사용자는 개발자가 아닌 기획자일 수 있습니다. 코드 용어가 아니라 기획 용어로 대화하세요.',
    '',
    '## 스킬 (필요할 때만 읽습니다 — 전부 미리 읽지 마세요)',
    `요청이 아래 업무에 해당하면, 작업 전에 해당 스킬의 SKILL.md 를 Read 로 읽고 그 절차를 따르세요.`,
    `- 기획서 (읽기/작성/검수):        ${skillsDir}/design-doc/SKILL.md`,
    `- 데이터 테이블 (수정/검수/생성):  ${skillsDir}/data-table/SKILL.md`,
    `- 밸런스 검증·시뮬레이션:         ${skillsDir}/balance/SKILL.md`,
    `- 탐색·영향도·정합성 검사:        ${skillsDir}/explore/SKILL.md`,
    `- QA 테스트 케이스:              ${skillsDir}/qa/SKILL.md`,
    `- 아카이빙·의사결정 기록:         ${skillsDir}/archive/SKILL.md`,
    'SKILL.md 가 가리키는 references/ 문서는 그 단계가 실제로 필요할 때만 읽습니다.',
    `도구 전반의 규칙은 ${knowledgeDir}/도구지침.md 에 있습니다. 첫 턴에 한 번 읽어 두세요.`,
    '',
    '## 연동 도구 (mcp__ddalgi__*)',
    '구글 드라이브/독스/시트·슬랙·트렐로는 아래 내장 도구로 접근합니다 (WebFetch 로 열지 마세요):',
    '- 구글 읽기: drive_search → doc_read(독스) / slides_read(슬라이드) / sheet_read(범위 생략=탭 목록)',
    '- 구글 쓰기[승인]: sheet_update / doc_replace·doc_append·doc_set_style·doc_set_indent·doc_set_bullets(독스 수정·제목/들여쓰기/목록) / slides_replace·slides_add_slide(슬라이드 수정) / drive_create(새 독스·슬라이드·시트)',
    '- 구글 파일 관리[승인]: drive_copy(사본) / drive_rename(이름 변경) / drive_move(폴더 이동)',
    '- **삭제 금지**: 어떤 파일·카드도 삭제·보관하지 않습니다. 삭제가 필요해 보이면 drive_rename/trello_card_update 로 이름 앞에 `[삭제용] ` 을 붙여 표시만 하고, 실제 삭제는 사람이 합니다.',
    '- open_page: 사용자가 화면으로 직접 확인해야 할 때(시트·문서·트렐로 보드) 해당 URL 을 오른쪽 패널에 띄웁니다.',
    '',
    '## 시트 수식 규칙',
    '- 시트를 수정하기 전, 대상 컬럼에 수식이 있는지 sheet_read 의 formulas=true 로 먼저 확인합니다.',
    '- 수식이 있는 컬럼에 새 행을 채울 때는 값을 하드코딩하지 말고 **같은 수식 패턴**(행 번호만 조정)으로 씁니다.',
    '- VLOOKUP 등 룩업으로 채워지는 name/desc 류 컬럼이 비어 있거나 #N/A·null 이면, 원본 localize(현지화) 테이블에 키가 없는 것입니다 — localize 테이블에 신규 키 행 추가를 제안하고 승인받아 진행합니다. 룩업 셀을 값으로 덮어쓰지 않습니다.',
    '',
    '## 깃 (유니티 프로젝트)',
    '- project.yaml 의 unity.project_path 저장소는 Bash 로 조회합니다: `git -C <경로> log --oneline -20`, `git -C <경로> log -p -- <파일>`, blame 등.',
    '- 깃은 **읽기 전용**입니다 — commit/push/checkout 등 상태를 바꾸는 명령은 실행하지 않습니다.',
    '- 슬랙: slack_channels / slack_history / slack_replies / slack_post[쓰기] — project.yaml 에 등록된 채널만',
    '- 트렐로: trello_boards / trello_board_cards / trello_card / trello_lists / trello_card_create[쓰기] / trello_card_comment[쓰기]',
    '쓰기 도구는 호출 시 앱이 사용자 승인을 자동으로 받습니다 — 그래도 호출 전에 무엇을 바꿀지 대화로 먼저 보여 주세요.',
    '도구가 "연결되어 있지 않습니다" 오류를 주면 사용자에게 [🔗 연동 설정]을 안내하고 그 소스 없이 진행할지 물어보세요.',
    '',
    '## 철칙',
    '- **카탈로그 우선**: 외부 소스를 조회하기 전에 작업 폴더의 `.ddalgi/index/catalog.md` 를 먼저 Read 하세요 —',
    '  어떤 문서·시트 탭·채널·카드가 있는지 담겨 있어 표적 조회가 가능합니다. (파일이 없으면 그냥 진행)',
    '- **전체 스캔 금지**: 필요한 자료를 먼저 분류하고, 분류된 것 중 필요한 것만 조회합니다.',
    '- **근거 인용**: 답변에는 출처(문서명·시트명·파일 경로·라인)를 명시합니다. 지어내지 않습니다.',
    '- **수치는 코드로**: 밸런스·통계 계산은 머리로 하지 않고, 코드를 만들어 실행한 결과로 답합니다.',
    '- **쓰기는 신중히**: 문서·테이블·외부 서비스를 바꾸기 전에 무엇을 어떻게 바꿀지 먼저 보여 줍니다.',
    '- 프로젝트 설정은 작업 폴더의 `.ddalgi/project.yaml` 에 있습니다 (있으면 먼저 확인).',
    '',
    '## 작업 방식',
    '- 모든 설명과 질문은 한국어로 합니다. 표는 마크다운 표로 씁니다.',
    '- 파일을 고칠 때는 전체를 다시 쓰지 말고 Edit 으로 필요한 부분만 바꿉니다.',
    '- 수정 후에는 무엇을 바꿨는지 2~3줄로 요약합니다. 파일 전문을 채팅에 붙여넣지 않습니다.',
    '- 이미 읽은 파일을 같은 목적으로 다시 읽지 않습니다. 서로 의존하지 않는 셸 명령은 한 번의 Bash 호출로 묶습니다.',
    '',
    '## 토큰 절약 (매 호출마다 컨텍스트 전체가 다시 전송됩니다)',
    '- 큰 파일은 통째로 읽지 말고 Grep 으로 위치를 찾아 필요한 구간만 읽습니다.',
    '- 시트·테이블은 스키마(헤더)를 먼저 보고 필요한 행만 조회합니다.',
    '- 대량 읽기가 필요하면 서브에이전트(Task)로 격리해 요약만 받아옵니다.',
    '',
    '## HTML 패널',
    '- 밸런스 시뮬레이터나 검수 리포트를 HTML 파일로 만들면 앱 오른쪽 패널에 자동으로 나타나고,',
    '  파일이 저장될 때마다 자동 새로고침됩니다. 브라우저를 따로 띄우지 마세요.',
    '- `[미리보기 오류]` 가 전달되면 다른 작업보다 먼저 그 원인을 찾아 고칩니다.',
  ].join('\n');
}

/** 연동 읽기 도구 — 확인 없이 허용 (외부에 흔적을 남기지 않는다). */
const DDALGI_READ_TOOLS = [
  'mcp__ddalgi__drive_search',
  'mcp__ddalgi__doc_read',
  'mcp__ddalgi__slides_read',
  'mcp__ddalgi__sheet_read',
  'mcp__ddalgi__slack_channels',
  'mcp__ddalgi__slack_history',
  'mcp__ddalgi__slack_replies',
  'mcp__ddalgi__open_page',
  'mcp__ddalgi__trello_boards',
  'mcp__ddalgi__trello_board_cards',
  'mcp__ddalgi__trello_card',
  'mcp__ddalgi__trello_lists',
];
/** 연동 쓰기 도구 — 도구 내부에서 항상 앱 승인(권한 모드 무관)을 거치므로 allowedTools 에 넣는다. */
const DDALGI_WRITE_TOOLS = [
  'mcp__ddalgi__sheet_update',
  'mcp__ddalgi__drive_create',
  'mcp__ddalgi__doc_append',
  'mcp__ddalgi__doc_replace',
  'mcp__ddalgi__doc_set_style',
  'mcp__ddalgi__doc_set_indent',
  'mcp__ddalgi__doc_set_bullets',
  'mcp__ddalgi__slides_replace',
  'mcp__ddalgi__slides_add_slide',
  'mcp__ddalgi__drive_copy',
  'mcp__ddalgi__drive_rename',
  'mcp__ddalgi__drive_move',
  'mcp__ddalgi__trello_card_update',
  'mcp__ddalgi__slack_post',
  'mcp__ddalgi__trello_card_create',
  'mcp__ddalgi__trello_card_comment',
];
const ALL_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', ...DDALGI_READ_TOOLS, ...DDALGI_WRITE_TOOLS];
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', ...DDALGI_READ_TOOLS, ...DDALGI_WRITE_TOOLS];

/**
 * 권한 모드별 옵션.
 * - bypassPermissions: 모두 자동 승인 (확인 창 없음)
 * - acceptEdits: 파일 편집은 자동, 명령 실행·웹 조회는 확인
 * - default: 읽기만 자동, 나머지는 매번 확인
 * - plan: 계획만 세우고 실행하지 않음
 */
function permissionOptions(mode, canUseTool) {
  const m = mode || 'bypassPermissions';
  if (m === 'bypassPermissions') {
    return {
      allowedTools: ALL_TOOLS,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };
  }
  return {
    // allowedTools 는 '묻지 않고 허용할 도구' 목록이다. 확인이 필요한 모드에서는 읽기만 넣는다.
    allowedTools: [...READ_ONLY_TOOLS],
    permissionMode: m,
    ...(canUseTool ? { canUseTool } : {}),
  };
}

/** 입력 프롬프트를 스트림으로 밀어 넣는 큐. */
class InputQueue {
  items = [];
  waiters = [];
  closed = false;

  push(m) {
    const w = this.waiters.shift();
    if (w) w({ value: m, done: false });
    else this.items.push(m);
  }

  close() {
    this.closed = true;
    let w;
    while ((w = this.waiters.shift())) w({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        const it = this.items.shift();
        if (it) return Promise.resolve({ value: it, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((res) => this.waiters.push(res));
      },
    };
  }
}

/**
 * 살아있는 query() 스트림을 재사용하는 세션.
 * 작업 폴더·모델·추가 디렉터리가 그대로면 프로세스를 다시 띄우지 않고 프롬프트만 흘려보낸다.
 */
export class WarmSession {
  q = null;
  input = null;
  baseSig = '';
  liveSessionId = '';
  active = null;
  lastRateLimit;

  base(o) {
    return JSON.stringify([
      o.workDir,
      o.model,
      o.knowledgeDir,
      o.skillsDir,
      o.permissionMode,
      [...(o.additionalDirectories ?? [])].sort(),
    ]);
  }

  canReuse(o) {
    if (!this.q) return false;
    if (this.baseSig !== this.base(o)) return false;
    if (o.sessionId && o.sessionId !== this.liveSessionId) return false;
    return true;
  }

  start(o) {
    const input = new InputQueue();
    this.input = input;
    this.baseSig = this.base(o);
    this.liveSessionId = o.sessionId ?? '';

    const q = query({
      prompt: input,
      options: {
        cwd: o.workDir,
        model: o.model || 'claude-sonnet-5',
        ...(o.additionalDirectories?.length ? { additionalDirectories: o.additionalDirectories } : {}),
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: buildAppendPrompt(o.knowledgeDir, o.skillsDir),
        },
        mcpServers: { ddalgi: ddalgiTools },
        ...permissionOptions(o.permissionMode, o.canUseTool),
        ...(o.sessionId ? { resume: o.sessionId } : {}),
      },
    });
    this.q = q;
    void this.loop(q);
  }

  /** 스트림 수명 전체에 걸쳐 메시지를 읽어 현재 활성 턴으로 넘긴다. */
  async loop(q) {
    try {
      for await (const message of q) {
        const t = this.active;
        if (message.type === 'assistant') {
          this.liveSessionId = message.session_id;
          const content = message.message.content;
          if (t && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                t.text += block.text;
                t.onText(block.text);
              } else if (block.type === 'thinking') {
                // 사고 원문. 완료된 블록 단위로 도착한다(구간에 따라 아예 안 올 수도 있다).
                t.onThinking(block.thinking || '');
              } else if (block.type === 'tool_use') {
                t.toolCounts[block.name] = (t.toolCounts[block.name] || 0) + 1;
                t.onToolUse(block.name, block.input, block.id);
              }
            }
          }
        } else if (message.type === 'user') {
          // 도구 실행 결과. 어떤 단계가 끝났는지 UI 에 알려 준다.
          const content = message.message?.content;
          if (t && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_result') t.onToolDone(block.is_error === true);
            }
          }
        } else if (message.type === 'tool_progress') {
          // 오래 걸리는 도구의 경과 시간·하트비트
          if (t) t.onToolProgress(message.tool_use_id, message.tool_name, message.elapsed_time_seconds);
        } else if (message.type === 'system' && message.subtype === 'status') {
          // 컨텍스트 압축(/compact) 같은 내부 작업 진행 상태
          if (t) t.onStatus(message.status, message.compact_result, message.compact_error);
        } else if (message.type === 'system' && message.subtype === 'thinking_tokens') {
          // SDK 가 스피너용으로 보내 주는 사고 진행 신호
          if (t) t.onThinkingTokens(message.estimated_tokens || 0);
        } else if (message.type === 'rate_limit_event') {
          this.lastRateLimit = message.rate_limit_info;
          if (t) t.rateLimit = message.rate_limit_info;
        } else if (message.type === 'result') {
          this.liveSessionId = message.session_id;
          if (t) {
            t.usage = message.usage;
            t.costUsd = message.total_cost_usd;
            t.numTurns = message.num_turns;
            if (message.subtype === 'success') t.text = message.result;
            this.settle(t);
          }
        }
      }
    } catch (e) {
      if (this.active) this.settle(this.active, e);
    }
    if (this.q === q) {
      this.q = null;
      this.input = null;
      this.baseSig = '';
    }
  }

  settle(t, err) {
    if (t.settled) return;
    t.settled = true;
    if (this.active === t) this.active = null;
    if (err && !t.aborted) {
      t.reject(err);
      return;
    }
    t.resolve({
      sessionId: this.liveSessionId,
      resultText: t.text,
      aborted: t.aborted,
      usage: t.usage,
      costUsd: t.costUsd,
      rateLimit: t.rateLimit ?? this.lastRateLimit,
      numTurns: t.numTurns,
      toolCounts: t.toolCounts,
    });
  }

  /** 한 턴 실행. */
  async ask(o) {
    if (!this.canReuse(o)) {
      await this.reset();
      this.start(o);
    }
    return await new Promise((resolve, reject) => {
      this.active = {
        onText: o.onText,
        onToolUse: o.onToolUse,
        onToolDone: o.onToolDone ?? (() => {}),
        onThinking: o.onThinking ?? (() => {}),
        onThinkingTokens: o.onThinkingTokens ?? (() => {}),
        onToolProgress: o.onToolProgress ?? (() => {}),
        onStatus: o.onStatus ?? (() => {}),
        resolve,
        reject,
        text: '',
        toolCounts: {},
        settled: false,
      };
      this.input.push({
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: o.prompt },
      });
    });
  }

  /** 진행 중인 턴만 중지(세션 유지). */
  async interrupt() {
    if (this.active) this.active.aborted = true;
    try {
      await this.q?.interrupt();
    } catch {
      /* 이미 끝난 스트림 */
    }
    if (this.active) this.settle(this.active);
  }

  /** 계정(플랜) 사용량. 살아있는 세션이 있을 때만 쓴다. */
  async accountUsage() {
    const fn = this.q?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (!fn) return null;
    try {
      return await fn.call(this.q);
    } catch {
      return null;
    }
  }

  async contextUsage() {
    try {
      return this.q?.getContextUsage ? await this.q.getContextUsage() : null;
    } catch {
      return null;
    }
  }

  hasLive() {
    return this.q !== null;
  }

  /** 대화 전환·새 작업 시 스트림 정리. */
  async reset() {
    const q = this.q;
    const input = this.input;
    if (this.active) {
      this.active.aborted = true;
      this.settle(this.active);
    }
    this.q = null;
    this.input = null;
    this.baseSig = '';
    try {
      input?.close();
    } catch {
      /* noop */
    }
    try {
      await q?.interrupt();
    } catch {
      /* noop */
    }
  }
}

/** 살아있는 세션이 없을 때 계정(플랜) 사용량을 조회한다. */
export async function getAccountUsage(workDir, model) {
  const ac = new AbortController();
  const stream = query({
    prompt: 'hi',
    options: { cwd: workDir, model: model || 'claude-sonnet-5', abortController: ac },
  });
  try {
    const fn = stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    const u = fn ? await fn.call(stream) : null;
    ac.abort();
    return u;
  } catch {
    try {
      ac.abort();
    } catch {
      /* noop */
    }
    return null;
  }
}

/** 살아있는 세션이 없을 때 컨텍스트 사용량을 조회한다. */
export async function getContextUsage(workDir, sessionId, model) {
  const ac = new AbortController();
  const stream = query({
    prompt: 'hi',
    options: { cwd: workDir, model: model || 'claude-sonnet-5', resume: sessionId, abortController: ac },
  });
  try {
    const u = stream.getContextUsage ? await stream.getContextUsage() : null;
    ac.abort();
    return u;
  } catch {
    try {
      ac.abort();
    } catch {
      /* noop */
    }
    return null;
  }
}
