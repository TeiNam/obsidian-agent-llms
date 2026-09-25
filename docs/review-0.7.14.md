# 0.7.14 수정·배포 리뷰

2026-09-25 배포한 **0.7.14** 기준으로 0.7.12 이후의 수정과 검증을 기록한다. 편집 도구의 입력 검증과 쓰기 안전성은 0.7.13에, PC 텍스트 파일 첨부와 잘림 안내는 0.7.14에 반영했다. 0.7.12의 수정은 [0.7.12 리뷰](review-0.7.12.md)를 참고한다. 최소 지원 버전은 Obsidian **1.7.2**이며 데스크톱용 플러그인이다.

## 0.7.13 수정 결과

[0.7.12 리뷰](review-0.7.12.md)의 교차 리뷰에서 나온 편집 경로의 기존 결함을 고쳤다.

| 항목 | 수정 |
| --- | --- |
| 도구 인자 검증 | 스키마가 문자열로 정한 인자가 빠졌거나 문자열이 아니면 `execute()`에서 거부한다. 문자열 자리의 배열이 빈 `find` 가드를 우회해 노트를 글자 단위로 쪼개거나, 빠진 `content`가 `undefined`로 붙던 문제를 모든 내장 도구에서 막는다. `null` 인자는 생략으로 본다. |
| find·replace 짝 | 한쪽만 오면 거부한다. 이전에는 `find`와 `content`를 함께 주면 전체 교체로 넘어가 노트가 조각으로 바뀌었다. |
| 부분 수정 쓰기 | `vault.process` 안에서 다시 읽은 최신 본문에 적용해, 읽기와 쓰기 사이의 사용자 저장을 덮어쓰지 않는다. CRLF 노트에서도 LF로 보낸 여러 줄 `find`를 찾고 줄바꿈을 유지한다. 결과에 교체 횟수를 표시한다. |
| 실행 확인 | `save_template`·`apply_template`을 확인 대상에 넣었다. AI 변경 원장이 추적하는 도구와 확인 대상이 어긋나면 실패하는 테스트를 추가했다. |
| AI 변경 원장 | 오류를 돌려주고 쓰기 전에 멈춘 실행은 기록하지 않는다. 기록·저장 실패는 로그만 남기고, 끝난 작업을 실패로 바꾸지 않는다. |
| 도구 루프 | 다른 도구의 성공이 끼어도 같은 도구가 세 번 실패하면 멈춘다. 10라운드 한도에 걸리면 안내를 띄우고, 남은 "생각 중" 표시를 지운다. |

## 0.7.14 추가 기능

| 항목 | 변경 |
| --- | --- |
| PC 텍스트 파일 첨부 | 파일 선택기·드래그앤드롭·붙여넣기가 볼트 노트 첨부와 같은 텍스트 형식(`md`·`txt`·`json`·`yaml`·`csv`·`xml`·`html`·`css`·`js`·`ts`)을 받는다. 파일 선택창의 목록도 같은 출처에서 만든다. 드래그한 파일은 채팅 입력 영역에 놓는다. |
| 잘림 안내 | 텍스트 첨부는 파일당 앞 8,000자만 보낸다. 넘치면 전체 길이와 보낸 범위를 프롬프트에 적고, 파일 칩에 가위 아이콘과 툴팁을 단다. 파일 검색으로 붙인 볼트 노트와 자동 첨부된 현재 노트에도 적용된다. |

## 검증

- 0.7.13: 결함 6건을 수정 전 코드에서 재현한 뒤, 같은 경로에 회귀 테스트 13개를 추가했다.
- 0.7.14: 테스트 7개를 먼저 작성했고, 기능을 추가하는 4개가 구현 전에 실패하는 것을 확인했다.
- 두 변경을 합친 트리에서 테스트와 TypeScript 검사를 통과한 뒤 머지했다.
- CI에서 lint 오류·경고 0건, TypeScript 검사·빌드 성공을 확인했다. 테스트는 0.7.13에서 **92개 파일·1,567개**, 0.7.14에서 **92개 파일·1,574개** 통과했다.
- 두 릴리스의 배포 자산을 내려받아 SHA-256과 빌드 출처(attestation)를 검증했다. 매니페스트 버전은 각각 `0.7.13`·`0.7.14`이고, `styles.css`는 0.7.12와 같다.

실제 Obsidian 앱에서의 확인(CRLF 노트 편집, 템플릿 도구의 확인 창, 라운드 한도 안내, Finder에서의 드래그 첨부, 잘림 표시)은 이 검증에 포함하지 않았다.

