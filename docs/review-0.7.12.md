# 0.7.12 수정·배포 리뷰

2026-09-21 배포한 **0.7.12**의 노트 편집 수정과 검증을 기록한다. CSS 수정 등 이전 변경은 [0.7.11 리뷰](review-0.7.11.md)를 참고한다. 최소 지원 버전은 Obsidian **1.7.2**이며 데스크톱용 플러그인이다.

## 수정 결과

`read_note`가 본문 앞에 `# 파일명`을 붙여 반환했다. 파일에 없는 줄이라, 모델이 노트를 고칠 때 이 줄까지 `edit_note`의 `find`에 넣으면 교체 대상을 찾지 못했다. 여러 노트를 연달아 고칠 때 이 실패가 반복되면 도구 루프가 멈출 수 있었다.

| 대상 | 변경 |
| --- | --- |
| `read_note` 결과 | 파일명 제목 대신 `get_active_note`와 같은 경로 안내(`경로: <path>`, 빈 줄, 원문 순서)를 붙인다. |
| 도구 설명 | `read_note`·`get_active_note`는 첫 줄이 메타정보라고 밝히고, `edit_note`는 경로 안내를 뺀 본문에서 `find`를 정확히 복사하라고 안내한다. |
| 불일치 오류 | 파일을 바꾸지 않았다는 사실과 재시도 방법을 한국어·영어·일본어로 안내한다. |

## 검증

- 보고된 세 문서 형태(`query-planner`, `btree-vs-lsm-tree`, `gc-pause-database`)로 읽기→편집 왕복 테스트를 추가했다. 수정 전에는 실패하고 수정 후 통과한다.
- CI에서 lint 오류·경고 0건, 테스트 **92개 파일·1,554개 통과**, TypeScript 검사·빌드 성공을 확인했다.
- 배포 자산 세 파일을 다운로드해 SHA-256과 빌드 출처(attestation)를 검증했다. 매니페스트 버전은 `0.7.12`이고, `styles.css`는 0.7.11과 같다.

## 교차 리뷰

배포 후 Claude와 OpenAI Codex가 0.7.12 변경분과 그 영향권을 각각 리뷰했다. 이번 수정 자체의 회귀는 두 리뷰 모두 찾지 못했다. 편집 경로에 원래 있던 다음 결함은 [PR #38](https://github.com/TeiNam/obsidian-agent-llms/pull/38)에서 고친다.

- 입력 검증: `find`만 주고 `replace` 대신 `content`를 주면 노트 전체를 조각으로 덮어쓴다. 문자열 자리의 배열이나 빠진 필수 인자도 거부하지 않는다.
- 쓰기 안전성: 부분 수정이 읽기와 쓰기 사이의 사용자 저장을 덮어쓸 수 있고, CRLF 노트에서는 여러 줄 교체가 맞지 않는다.
- 실행 확인: `save_template`·`apply_template`이 확인 대상에서 빠져 있다.
- AI 변경 원장: 쓰기 전에 멈춘 도구 실행 중의 사용자 저장을 AI 변경으로 기록하고, 원장 저장 실패가 끝난 작업을 실패로 바꾼다.
- 도구 루프: 다른 도구의 성공이 끼면 같은 도구의 반복 실패를 멈추지 못하고, 라운드 한도에 걸려도 알리지 않는다.

## 배포 검증

| 확인 항목 | 결과 |
| --- | --- |
| 수정 반영 | [PR #37](https://github.com/TeiNam/obsidian-agent-llms/pull/37) 머지, 커밋 `046c749f11955c18a1d7c42e6d5fa667c0672cc5` |
| 릴리스 소스 | 태그 `0.7.12`, 커밋 `99f4c75bc7512c3d58427f03e665e27c653dacd4`(릴리스 워크플로의 버전 증가 커밋) |
| 최종 CI | [실행 35554252198](https://github.com/TeiNam/obsidian-agent-llms/actions/runs/35554252198) 성공, 경고·오류 annotation 0건 |
| 최종 배포 | [실행 35554252225](https://github.com/TeiNam/obsidian-agent-llms/actions/runs/35554252225) 성공, 경고·오류 annotation 0건 |

두 실행에는 `ubuntu-latest`가 2026-10-19부터 Ubuntu 26으로 바뀐다는 GitHub 안내(notice)만 1건씩 남았다.

PR #37은 버전을 올리지 않았으므로 릴리스 워크플로가 버전 증가 커밋을 만들고 그 커밋에 태그를 달았다. 빌드 출처의 소스 커밋은 워크플로를 시작한 머지 커밋 `046c749`이므로, 검증할 때는 태그 커밋이 아니라 이 커밋을 지정한다.

[0.7.12 릴리스](https://github.com/TeiNam/obsidian-agent-llms/releases/tag/0.7.12)의 다운로드 파일 기준 SHA-256:

| 파일 | SHA-256 |
| --- | --- |
| `main.js` | `463977096de84b4ef21d952e4d20cf2ce9cf34d087f359c252693b66cfb61ce8` |
| `manifest.json` | `b949bc496a1eba9ee25d8a4332a14992d4f6f85d214c934a017c0164f1aaef7a` |
| `styles.css` | `d41fe89a5d7de1e291b51e8d5942e90c867b232351a72c3e7a237eae556d8b5d` |

빈 폴더에서 다음 명령으로 자산을 내려받고 빌드 출처를 확인할 수 있다.

```bash
gh release download 0.7.12 --repo TeiNam/obsidian-agent-llms \
  --pattern main.js --pattern manifest.json --pattern styles.css
for asset in main.js manifest.json styles.css; do
  gh attestation verify "$asset" \
    --repo TeiNam/obsidian-agent-llms \
    --source-digest 046c749f11955c18a1d7c42e6d5fa667c0672cc5 \
    --source-ref refs/heads/main \
    --signer-workflow TeiNam/obsidian-agent-llms/.github/workflows/release.yml
done
```

이 리뷰와 가이드의 버전 정리는 배포 이후의 문서 변경이다. 경로 필터에 따라 문서만 바뀌면 자동 버전 증가·배포를 건너뛰므로, `0.7.12` 태그와 배포 자산을 유지한다.
