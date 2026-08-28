# 테이블↔코드 정합성 검사

`.ddalgi/project.yaml`의 `table_code_mappings` 선언을 유일한 진실로 삼아 **스크립트로 결정적으로** 수행한다. LLM이 눈으로 대조하지 않는다.

## 매핑 선언 형식 (project.yaml)

```yaml
table_code_mappings:
  - table: "MonsterTable"        # 시트 이름
    tab: "Main"                  # 탭 이름
    key_column: "Id"             # 대조할 키 컬럼
    code_file: "Assets/Scripts/Data/MonsterId.cs"
    code_symbol: "MonsterId"     # enum/클래스명
    kind: enum                   # enum | const_class | scriptable_object
```

## 절차

1. project.yaml에서 매핑 선언을 읽는다. 사용자가 특정 테이블만 지정하면 그 항목만.
2. **시트 쪽**: 선언된 시트·탭의 key_column만 export (한 컬럼만).
3. **코드 쪽**: code_file을 읽어 kind에 맞게 파싱한다.
   - `enum`: 멤버명 추출. 명시적 값(`= 3`)이 있으면 값도 추출.
   - `const_class`: `public const` / `static readonly` 필드명과 값.
   - 파싱은 스크립트(정규식)로 수행하되, 파싱 결과 개수가 코드의 실제 멤버 수와 다를 수 있는 특이 문법(조건부 컴파일 등)이 보이면 해당 파일만 직접 읽어 확인.
4. **매칭 규칙**: 기본은 이름 완전 일치. 시트가 `MON_0042` / 코드가 `Mon0042`처럼 변환 규칙이 있으면 선언의 `transform` 필드(예: `snake_upper→pascal`)를 따른다. 선언에 없으면 규칙 추정 결과를 사용자에게 확인받고 선언 추가를 제안한다.
5. **양방향 차집합 + 값 대조**:
   - 시트에만 있음 (코드 미반영 — 빌드에 안 들어감)
   - 코드에만 있음 (시트에서 삭제됐거나 데드 코드)
   - 양쪽 있으나 명시 값 불일치 (enum 숫자 값 ≠ 시트 순번/값 컬럼)

## 리포트 형식

```
# 정합성 검사 (매핑 N건)

## MonsterTable.Id ↔ MonsterId (enum) — 불일치 3건
| 구분 | 항목 | 상세 |
|---|---|---|
| 시트에만 | MON_0107 | 시트 88행 — 코드 enum에 없음 |
| 코드에만 | MON_0009 | MonsterId.cs:12 — 시트에 없음 |
| 값 불일치 | MON_0042 | 시트 42 / enum = 41 |

## ItemTable.Id ↔ ItemId — 일치 (312건)

## 미선언 매핑 의심
- SkillTable이 존재하나 매핑 선언 없음 — Assets/Scripts/Data/SkillId.cs가 후보. 선언 추가 권장.
```

- 검사 시각과 사용한 커밋(`git rev-parse --short HEAD`)을 리포트에 기록한다.
- 수정(코드 enum 갱신 또는 시트 수정)은 이 스킬의 범위 밖 — 각각 사용자 확인 후 해당 절차로.
- 미선언 매핑을 "추정으로 검사"하지 않는 이유: 추정 매핑의 오탐이 신뢰를 깎는다. 선언을 늘리는 방향으로 유도한다.
