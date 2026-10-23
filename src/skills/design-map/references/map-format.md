# 설계 지도 형식 (`design_map_save` 의 map_json)

```json
{
  "nodes": [
    { "id": "system:shop", "type": "system", "label": "상점", "summary": "재화로 상품·패키지 구매" },
    { "id": "currency:gem", "type": "currency", "label": "젬" },
    { "id": "table:17Kc…:shop-info", "type": "table", "label": "Shop_Info", "group": "고양이 바캉스 데이터테이블",
      "ref": { "kind": "sheet", "id": "17Kc…", "tab": "Shop_Info" } },
    { "id": "doc:1QI6…", "type": "doc", "label": "패키지 기획", "ref": { "kind": "doc", "id": "1QI6…" } },
    { "id": "code:Assets/Scripts/Shop/ShopManager.cs", "type": "code", "label": "ShopManager.cs",
      "ref": { "kind": "file", "path": "Assets/Scripts/Shop/ShopManager.cs", "line": 42 } },
    { "id": "card:6941…", "type": "card", "label": "[패키지] 기획중", "ref": { "kind": "card", "id": "6941…" } }
  ],
  "edges": [
    { "from": "doc:1QI6…", "to": "system:shop", "kind": "정의", "why": "패키지 기획서 1장이 상점 패키지 규칙을 정의" },
    { "from": "system:shop", "to": "table:17Kc…:shop-info", "kind": "저장" },
    { "from": "code:Assets/Scripts/Shop/ShopManager.cs", "to": "system:shop", "kind": "구현" },
    { "from": "system:shop", "to": "currency:gem", "kind": "사용", "why": "패키지 구매에 젬 소모" }
  ]
}
```

## 노드 종류 (type)
| type | 무엇 | ref 필수 |
|---|---|---|
| system | 게임 시스템·콘텐츠 (상점, 출석, 탐험…) | 아니오 |
| currency | 재화·자원 (골드, 젬, 일꾼…) | 아니오 |
| table | 시트 탭 하나 | 예 — `{kind:'sheet', id, tab}` |
| doc | 기획서 (독스·슬라이드) | 예 — `{kind:'doc', id}` |
| code | 코드 파일 (유니티 프로젝트 기준 상대 경로) | 예 — `{kind:'file', path, line?}` |
| card | 트렐로 카드 | 예 — `{kind:'card', id}` |
| other | 그 밖 (슬랙 스레드 등) | 예 — `{kind, url}` |

## id 규칙
`종류:고유값` — 다음 갱신 때도 같은 대상이면 같은 id 가 나오게 한다.
자동 뼈대의 id(`doc:<문서id>`, `table:<시트id>:<탭슬러그>`, `code:<경로>`)를 그대로 쓴다.

## 연결 종류 (kind)
| kind | 뜻 | 예 |
|---|---|---|
| 정의 | 기획서가 시스템·규칙을 정한다 | 기획서 → 시스템 |
| 저장 | 시스템 데이터가 테이블에 있다 | 시스템 → 테이블 |
| 구현 | 코드가 시스템·테이블을 구현·읽는다 | 코드 → 시스템/테이블 |
| 사용 | 시스템이 재화·다른 시스템을 쓴다 | 시스템 → 재화 |
| 참조 | 테이블이 다른 테이블을 참조한다 (ID 참조·룩업) | 테이블 → 테이블 |
| 관련 | 그 밖에 근거 있는 관계 (트렐로 카드 ↔ 시스템 등) | 카드 → 시스템 |

`why` 에 근거를 짧게 (어느 문서 몇 장, 어떤 열, 어느 코드). 근거 없는 연결은 만들지 않는다.

## 크기
시스템 10~30개 규모를 목표로. 시트 탭은 시스템과 연결된 것만 남기고, 연결 없는 탭(바로가기·일정 등)은 빼도 된다.
코드는 시스템을 대표하는 파일(매니저·데이터 클래스) 위주로 — 모든 파일을 넣지 않는다.
