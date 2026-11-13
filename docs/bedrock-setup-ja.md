# Bedrock認証設定ガイド

このガイドは**0.7.19**を対象としています。[インストールと基本操作](../README-JA.md)も参照してください。

Agent LLMsのBedrockバックエンドは、PCでは次の順序で認証します。モバイルはBedrock APIキーのみを使います。

| 順序 | 方式 | 設定項目 | プラットフォーム |
|---|---|---|---|
| 1 | IAM Roles Anywhere | **Roles Anywhereプロファイル** — `credential_process`で`aws_signing_helper`を実行する`~/.aws/config`のプロファイル名 | PC |
| 2 | IAM Identity Center（SSO） | **SSOプロファイル** — `~/.aws/config`のSSOプロファイル名。先に`aws sso login --profile <名前>`が必要 | PC |
| 3 | Bedrock APIキー（ベアラートークン） | **Bedrock APIキー** | PC・モバイル |

- リクエストごとに先頭から試します。プロファイル認証が失敗すると（証明書・helperのエラー、SSOセッションの期限切れなど）次の方式に移り、APIキーへ切り替えるときに一度だけ通知します。前の方式が再び動作すれば自動的に戻ります。
- プロファイルが動作すれば、APIキーは空のままで構いません。
- アクセス拒否やスロットリングなどリクエスト自体のエラーは、別の方式で再試行しません。
- 設定に入力したプロファイルだけを使います。`[default]`プロファイル・環境変数・IAMロールなどSDKのデフォルト認証チェーンにはフォールバックしません。

例: Claude Code（`AWS_PROFILE`）やCodex（`profile`）と同じRoles Anywhereプロファイルを使うには、同じプロファイル名を入力します。

```ini
[profile coding-agents]
credential_process = /path/to/aws_signing_helper credential-process --certificate /path/client.crt --private-key /path/client.key --trust-anchor-arn <trust-anchor-arn> --profile-arn <profile-arn> --role-arn <role-arn>
```

プロファイル名は秘密情報ではないため、ボルトの`data.json`に保存され同期されます。証明書とSSOセッションは各PCに必要です。

## 前提条件

| 項目 | 要件 |
|---|---|
| AWSアカウント | 選択したリージョンで使用するモデルへのアクセス |
| IAM権限 | 以下の呼び出し・一覧取得・APIキー使用権限。初回利用の準備はセクション1を参照 |
| プラグイン | Obsidian 1.7.2以降、PC・モバイル対応。モバイルのキー保存は1.11.4以降 |

```
bedrock:InvokeModelWithResponseStream
bedrock:InvokeModel
bedrock:ListFoundationModels
bedrock:ListInferenceProfiles
bedrock:CallWithBearerToken
```

`bedrock:ListInferenceProfiles`も必要です。チャットモデルはドロップダウンからのみ選択できるため、この権限がないとリストが空になりモデルを選べません。

## 1. モデルアクセスの確認

商用AWSリージョンでは、必要なAWS Marketplace権限があればモデルアクセスは既定で有効です。サードパーティモデルの初回呼び出し時にサブスクリプション処理が自動で始まります。Anthropicモデルでは初回の用途提出も必要です。権限を持つ管理者が先に利用を準備できます。条件は[AWS公式モデルアクセスガイド](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)を参照してください。

最低でもチャットモデル1つと埋め込みモデル1つが必要です。埋め込みモデルはボルトインデックス化（Graph RAG）に使用され、プラグインはAmazon TitanとCohere Embedファミリーをサポートしています。

ターミナルから確認するには:

```bash
aws bedrock list-foundation-models \
  --region ap-northeast-2 \
  --by-output-modality EMBEDDING \
  --query 'modelSummaries[].modelId' \
  --output table
```

