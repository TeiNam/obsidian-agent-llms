# Bedrock 인증 설정 가이드

이 가이드는 **0.7.15** 기준입니다. [설치와 기본 사용법](../README-KR.md)도 함께 참고하세요.

Agent LLMs의 Bedrock 백엔드는 PC에서 아래 순서로 인증합니다. 모바일은 Bedrock API 키만 씁니다.

| 순서 | 방식 | 설정 칸 | 플랫폼 |
|---|---|---|---|
| 1 | IAM Roles Anywhere | **Roles Anywhere 프로필** — `credential_process`로 `aws_signing_helper`를 실행하는 `~/.aws/config` 프로필 이름 | PC |
| 2 | IAM Identity Center(SSO) | **SSO 프로필** — `~/.aws/config`의 SSO 프로필 이름. 미리 `aws sso login --profile <이름>` 필요 | PC |
| 3 | Bedrock API 키(베어러 토큰) | **Bedrock API 키** | PC·모바일 |

- 요청마다 앞 순서부터 시도합니다. 프로필 인증이 실패하면(인증서·helper 오류, SSO 세션 만료 등) 다음 방식으로 넘어가고, API 키로 넘어갈 때는 알림을 한 번 띄웁니다. 앞 방식이 다시 동작하면 자동으로 돌아옵니다.
- 프로필이 동작하면 API 키 칸은 비워 둬도 됩니다.
- 권한 거부·스로틀링처럼 요청 자체의 오류는 다른 방식으로 재시도하지 않습니다.
- 설정 칸에 적은 프로필만 씁니다. `[default]` 프로필·환경변수·IAM 역할 같은 SDK 기본 자격증명 체인으로는 넘어가지 않습니다.

예: Claude Code(`AWS_PROFILE`)나 Codex(`profile`)와 같은 Roles Anywhere 프로필을 쓰려면 그 프로필 이름을 그대로 넣으면 됩니다.

```ini
[profile coding-agents]
credential_process = /path/to/aws_signing_helper credential-process --certificate /path/client.crt --private-key /path/client.key --trust-anchor-arn <trust-anchor-arn> --profile-arn <profile-arn> --role-arn <role-arn>
```

프로필 이름은 비밀값이 아니므로 볼트 `data.json`에 저장되어 동기화됩니다. 인증서와 SSO 세션은 각 PC에 있어야 합니다.

## 전제조건

| 항목 | 요구사항 |
|---|---|
| AWS 계정 | 선택한 리전에서 사용할 모델에 접근할 수 있어야 합니다 |
| IAM 권한 | 아래 호출·목록 조회 권한과 API 키 사용 허용. 모델 최초 사용에 필요한 권한은 1절 참고 |
| 플러그인 | Obsidian 1.7.2 이상, PC·모바일 지원. 모바일 키 저장은 1.11.4 이상 |

```
bedrock:InvokeModelWithResponseStream
bedrock:InvokeModel
bedrock:ListFoundationModels
bedrock:ListInferenceProfiles
bedrock:CallWithBearerToken
```

`bedrock:ListInferenceProfiles`도 필요합니다. 채팅 모델은 드롭다운으로만 선택할 수 있어서, 이 권한이 없으면 목록이 비어 모델을 고를 수 없습니다.

## 1. 모델 접근 확인

상용 AWS 리전에서는 필요한 AWS Marketplace 권한이 있으면 모델 접근이 기본 활성화되며, 타사 모델을 처음 호출할 때 구독 절차가 자동으로 시작됩니다. Anthropic 모델은 최초 이용 목적 제출도 필요합니다. 권한이 있는 관리자가 먼저 모델 사용을 준비할 수 있으며, 세부 조건은 [AWS 공식 모델 접근 안내](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)를 확인하세요.

최소한 채팅 모델 하나와 임베딩 모델 하나가 필요합니다. 임베딩 모델은 볼트 인덱싱(Graph RAG)에 쓰이며, 플러그인은 Amazon Titan과 Cohere Embed 계열을 지원합니다.

터미널에서 확인하려면:

```bash
aws bedrock list-foundation-models \
  --region ap-northeast-2 \
  --by-output-modality EMBEDDING \
  --query 'modelSummaries[].modelId' \
  --output table
```