## 배포 검증

| 확인 항목 | 0.7.13 | 0.7.14 |
| --- | --- | --- |
| 수정 반영 | [PR #38](https://github.com/TeiNam/obsidian-agent-llms/pull/38) 머지, 커밋 `b62b4ae0786d10ffeb346062d1bff1ca5fbda5bd` | [PR #40](https://github.com/TeiNam/obsidian-agent-llms/pull/40) 머지, 커밋 `1635b8ddb7ea996f8311d4e7be51b6cf2b21859c` |
| 릴리스 태그 | `0.7.13`, 버전 증가 커밋 `d10f3b77900b844f50c8061400c36e0d80bf2f3e` | `0.7.14`, 버전 증가 커밋 `6c386bc1081ddb1356f380c4651b6d6d36ef7afe` |
| CI | [실행 36116029514](https://github.com/TeiNam/obsidian-agent-llms/actions/runs/36116029514) 성공 | [실행 36116192406](https://github.com/TeiNam/obsidian-agent-llms/actions/runs/36116192406) 성공 |
| 배포 | [실행 36116029570](https://github.com/TeiNam/obsidian-agent-llms/actions/runs/36116029570) 성공 | [실행 36116192362](https://github.com/TeiNam/obsidian-agent-llms/actions/runs/36116192362) 성공 |

네 실행 모두 경고·오류 annotation은 0건이다. `ubuntu-latest`가 2026-10-19부터 Ubuntu 26으로 바뀐다는 GitHub 안내(notice)만 1건씩 남았다.

두 PR 모두 버전을 올리지 않았으므로 릴리스 워크플로가 버전 증가 커밋을 만들고 그 커밋에 태그를 달았다. 빌드 출처의 소스 커밋은 각 PR의 머지 커밋이므로, 검증할 때는 태그 커밋이 아니라 머지 커밋을 지정한다. 릴리스 워크플로는 실행 시점의 `main`을 체크아웃하므로, 0.7.13 배포가 끝난 뒤 PR #40을 머지해 두 배포가 섞이지 않게 했다.

[0.7.14 릴리스](https://github.com/TeiNam/obsidian-agent-llms/releases/tag/0.7.14)의 다운로드 파일 기준 SHA-256:

| 파일 | SHA-256 |
| --- | --- |
| `main.js` | `6dee969515854cc85e529a7b9ebe6e40906979d3fe973f43b9a58566459edce7` |
| `manifest.json` | `b42c7ff94018a456266e944999254bd60b0fcc64f81c3b77a77f353d7a697cff` |
| `styles.css` | `d41fe89a5d7de1e291b51e8d5942e90c867b232351a72c3e7a237eae556d8b5d` |

[0.7.13 릴리스](https://github.com/TeiNam/obsidian-agent-llms/releases/tag/0.7.13)의 다운로드 파일 기준 SHA-256:

| 파일 | SHA-256 |
| --- | --- |
| `main.js` | `f5d0feb562f9d69f214a0923fe05ecd4d4e354320d7785d702ea65e86bcb81f6` |
| `manifest.json` | `2b9e4dc50810e98c3e3eb722628287b1c6f8e243cdc82084d052a1ee19e8c91c` |
| `styles.css` | `d41fe89a5d7de1e291b51e8d5942e90c867b232351a72c3e7a237eae556d8b5d` |

빈 폴더에서 다음 명령으로 0.7.14 자산을 내려받고 빌드 출처를 확인할 수 있다. 0.7.13은 버전을 `0.7.13`으로, 소스 커밋을 `b62b4ae0786d10ffeb346062d1bff1ca5fbda5bd`로 바꾼다.

```bash
gh release download 0.7.14 --repo TeiNam/obsidian-agent-llms \
  --pattern main.js --pattern manifest.json --pattern styles.css
for asset in main.js manifest.json styles.css; do
  gh attestation verify "$asset" \
    --repo TeiNam/obsidian-agent-llms \
    --source-digest 1635b8ddb7ea996f8311d4e7be51b6cf2b21859c \
    --source-ref refs/heads/main \
    --signer-workflow TeiNam/obsidian-agent-llms/.github/workflows/release.yml
done
```

이 리뷰와 가이드의 버전 정리는 배포 이후의 문서 변경이다. 경로 필터에 따라 문서만 바뀌면 자동 버전 증가·배포를 건너뛰므로, `0.7.14` 태그와 배포 자산을 유지한다.
