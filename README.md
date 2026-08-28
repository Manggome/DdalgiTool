# 딸각기획 (딸기툴 🍓)

**대화만으로 게임 기획 업무를 처리하는 기획자 툴.**
Claude Agent SDK 를 내장한 Electron 앱으로, 개인 Claude 계정으로 로그인해 쓴다.
PrototypeBuilder 0.10.0 코드베이스를 포크해 만들었다.

## 하는 일 (⚡ 스킬 6종)

| 스킬 | 하는 일 |
|---|---|
| 📄 기획서 | 읽기·질문 답변 · 수정 · 예외처리 검수 · 양식 학습 후 신규 작성 |
| 📊 데이터 테이블 | 읽기·질문 답변 · 수정 · 오류 검수 · 기획서 기반 신규 작성 |
| ⚖️ 밸런스 | 테이블·코드 기반 시뮬레이션 검증 · HTML 시뮬레이터 제작 |
| 🔎 탐색·정합성 | 여러 소스에서 답 찾기 · 변경 영향도 · 테이블↔코드 불일치 검사 |
| ✅ QA | 테스트 케이스 작성 · 예외 공백 검토 · 우선순위 분류 |
| 🗂 아카이빙 | 의사결정 ADR 기록 · 작업 로그 · 히스토리 관리 |

스킬 절차서는 `src/skills/<이름>/SKILL.md`(+`references/`)에 내장되어 있고,
에이전트가 **필요할 때만 읽어** 토큰을 아낀다. 도구 전반 규칙은 `src/knowledge/도구지침.md`.

## 구조

- `src/main.mjs` — Electron 메인. 창·미리보기·권한 확인·사용량·인증
- `src/agent.mjs` — Claude Agent SDK 세션(WarmSession)과 시스템 프롬프트
- `src/renderer/` — 채팅 UI (탭·찾기·내가 한 말·작업 현황·HTML 패널)
- `src/skills/` — 기획 업무 스킬 6종 (progressive disclosure)
- `src/knowledge/도구지침.md` — 공통 규칙 (첫 턴에 1회 로딩)
- `docs/project.yaml.example` — 프로젝트 연결 설정(`.ddalgi/project.yaml`) 스키마

## 유지된 UI (PrototypeBuilder 에서)

내가 한 말 목록 · 대화 내 찾기(⌘F) · 테마 · 모델 선택 · 권한 모드 ·
컨텍스트/계정 사용량 · 작업 탭(이름 변경·고정·삭제·대기열·완료 알림) ·
이미지 붙여넣기 · 슬래시 명령 · 작업 현황 · HTML 패널(온디맨드로 변경)

## 실행·빌드

```bash
npm start          # 개발 실행
npm run dist:mac   # dmg (arm64) → dist-app/Ddalgi-<버전>-arm64.dmg
npm run dist:win   # exe (x64)  → dist-app/Ddalgi-<버전>-x64-setup.exe
```

설정 파일: `~/.ddalgi-tool/config.json` · 시작 로그: `~/.ddalgi-tool/startup.log`

## 로드맵 (다음 마일스톤)

- **M2 연동 계층** — 프로젝트 연결 마법사(Google 내부용 OAuth · Slack · Trello),
  API 사용량 가드(미터링·소프트/하드 리밋·429 백오프), 쓰기 승인 diff 패널
- **M3 인덱서 + 라우터** — SQLite 메타데이터 인덱스, Haiku 소프트 라우터
- **M4 MVP 기능 실전 검증** → **M5 아카이빙 자동화** → **M6 공증·자동 업데이트**