이 명령은 해당 리전의 임베딩 모델 목록을 조회하며, 실제 호출 권한이나 구독 완료를 보장하지 않습니다. AWS CLI 인증은 플러그인 설정과 별도로 준비해야 합니다. 필터는 [공식 CLI 문서](https://docs.aws.amazon.com/cli/latest/reference/bedrock/list-foundation-models.html)를 따릅니다.

## 2. API 키 발급

AWS 콘솔 → Bedrock → **API keys**에서 발급합니다.

키에는 두 종류가 있습니다.

| 종류 | 유효기간 | 용도 |
|---|---|---|
| 단기(short-term) | 세션 만료까지, 최대 12시간 | AWS가 운영 환경에 권장하는 방식. 이 플러그인에서는 만료 시 수동 교체 |
| 장기(long-term) | 발급 시 정한 만료일과 계정 정책에 따름 | AWS가 탐색·시험용으로 안내하는 방식 |

플러그인은 입력한 키를 자동 갱신하지 않습니다. [AWS 공식 API 키 안내](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html)에 따라 키 종류와 유효기간을 선택하고, 만료되면 설정에서 교체하세요.

키는 발급 직후 한 번만 표시됩니다. 그 자리에서 복사해 두세요.

> 단기 키는 발급한 IAM 주체의 권한을, 장기 키는 연결된 IAM 사용자의 권한을 사용합니다. 필요한 모델 호출·목록 조회 범위와 `bedrock:CallWithBearerToken` 허용 여부를 확인하세요.

## 3. 플러그인 설정

1. 설정 → **Agent LLMs**를 엽니다
2. **AI 백엔드**를 `Bedrock`으로 선택합니다
3. PC에서 프로필을 쓰려면 **Roles Anywhere 프로필**·**SSO 프로필**에 `~/.aws/config` 프로필 이름을 입력합니다. 둘 중 하나만 넣어도 됩니다
4. 모바일이나 대체 수단이 필요하면 **Bedrock API 키**에 발급받은 키를 붙여넣습니다 (눈 아이콘으로 값 확인 가능)
5. **AWS 리전**에 사용할 리전을 입력합니다 (예: `ap-northeast-2`). 단기 키는 발급한 리전에서만 사용할 수 있습니다
6. **Bedrock 채팅 모델**과 **Bedrock 임베딩 모델**을 드롭다운에서 고릅니다

모델 드롭다운이 비어 있으면 아래 문제 해결을 참고하세요. Obsidian 1.13 이상에서는 설정 검색으로 현재 백엔드의 설정 항목을 찾을 수도 있습니다.

### 키 저장과 마이그레이션

PC의 새 API 키는 OS 키체인(macOS Keychain, Windows DPAPI, Linux libsecret)으로 암호화해 Electron `userData`의 `agent-llms-credentials.json`에 저장합니다. 같은 디렉터리에 권한 `0600`의 임시 파일을 완성한 뒤 교체합니다.

암호화·쓰기·파일 교체가 실패하면 알림을 표시하고 기존 로컬 파일을 보존합니다. 저장하지 못한 새 키는 메모리에만 남으므로, **재시작 전에 키체인이나 쓰기 권한 문제를 해결하고 다시 저장하세요.**

모바일은 Obsidian SecretStorage(1.11.4 이상)에 키를 저장합니다. 구버전이나 저장 실패 시 새 키는 현재 세션에만 남습니다. [모바일 설정 안내](mobile-support.md)를 참고하세요.

이전 버전의 볼트 `data.json`에 있던 키는 **로컬 저장에 성공한 뒤에만 제거**합니다. 모바일에서 해독하지 못한 PC 암호문은 PC의 마이그레이션을 위해 남기며 API 키로 사용하지 않습니다. 마이그레이션이 실패한 동안에는 이전 키가 볼트에 남아 동기화될 수 있습니다. 로컬 이전이 완료된 키는 볼트 동기화에 포함되지 않습니다.

## 여러 기기에서 사용하기

기기마다 **API 키를 입력하고 로컬 저장 성공을 확인하세요.** 키가 만료되거나 교체되면 다시 입력해야 합니다.

| 항목 | 동기화 | 조치 |
|---|---|---|
| 로컬 이전이 완료된 API 키 | ✗ (의도적) | 기기마다 설정에서 입력 |
| 플러그인 설정(모델·리전) | ○ (볼트 동기화 시) | 자동 |
| 볼트 인덱스 | ○ | 아래 참조 |

같은 키를 여러 기기에 써도 되고, 기기별로 다른 키를 발급해도 됩니다. **기기별로 발급하면 한 대를 분실했을 때 그 키만 폐기할 수 있습니다.**

### 볼트 인덱스는 기기 간 공유됩니다

볼트를 동기화하면 `.agent-llms-index.json`도 함께 옮겨집니다. 임베딩 벡터가 들어 있어 수십 MB가 될 수 있습니다.

**임베딩 모델이 같으면** 새 기기에서 재인덱싱 없이 검색이 바로 동작합니다. 플러그인은 `{프로바이더}:{모델 ID}` 형태의 시그니처로 판단합니다(예: `bedrock:amazon.titan-embed-text-v2:0`).

**임베딩 모델이 기기마다 다르면** 시그니처가 어긋나 기존 벡터가 폐기되고 재인덱싱 안내가 나타납니다. 그동안 검색은 키워드 방식으로 동작합니다. 기기 간에 임베딩 모델을 같게 두면 이 문제가 생기지 않습니다.

동기화 도구가 점으로 시작하는 파일을 제외하도록 설정돼 있으면 인덱스가 옮겨지지 않습니다. 그 경우 새 기기에서 한 번 인덱싱하면 됩니다.

## 문제 해결

### `Bedrock AWS 프로필 인증 실패: [프로필] …`

PC에서 지정한 프로필이 모두 자격증명을 주지 못했고 API 키도 없을 때 나옵니다. 대괄호 안의 프로필별 원인을 확인하세요.

- `Could not resolve credentials using profile` — `~/.aws/config`에 그 이름의 프로필이 없습니다
- Roles Anywhere — `credential_process`의 `aws_signing_helper` 경로, 인증서·개인 키 경로, ARN을 확인하세요. 터미널에서 `aws sts get-caller-identity --profile <이름>`이 성공해야 합니다
- SSO — 세션이 만료되었으면 `aws sso login --profile <이름>`을 다시 실행하세요

### `Bedrock API 키가 설정되지 않았습니다`

PC에서는 프로필을 설정하거나, 설정에서 키를 입력하세요. 플러그인은 인증값이 모두 비어 있을 때 **의도적으로 실패합니다** — AWS SDK의 기본 자격증명 체인으로 폴백하면 `~/.aws/credentials`의 `[default]` 프로필이나 환경변수, IAM 역할이 조용히 집혀 사용자가 선택하지 않은 계정으로 노트가 전송되고 과금될 수 있습니다.

특히 재시작 후 이 오류가 나오면 앞서 자격증명 저장 실패 알림이 있었는지 확인하세요. PC는 OS 키체인과 Electron `userData`의 쓰기 권한을, 모바일은 앱 버전(1.11.4 이상)을 확인한 뒤 키를 다시 입력해 저장하세요.

### 모델 드롭다운이 비어 있습니다

세 가지를 확인하세요.

1. 리전과 키가 맞는지 — 사용할 모델이 해당 리전에서 제공되는지, 단기 키의 발급 리전이 일치하는지 확인하세요
2. 키가 유효한지 — 만료·비활성화 여부와 `bedrock:CallWithBearerToken` 사용 허용을 확인하세요
3. 권한 — 채팅 목록은 `bedrock:ListInferenceProfiles`, 임베딩 목록은 `bedrock:ListFoundationModels`가 필요합니다

모델은 드롭다운으로만 선택할 수 있으므로, 목록 조회 권한이 없으면 모델을 설정할 수 없습니다. 위 권한을 IAM 정책에 추가하세요.

### `ExpiredTokenException` 또는 `401`

키 만료·비활성화 여부와 리전을 확인하고, 유효한 키로 교체하세요. 단기 키는 세션 만료 또는 최대 12시간에 만료되며 플러그인이 자동 갱신하지 않습니다.

### `AccessDeniedException`

키를 발급한 IAM 주체의 호출 권한과 `bedrock:CallWithBearerToken` 허용 여부를 확인하세요. 타사 모델의 구독, Anthropic 최초 이용 목적 제출, 조직의 명시적 거부 정책도 [공식 모델 접근 안내](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)에 따라 확인하세요.

### `ValidationException` (임베딩 호출 시)

지원하지 않는 임베딩 모델일 수 있습니다. 플러그인은 Amazon Titan과 Cohere Embed 계열만 요청·응답 스키마를 구현했습니다. 드롭다운은 지원 모델만 노출하지만, 구 설정에 다른 모델 ID가 저장돼 있으면 이 오류가 날 수 있습니다.

### 임베딩 모델을 바꿨더니 검색 결과가 이상합니다

임베딩 차원이 달라지면 기존 벡터와 비교할 수 없습니다. 플러그인이 이를 감지해 구 벡터를 폐기하고 재인덱싱을 안내합니다. 안내를 따라 볼트를 다시 인덱싱하세요. 그 전까지 검색은 키워드 방식으로 동작합니다.

## 네트워크 사용

| 대상 | 목적 |
|---|---|
| `bedrock-runtime.{region}.amazonaws.com` | 채팅·임베딩 호출 |
| `bedrock.{region}.amazonaws.com` | 모델 목록 조회 |

키 저장과 이전 실패 시 동작은 위 설명을 참고하세요. 채팅과 인덱싱에 포함되는 노트 본문은 Bedrock에 전송됩니다. 제3자 분석이나 추적 서비스로 데이터를 보내지 않습니다.