このコマンドはリージョン内の埋め込みモデルを列挙するもので、呼び出し権限や購読完了を保証しません。AWS CLIの認証はプラグイン設定とは別に準備してください。フィルターは[公式CLIリファレンス](https://docs.aws.amazon.com/cli/latest/reference/bedrock/list-foundation-models.html)に従います。

## 2. APIキーの発行

AWSコンソール → Bedrock → **API keys**で発行します。

キーには2種類あります。

| 種類 | 有効期間 | 用途 |
|---|---|---|
| 短期（short-term） | セッション期限まで、最大12時間 | AWSが本番環境に推奨。このプラグインでは手動で交換 |
| 長期（long-term） | 発行時の期限とアカウントポリシーに従う | AWSが探索・試用向けに案内 |

プラグインは入力されたキーを自動更新しません。[AWS公式APIキーガイド](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html)に従って種類と有効期間を選び、期限切れ後は設定で交換してください。

キーは発行直後に一度だけ表示されます。その場でコピーしてください。

> 短期キーは発行元IAMプリンシパルの権限を、長期キーは関連するIAMユーザーの権限を使います。モデル呼び出し・一覧取得の範囲と`bedrock:CallWithBearerToken`の使用許可を確認してください。

## 3. プラグイン設定

1. 設定 → **Agent LLMs**を開きます
2. **AIバックエンド**を`Bedrock`に設定
3. PCでプロファイルを使う場合は、**Roles Anywhereプロファイル**・**SSOプロファイル**に`~/.aws/config`のプロファイル名を入力します。どちらか一方だけでも構いません
4. モバイルや代替手段が必要な場合は、**Bedrock APIキー**に発行したキーを貼り付け（目のアイコンで値を確認可能）
5. **AWSリージョン**に使用するリージョンを入力（例: `ap-northeast-2`）。短期キーは発行したリージョンでのみ使用できます
6. **Bedrock チャットモデル**と**Bedrock 埋め込みモデル**をドロップダウンから選択

モデルドロップダウンが空の場合は、下記のトラブルシューティングを参照してください。Obsidian 1.13以降では、設定検索から現在のバックエンドの設定項目を探すこともできます。

### キーの保存と移行

PCの新しいAPIキーはOSキーチェーン（macOS Keychain、Windows DPAPI、Linux libsecret）で暗号化し、Electronの`userData`内の`agent-llms-credentials.json`に保存します。同じディレクトリに権限`0600`の一時ファイルを完成させてから置換します。

暗号化・書き込み・ファイル置換に失敗すると通知を表示し、既存のローカルファイルを保持します。保存できなかった新しいキーはメモリにのみ残るため、**再起動前にキーチェーンや書き込み権限の問題を解消し、再保存してください。**

モバイルではObsidian SecretStorage（1.11.4以降）に保存します。旧バージョンや保存失敗時には、新しいキーは現在のセッションのみ利用できます。[モバイル設定ガイド（韓国語）](mobile-support.md)を参照してください。

旧バージョンのボルト`data.json`に残っていたキーは、**ローカル保存成功後にのみ除去**します。モバイルで復号できないPC暗号文はPCでの移行用に保持し、APIキーとして使いません。移行に失敗している間は旧キーがボルトに残り、同期される場合があります。移行が完了したキーはボルト同期に含まれません。

## 複数端末での使用

端末ごとに**APIキーを入力し、ローカル保存の成功を確認してください。** 有効期限切れや更新時には再入力が必要です。

| 項目 | 同期 | 対処 |
|---|---|---|
| ローカル移行済みのAPIキー | ✗（意図的） | 端末ごとに設定で入力 |
| プラグイン設定（モデル・リージョン） | ○（ボルト同期時） | 自動 |
| ボルトインデックス | ○ | 以下参照 |

同じキーを複数端末で使用しても、端末ごとに異なるキーを発行しても構いません。**端末ごとに発行すれば、1台を紛失したときにそのキーだけを無効化できます。**

### ボルトインデックスは端末間で共有されます

ボルトを同期すると`.agent-llms-index.json`も一緒に移動します。埋め込みベクトルが含まれるため数十MBになる可能性があります。

**埋め込みモデルが同じなら**、新しい端末で再インデックス不要で検索がすぐに動作します。プラグインは`{provider}:{model ID}`形式のシグネチャで判断します（例: `bedrock:amazon.titan-embed-text-v2:0`）。

**埋め込みモデルが端末ごとに異なる場合**、シグネチャが一致せず既存ベクトルが破棄され、再インデックスの案内が表示されます。その間検索はキーワード方式で動作します。端末間で埋め込みモデルを同じにすればこの問題は発生しません。

同期ツールがドットで始まるファイルを除外するよう設定されている場合、インデックスは移動しません。その場合新しい端末で一度インデックス化してください。

## トラブルシューティング

### `Bedrock AWSプロファイル認証に失敗しました: [プロファイル] …`

PCで指定したプロファイルがすべて資格情報を返せず、APIキーも未設定のときに表示されます。角括弧内のプロファイルごとの原因を確認してください。

- `Could not resolve credentials using profile` — `~/.aws/config`にその名前のプロファイルがありません
- Roles Anywhere — `credential_process`の`aws_signing_helper`パス、証明書・秘密鍵のパス、ARNを確認してください。ターミナルで`aws sts get-caller-identity --profile <名前>`が成功する必要があります
- SSO — セッションが期限切れなら`aws sso login --profile <名前>`を再実行してください

### `Bedrock API 키가 설정되지 않았습니다`（Bedrock APIキーが設定されていません）

設定でキーを入力してください。プラグインはキーが空のとき**意図的に失敗します** — AWS SDKのデフォルト認証チェーンにフォールバックすると、`~/.aws/credentials`の`[default]`プロファイルや環境変数、IAMロールが静かに使用され、選択していないアカウントにノートが送信され課金される可能性があります。

特に再起動後に表示される場合は、その前に資格情報の保存失敗通知が出ていなかったか確認してください。PCではOSキーチェーンとElectronの`userData`への書き込み権限、モバイルではアプリのバージョン（1.11.4以降）を確認して再保存してください。

### モデルドロップダウンが空です

3つを確認してください。

1. リージョンとキー — 選択したリージョンでモデルが提供されているか、短期キーの発行リージョンと一致するか確認してください
2. キーの有効性 — 期限切れ・無効化と`bedrock:CallWithBearerToken`の使用許可を確認してください
3. 権限 — チャットリストは`bedrock:ListInferenceProfiles`、埋め込みリストは`bedrock:ListFoundationModels`が必要です

モデルはドロップダウンからのみ選択できるため、リスト取得権限がないとモデルを設定できません。上記の権限をIAMポリシーに追加してください。

### `ExpiredTokenException`または`401`

キーの期限切れ・無効化とリージョンを確認し、有効なキーに交換してください。短期キーはセッション期限または最大12時間で失効し、プラグインは自動更新しません。

### `AccessDeniedException`

IAMプリンシパルの呼び出し権限と`bedrock:CallWithBearerToken`の使用許可を確認してください。サードパーティモデルの購読、Anthropicの初回用途提出、組織ポリシーの明示的な拒否についても、[公式モデルアクセスガイド](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)を確認してください。

### `ValidationException`（埋め込み呼び出し時）

サポートされていない埋め込みモデルの可能性があります。プラグインはAmazon TitanとCohere Embedファミリーのみリクエスト・レスポンススキーマを実装しています。ドロップダウンはサポートモデルのみ表示しますが、古い設定に別のモデルIDが保存されている場合このエラーが発生する可能性があります。

### 埋め込みモデルを変更したら検索結果がおかしいです

埋め込み次元が変わると既存ベクトルと比較できません。プラグインがこれを検出して旧ベクトルを破棄し、再インデックスの案内を表示します。案内に従ってボルトを再インデックス化してください。それまで検索はキーワード方式で動作します。

## ネットワーク使用

| 対象 | 目的 |
|---|---|
| `bedrock-runtime.{region}.amazonaws.com` | チャット・埋め込み呼び出し |
| `bedrock.{region}.amazonaws.com` | モデルリスト取得 |

キーの保存や移行失敗時の動作は上記を参照してください。チャットやインデックス作成に含まれるノート本文はBedrockへ送信されます。サードパーティの分析や追跡サービスにデータは送信されません。
