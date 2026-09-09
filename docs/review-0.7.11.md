# 0.7.11 수정·배포 리뷰

2026-09-09 배포한 **0.7.11**의 CSS 수정과 검증을 기록한다. 자격증명 저장·MCP·설정 검색과 Actions 런타임의 이전 수정은 [0.7.10 리뷰](review-0.7.10.md)를 참고한다. 최소 지원 버전은 Obsidian **1.7.2**이며 데스크톱용 플러그인이다.

## 수정 결과

[styles.css](../styles.css)에 남아 있던 `!important` 8곳을 제거하고, 실제 컨테이너를 포함한 선택자로 우선순위를 높였다.

| 대상 | 변경 및 유지되는 동작 |
| --- | --- |
| 채팅 입력창 | `.ba-input-wrapper .ba-input`과 해당 `:hover`·`:focus` 선택자로 변경했다. 투명한 배경과 테두리·그림자·윤곽선 표시를 유지한다. |
| MCP JSON 오류 | `.ba-mcp-modal .ba-mcp-editor.has-error`로 변경했다. 오류가 있으면 호버·포커스 상태에서도 오류 테두리를 유지한다. |

## 검증

- Obsidian **1.13.7**의 기본 `app.css`와 Chrome **152.0.7977.83**을 사용했다. 플러그인의 실제 생성 구조와 같은 테스트 DOM에 수정 전후 CSS를 각각 적용했다.
- 밝은·어두운 테마 × 기본·플러그인 CSS 로딩 순서 2개 × 대상 4개(채팅 입력창, MCP 정상·오류 입력창, 일반 textarea) × 상태 4개(기본·호버·포커스·누르는 상태), 총 **64개 조합**에서 계산된 스타일이 수정 전후 동일했다. 밝은·어두운 테마의 스크린샷도 시각적으로 확인했다.
- CI에서 lint 오류·경고 0건, TypeScript 검사·빌드 성공, **92개 파일·1,551개 테스트 통과**를 확인했다.
- 배포 자산 세 파일을 다운로드해 크기·SHA-256·빌드 출처(attestation)를 검증했다. 배포 `styles.css`는 저장소 파일과 일치하고 `!important`가 0개이며, 매니페스트 버전은 `0.7.11`이다.

스타일 검증 범위는 기본 CSS를 적용한 Chromium 재현 화면이다. 실제 Obsidian 앱 전체 화면과 타사 테마는 포함하지 않았다.

## 배포 검증

| 확인 항목 | 결과 |
| --- | --- |
| 수정 반영 | [PR #35](https://github.com/TeiNam/obsidian-agent-llms/pull/35) 머지 |
| 릴리스 소스 | 태그 `0.7.11`, 커밋 `21c5504e7fb45cf30a13210313f87924d78e1147` |
| 최종 CI | [실행 34370193154](https://github.com/TeiNam/obsidian-agent-llms/actions/runs/34370193154) 성공, annotation 0건 |
| 최종 배포 | [실행 34370193092](https://github.com/TeiNam/obsidian-agent-llms/actions/runs/34370193092) 성공, annotation 0건 |

[0.7.11 릴리스](https://github.com/TeiNam/obsidian-agent-llms/releases/tag/0.7.11)의 다운로드 파일 기준 SHA-256:

| 파일 | SHA-256 |
| --- | --- |
| `main.js` | `b0c175db95cc1639bec92fcbc2d507b4e45bc10e4e04a9aead43c62aac92f341` |
| `manifest.json` | `456c6e398b88dc99ba944f8e67deb052f91d9350e5583a5e69f54b4605f82bda` |
| `styles.css` | `d41fe89a5d7de1e291b51e8d5942e90c867b232351a72c3e7a237eae556d8b5d` |

빈 폴더에서 다음 명령으로 자산을 내려받고 빌드 출처를 확인할 수 있다.

```bash
gh release download 0.7.11 --repo TeiNam/obsidian-agent-llms \
  --pattern main.js --pattern manifest.json --pattern styles.css
for asset in main.js manifest.json styles.css; do
  gh attestation verify "$asset" \
    --repo TeiNam/obsidian-agent-llms \
    --source-digest 21c5504e7fb45cf30a13210313f87924d78e1147 \
    --source-ref refs/heads/main \
    --signer-workflow TeiNam/obsidian-agent-llms/.github/workflows/release.yml
done
```

이 리뷰와 가이드의 버전 정리는 배포 이후의 문서 변경이다. 기존 경로 필터에 따라 문서만 바뀌면 자동 버전 증가·배포를 건너뛰므로, `0.7.11` 태그와 배포 자산을 유지한다.
