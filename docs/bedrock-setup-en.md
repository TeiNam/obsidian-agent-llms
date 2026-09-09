# Bedrock API Key Setup Guide

This guide describes **0.7.10**. See the [README](../README.md) for installation and basic usage.

The Agent LLMs Bedrock backend authenticates with a single **Bedrock API key (bearer token)**. Enter the key on each device and replace it when it expires or is rotated.

## Why API Keys Only

Version 0.3.0 removed `~/.aws` profile authentication (including SSO) and long-term access key authentication.

| Method | Why it was removed |
|---|---|
| AWS access keys | Long-lived credentials with the largest blast radius. When the key field was empty, the SDK's default credential chain would fall back and silently call with an unintended account. |
| `~/.aws` profiles (SSO) | Require `aws sso login` on each device and another login when the session expires. |
| IAM Roles Anywhere | Require issuing a separate X.509 certificate per device. By design, certificates cannot be shared, because copying them makes device identity meaningless. |

Bedrock API keys are entered once per device. Expiration is managed in the AWS Console.

## Prerequisites

| Item | Requirement |
|---|---|
| AWS account | Access to the models you intend to use in the selected region |
| IAM permissions | The invocation, listing, and API-key permissions below; see section 1 for first-use setup |
| Plugin | Obsidian 1.7.2 or later, desktop only |

```
bedrock:InvokeModelWithResponseStream
bedrock:InvokeModel
bedrock:ListFoundationModels
bedrock:ListInferenceProfiles
bedrock:CallWithBearerToken
```

`bedrock:ListInferenceProfiles` is required. Chat models are selected from a dropdown only, so without this permission the list will be empty and you will not be able to choose a model.

## 1. Check Model Access

In commercial AWS Regions, model access is enabled by default with the required AWS Marketplace permissions. The first invocation of a third-party model starts subscription automatically. Anthropic models also require first-time use-case details. An administrator with the necessary permissions can prepare model access first; see the [official AWS model-access guide](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) for the requirements.

You need at least one chat model and one embedding model. The embedding model is used for vault indexing (Graph RAG). The plugin supports Amazon Titan and Cohere Embed families.

To verify from the terminal:

```bash
aws bedrock list-foundation-models \
  --region ap-northeast-2 \
  --by-output-modality EMBEDDING \
  --query 'modelSummaries[].modelId' \
  --output table
```

This lists embedding models in the region; it does not prove invocation permission or subscription status. Configure AWS CLI authentication separately from the plugin. The filter follows the [official CLI reference](https://docs.aws.amazon.com/cli/latest/reference/bedrock/list-foundation-models.html).

## 2. Issue an API Key

In the AWS Console, navigate to Bedrock → **API keys** and issue a key.

There are two types:

| Type | Validity | Use case |
|---|---|---|
| Short-term | Until session expiry, up to 12 hours | AWS recommends this for production; replacement is manual in this plugin |
| Long-term | Expiration set at issuance, subject to account policy | AWS recommends this for exploration only |

The plugin does not refresh pasted keys automatically. Choose the key type and lifetime using the [official AWS API-key guide](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html), then replace expired keys in settings.

Keys are shown only once, immediately after issuance. Copy it then.

> A short-term key inherits its issuing IAM principal's permissions; a long-term key uses its associated IAM user's permissions. Check the required model invocation and listing permissions, including authorization for `bedrock:CallWithBearerToken`.

## 3. Configure the Plugin

1. Open Settings → **Agent LLMs**
2. Set **AI Backend** to `Bedrock`
3. Paste the issued key into **Bedrock API Key** (the eye icon reveals the value)
4. Enter your target **AWS Region** (e.g., `ap-northeast-2`). Short-term keys work only in the region where they were generated
5. Choose from the **Bedrock Chat Model** and **Bedrock Embedding Model** dropdowns

If the model dropdowns are empty, see Troubleshooting below. Obsidian 1.13+ settings search can also find the settings shown for the current backend.

### Key Storage and Migration

New API keys are encrypted with the OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret) and stored in `agent-llms-credentials.json` under Electron's `userData` directory. A complete temporary file with mode `0600` replaces the destination in the same directory.

