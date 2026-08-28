# 작업 로그 스키마와 슬랙 백업 형식

## 작업 로그 (`archive/logs/YYYY-MM-DD.jsonl`)

모든 **쓰기 작업**(외부 시스템 변경 + 문서/파일 생성)은 완료 직후 1줄 append. 읽기 작업은 기록하지 않는다.

### 스키마 (1줄 = 1 JSON)
```json
{"ts":"2026-08-28T14:32:05+09:00","skill":"data-table","action":"sheet_update","target":"MonsterTable > Balance ! C42","summary":"고블린 HP 100→120","before":"100","after":"120","approved_by_user":true,"refs":["balance 시뮬레이션 /scratchpad/ttk_sim.py"]}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| ts | O | ISO8601 (로컬 타임존) |
| skill | O | 수행 스킬명 |
| action | O | `doc_update` `doc_create` `sheet_update` `sheet_create` `trello_update` `slack_post` `drive_upload` `adr_create` `slack_backup` |
| target | O | 대상 식별 (문서명·범위·카드·채널) |
| summary | O | 한 줄 한국어 요약 |
| before / after | 수정 시 | 짧은 값이면 원문, 길면 요약 |
| approved_by_user | O | 외부 쓰기는 항상 true여야 함 (false인 외부 쓰기는 존재해선 안 된다) |
| refs | - | 근거·관련 파일 경로/링크 |

### 규칙
- append only — 기존 줄 수정·삭제 금지. 잘못 기록했으면 정정 줄을 추가 (`"action":"correction","corrects_ts":...`).
- 파일이 없으면 만든다. 날짜는 로컬 기준.
- 조회·집계("이번 주 뭐 했지?")는 해당 날짜 파일들을 스크립트로 집계 — jsonl 전체를 컨텍스트에 올리지 않는다.

## 슬랙 백업 (`archive/slack/<채널명>/YYYY-MM-DD-<주제>.md`)

### 대상 선정
- 사용자가 지정한 스레드/기간.
- ADR 근거로 쓰인 스레드 (adr-template.md 규칙에 따라 자동 제안).
- "중요 대화 백업해줘"처럼 범위가 모호하면: 후보(고정된 메시지, 반응 많은 스레드, 결정 키워드)를 목록으로 제시하고 고르게 한다. 채널 전체 무차별 백업은 하지 않는다 (호출 예산 낭비 + 잡음).

### 형식
```markdown
# <주제 요약>
- 채널: #기획-전투 / 기간: 2026-08-27 ~ 2026-08-28
- 백업 시각: ... / 원본 링크: <permalink> (90일 후 만료 예상)
- 참여: 김기획, 박서버, ...

---
**김기획** 2026-08-27 14:02
원문 그대로...

**박서버** 2026-08-27 14:05 (스레드 답글)
원문 그대로...
```

### 규칙
- **원문 보존**: 요약·의역하지 않고 메시지 원문을 그대로 담는다. 맨 위에 3줄 이하 요약을 붙이는 것은 허용.
- 파일·이미지는 파일명과 링크만 기록 (다운로드는 하지 않음 — 필요 시 사용자에게 안내).
- 대량 스레드(수백 메시지) 조회는 서브에이전트로 격리해 md 파일을 직접 쓰게 하고, 메인에는 경로와 요약만 받는다.
- 백업 완료를 작업 로그에 기록 (`"action":"slack_backup"`).
- 백업 md를 드라이브에 올리거나 채널에 공유하는 것은 별도 승인 절차.