If encryption, writing, or file replacement fails, the plugin shows a notice and preserves the existing local file. Unsaved new keys remain in memory only. **Resolve the keychain or write-permission issue and save again before restarting.**

Keys left in the vault's `data.json` by older versions are **removed only after local storage succeeds**. While migration is failing, those older keys can remain in the vault and be synced. Successfully migrated keys are excluded from vault sync.

## Using Multiple Devices

**Enter the API key on each device and confirm that local storage succeeds.** Enter a replacement when the key expires or is rotated.

| Item | Synced | Action |
|---|---|---|
| Successfully migrated API key | ✗ (intentional) | Enter in settings on each device |
| Plugin settings (model, region) | ○ (when vault is synced) | Automatic |
| Vault index | ○ | See below |

You can use the same key on multiple devices, or issue a separate key per device. **Issuing per device lets you revoke only the lost device's key if one is compromised.**

### The Vault Index Is Shared Across Devices

When you sync your vault, `.agent-llms-index.json` moves with it. It contains embedding vectors and can reach tens of MB.

**If the embedding model is the same,** search works immediately on a new device without re-indexing. The plugin decides using an embedding signature of the form `{provider}:{model ID}` (e.g., `bedrock:amazon.titan-embed-text-v2:0`).

**If the embedding model differs per device,** the signature mismatch discards stale vectors, and you are told to re-index. In the meantime, search falls back to keyword matching. Keep the embedding model the same across devices to avoid this.

If your sync tool is configured to exclude dotfiles, the index will not move. In that case, index once on the new device.

## Troubleshooting

### `Bedrock API 키가 설정되지 않았습니다` (Bedrock API key is not configured)

Enter the key in settings. The plugin **intentionally fails** when the key is empty — falling back to the AWS SDK's default credential chain could silently pick up the `[default]` profile in `~/.aws/credentials`, environment variables, or IAM roles, sending your notes and charges to an account you did not choose.

If this appears after restarting, check whether a credential-save failure notice appeared earlier. Check OS keychain availability and write access to Electron's `userData` directory, then enter and save the key again.

### Model Dropdowns Are Empty

Check three things:

1. Region and key — the model must be offered in the selected region; a short-term key must match its issuing region
2. Key validity — check expiry, deactivation, and permission to use `bedrock:CallWithBearerToken`
3. Permissions — the chat list requires `bedrock:ListInferenceProfiles`, the embedding list requires `bedrock:ListFoundationModels`

Models can only be selected from dropdowns, so without list permissions you cannot configure a model. Add the permissions to your IAM policy.

### `ExpiredTokenException` or `401`

Check key expiry, deactivation, and region, then replace the key with a valid one. Short-term keys expire with the session or after 12 hours at most; the plugin does not refresh them.

### `AccessDeniedException`

Check the IAM principal's invocation permissions and authorization for `bedrock:CallWithBearerToken`. Also check third-party model subscription, Anthropic first-time use-case submission, and explicit organization policy denies using the [official model-access guide](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html).

### `ValidationException` (when calling embedding)

You may have selected an unsupported embedding model. The plugin implements request/response schemas only for Amazon Titan and Cohere Embed families. The dropdown exposes only supported models, but if a different model ID is saved in an old config, this error can occur.

### Search Results Are Wrong After Changing the Embedding Model

When embedding dimensions change, existing vectors cannot be compared. The plugin detects this, discards old vectors, and tells you to re-index. Follow the prompt and re-index the vault. Until then, search falls back to keyword matching.

## Network Usage

| Target | Purpose |
|---|---|
| `bedrock-runtime.{region}.amazonaws.com` | Chat and embedding calls |
| `bedrock.{region}.amazonaws.com` | Model list queries |

See the storage section above for migration and save failures. Note text included in chat and indexing requests is sent to Bedrock. No data is sent to third-party analytics or tracking services.
