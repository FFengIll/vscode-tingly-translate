# Tingly Translate VS Code Extension — Research + Specification

Date: 2026-07-07
Project: `vscode-tingly-translate`
Package manager: `pnpm`

## 1. Current project state

The repository is already scaffolded as a TypeScript VS Code extension:

- `package.json` contributes a sample `vscode-tingly-translate.helloWorld` command.
- Extension entrypoint is `src/extension.ts` and output is bundled to `dist/extension.js` by webpack.
- `pnpm-lock.yaml` and `node_modules/` exist.
- `pnpm --version` reports `11.7.0`.

Attempted verification:

- `pnpm run compile` currently aborts before compile because pnpm wants to purge/recreate `node_modules` in a non-TTY environment. This is an environment/package-manager state issue, not an extension source issue. For CI/non-interactive runs use `CI=true pnpm install` or set `confirmModulesPurge=false` if needed.

## 2. Goals

Build a VS Code extension that translates selected text in the active editor using configurable translation providers.

Primary user stories:

1. As a user, I select text in an editor and run **Tingly Translate: Translate Selection**.
2. The extension calls my configured translation provider.
3. The extension can either replace the selected text, insert the translation below/after the selection, or copy/show the result.
4. I can configure provider, source/target language, credentials, endpoint, timeout, and proxy settings.
5. I can use a proxy for providers that are unreachable from my network.

Non-goals for the first implementation:

- Full document translation.
- Automatic translation while typing.
- Webview translation UI.
- Storing secrets in plain settings long-term; first version may read from settings/env, but follow-up should move API keys to VS Code SecretStorage.

## 3. Research summary

### VS Code APIs

- Use `contributes.commands` and `contributes.menus` in `package.json` to expose commands in Command Palette and editor context menu. VS Code emits an `onCommand:<command>` activation event when commands are invoked.
  - Source: [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points?from=20423)
- Use `contributes.configuration` for extension settings and `vscode.workspace.getConfiguration('tinglyTranslate')` at runtime.
  - Source: [VS Code Contribution Points — configuration](https://code.visualstudio.com/api/references/contribution-points?from=20423)
- Use the active editor selections (`vscode.window.activeTextEditor`) and editor edit operations to replace ranges.
  - Source: [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api?from=20423&from_column=20423)

### Translation provider options

| Option | Status | Pros | Cons | Recommendation |
| --- | --- | --- | --- | --- |
| `translate` npm package | Multi-provider wrapper supporting Google, Yandex, LibreTranslate, DeepL; TypeScript declarations; no dependencies. Source: [npm `translate`](https://www.npmjs.com/package/translate) | Fast MVP, simple API, supports multiple engines. | Some engines rely on unofficial/demo endpoints; limited explicit proxy/agent control. | Good for prototype/fallback only, not preferred core. |
| Official Google Cloud Translate client `@google-cloud/translate` | Official Google package. Source: [Google Cloud Node docs](https://docs.cloud.google.com/nodejs/docs/reference/translate/latest/overview) | Official, robust for paid Google Cloud Translate. | Heavier SDK; auth setup; proxy behavior less uniform across all providers. | Consider as dedicated adapter later. First version can use Google REST API directly. |
| Azure Translator `@azure-rest/ai-translation-text` | Official Azure REST client. Source: [npm `@azure-rest/ai-translation-text`](https://www.npmjs.com/package/%40azure-rest/ai-translation-text) | Official Microsoft/Azure Translator SDK, TypeScript declarations. | Azure auth/region setup; may complicate unified proxy layer. | Consider as dedicated adapter later. First version can use Azure REST API directly. |
| DeepL `deepl-node` | Official DeepL Node.js client. Source: [npm `deepl-node`](https://www.npmjs.com/package/deepl-node) | Official, typed, high quality. | Provider-specific API key and behavior. Proxy may require SDK-specific support or custom HTTP layer. | Add in later phase or implement REST adapter. |
| LibreTranslate REST API | Open-source/self-hostable API. Source: [LibreTranslate docs](https://docs.libretranslate.com/) | Easy REST API; can be self-hosted; useful for users avoiding proprietary APIs. | Public instances may rate-limit; quality varies by model. | Include in first implementation because it validates generic REST/proxy architecture. |

### HTTP/proxy module options

| Option | Status | Pros | Cons | Recommendation |
| --- | --- | --- | --- | --- |
| `undici` | Node HTTP client with `fetch`; Node built-in fetch is powered by undici; package includes TypeScript declarations. Source: [npm `undici`](https://www.npmjs.com/package/undici) | Modern, low dependency count, native fetch-like API. | Need to bundle/add `undici` for current proxy classes rather than relying on Node-bundled version. | Preferred HTTP layer. |
| `undici` `EnvHttpProxyAgent` | Reads `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and supports overrides. Source: [Undici EnvHttpProxyAgent docs](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md) | Clean proxy support, supports env-style config, request dispatcher model. | HTTP(S) proxy focused; SOCKS support may require another module/later phase. | Preferred proxy layer for v1. |
| `proxy-agent` | Automatically maps proxy protocols based on env vars, supports multiple proxy protocols. Source: [npm `proxy-agent`](https://www.npmjs.com/package/proxy-agent) | Mature, broad protocol support including SOCKS via family packages. | Agent style fits `http/https` or libraries that accept Node agents; less direct for fetch unless using non-fetch client. | Alternative/fallback if SOCKS is required early. |
| `https-proxy-agent` | HTTP(S) proxy agent for Node HTTPS requests. Source: [npm `https-proxy-agent`](https://www.npmjs.com/package/https-proxy-agent?link=https%25252525253A%25252525252F%25252525252Fnetnut.io%25252525252Fconfigure-proxy-settings-adspower%25252525252F%25252525253Flink%25252525253Dhttps%2525252525253A%2525252525252F%2525252525252Fnetnut.io%2525252525252Fintegrations%2525253Futm_medium) | Small and focused. | HTTPS proxy only; need extra packages for HTTP/SOCKS/PAC. | Use only if not using undici/proxy-agent. |
| `got` | Modern HTTP client with TypeScript and proxy support; ESM-only. Source: [npm `got`](https://www.npmjs.com/package/got) | Powerful, retries/timeouts/errors. | ESM-only may complicate webpack/CommonJS VS Code extension bundle. | Avoid for v1 unless project converts cleanly to ESM. |

Recommended module set for first implementation:

```bash
pnpm add undici
```

Rationale: `undici` gives a fetch-compatible API, TypeScript definitions, low dependency footprint, and `EnvHttpProxyAgent` for explicit proxy/env proxy support. Implement provider adapters directly over REST rather than depending on provider SDKs initially. This keeps proxy, timeout, error handling, and testability consistent.

Optional later modules:

```bash
pnpm add proxy-agent
pnpm add @google-cloud/translate @azure-rest/ai-translation-text deepl-node
```

Only add these when a provider-specific adapter needs SDK functionality that REST calls do not cover.

## 4. Functional specification

### Commands

Contribute these commands:

1. `vscode-tingly-translate.translateSelection`
   - Title: `Tingly Translate: Translate Selection`
   - Behavior: translate each non-empty active selection.
   - Default output action: configured by `tinglyTranslate.outputMode`.

2. `vscode-tingly-translate.translateSelectionReplace`
   - Title: `Tingly Translate: Replace Selection with Translation`
   - Behavior: translate each selection and replace the selected ranges.

3. `vscode-tingly-translate.translateSelectionInsertBelow`
   - Title: `Tingly Translate: Insert Translation Below`
   - Behavior: insert translated text on a new line after each selection/range.

4. `vscode-tingly-translate.translateSelectionCopy`
   - Title: `Tingly Translate: Copy Translation`
   - Behavior: translate combined selected text and write result to clipboard.

### Menus

Add editor context menu entries visible when an editor has selected text:

- `editor/context`, group `9_cutcopypaste` or `navigation`, `when: editorHasSelection`.
- Command Palette entries are always available but validate active selection at runtime.

### Settings

Configuration namespace: `tinglyTranslate`.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `tinglyTranslate.provider` | enum | `libretranslate` | Provider: `libretranslate`, `google`, `azure`, `deepl`, `custom` |
| `tinglyTranslate.sourceLanguage` | string | `auto` | Source language; `auto` means provider auto-detect where supported. |
| `tinglyTranslate.targetLanguage` | string | `zh-CN` | Target language. |
| `tinglyTranslate.outputMode` | enum | `replace` | `replace`, `insertBelow`, `copy`, `showOnly`. |
| `tinglyTranslate.timeoutMs` | number | `30000` | Request timeout. |
| `tinglyTranslate.maxSelectionChars` | number | `5000` | Guardrail to avoid accidental large paid translations. |
| `tinglyTranslate.preserveSelection` | boolean | `true` | Re-select translated text or original range after edit where possible. |
| `tinglyTranslate.apiKey` | string | empty | Provider API key for MVP; follow-up should use SecretStorage. |
| `tinglyTranslate.endpoint` | string | provider default | Custom endpoint, required for custom/self-hosted providers. |
| `tinglyTranslate.azureRegion` | string | empty | Azure Translator region when using Azure. |
| `tinglyTranslate.proxy.enabled` | boolean | `false` | Enable explicit proxy for translation requests. |
| `tinglyTranslate.proxy.http` | string | empty | HTTP proxy URL, e.g. `http://127.0.0.1:7890`. |
| `tinglyTranslate.proxy.https` | string | empty | HTTPS proxy URL. |
| `tinglyTranslate.proxy.noProxy` | string | empty | Comma/space-separated hosts to bypass. |
| `tinglyTranslate.proxy.useEnvironment` | boolean | `true` | Use `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` when explicit proxy fields are empty. |

Security note: API keys in VS Code settings can leak through checked-in `.vscode/settings.json`. Post-MVP should add commands to set/list/clear provider secrets using `context.secrets`.

### Provider adapter interface

```ts
export interface TranslateRequest {
  text: string;
  from: string;
  to: string;
  signal?: AbortSignal;
}

export interface TranslateResult {
  text: string;
  detectedSourceLanguage?: string;
  provider: string;
  raw?: unknown;
}

export interface TranslationProvider {
  readonly id: string;
  translate(request: TranslateRequest): Promise<TranslateResult>;
}
```

### Initial provider behavior

#### LibreTranslate adapter (v1 recommended first)

- Endpoint default: `https://libretranslate.com/translate` or no default public endpoint if reliability is a concern.
- Request body:
  - `q`: text
  - `source`: `auto` or configured source
  - `target`: target
  - `format`: `text`
  - `api_key`: optional
- Response: `translatedText`, optional detected language metadata depending on endpoint.

#### Google adapter (REST, v1 optional)

- Use Google Cloud Translation REST endpoint.
- Requires API key or OAuth; MVP can support API key only if enabled by the user.
- Map source `auto` by omitting source where API supports detection.

#### Azure adapter (REST, v1 optional)

- Endpoint default: `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=<target>`.
- Headers:
  - `Ocp-Apim-Subscription-Key`
  - `Ocp-Apim-Subscription-Region` when configured
  - `Content-Type: application/json`
- Body: `[{ "text": "<selected text>" }]`.
- Query parameters:
  - `to`: target language.
  - `from`: source language only when `sourceLanguage !== "auto"`.
- Response: first item in the response array, first translation in `translations`.

#### DeepL adapter (REST, v1 optional)

- Endpoint default:
  - Free API: `https://api-free.deepl.com/v2/translate`
  - Pro API: `https://api.deepl.com/v2/translate`
- MVP should use the configured endpoint instead of trying to infer free/pro from the key.
- Requires API key.
- Request body can be `application/x-www-form-urlencoded`:
  - `text`: selected text
  - `target_lang`: target language
  - `source_lang`: source language only when not `auto`
- Response: first item in `translations`, field `text`.

#### Custom adapter (REST, v1 optional)

The custom adapter exists for self-hosted gateways and future compatibility. It should be intentionally simple in v1:

- Requires `tinglyTranslate.endpoint`.
- Sends JSON `POST` with:

```json
{
  "text": "selected text",
  "from": "auto",
  "to": "zh-CN"
}
```

- Accepts either:
  - `{ "text": "translated text" }`
  - `{ "translatedText": "translated text" }`
  - a plain text response body

## 5. Technical design

### Proposed source layout

```text
src/
  extension.ts
  commands/
    translateSelection.ts
  config/
    getTranslationConfig.ts
  providers/
    index.ts
    types.ts
    libreTranslateProvider.ts
    googleProvider.ts
    azureProvider.ts
    deeplProvider.ts
    customProvider.ts
  http/
    createHttpClient.ts
    errors.ts
  editor/
    selections.ts
    applyTranslation.ts
```

For the first implementation, it is acceptable to keep this smaller if the code stays readable. Do not over-abstract before there are at least two real providers.

### Runtime flow

1. Command handler gets `vscode.window.activeTextEditor`.
2. Validate that at least one selection is non-empty.
3. Read and normalize `tinglyTranslate` settings.
4. Validate provider-specific required settings.
5. Build a provider with shared HTTP client options:
   - timeout
   - abort signal
   - proxy dispatcher
   - normalized endpoint
6. Translate each selection.
7. Apply output mode:
   - `replace`: replace each selected range.
   - `insertBelow`: insert translated text after the line containing the selection end.
   - `copy`: copy one combined translation result to clipboard.
   - `showOnly`: show the translated result in an information message or output channel.
8. Surface errors with actionable messages.

### Multi-selection behavior

- `replace` and `insertBelow` translate each non-empty selection independently.
- `copy` and `showOnly` join selected source text with `\n\n` before translation.
- Empty selections are ignored.
- If all selections are empty, show `Select text to translate first.`
- Preserve ordering by document position, not by creation order, to make multi-cursor output deterministic.

### Selection guardrails

- Reject any single selection longer than `tinglyTranslate.maxSelectionChars`.
- Reject combined `copy` or `showOnly` input longer than `maxSelectionChars * numberOfSelections`.
- Show a warning before translating more than one selection if provider is paid and the total character count is large. MVP may skip interactive confirmation if `maxSelectionChars` is enforced.

### HTTP client requirements

- Use `undici.fetch` with `AbortController`.
- Timeout is implemented by aborting the request.
- Treat non-2xx responses as provider errors.
- Parse JSON only when the response content type indicates JSON or when the provider expects JSON.
- Include a short provider name in errors, but do not include API keys or full authorization headers.

### Proxy behavior

Effective proxy configuration is resolved in this order:

1. If `tinglyTranslate.proxy.enabled` is false, do not install an explicit proxy dispatcher.
2. If enabled and explicit settings are present, construct an `EnvHttpProxyAgent` with those values.
3. If enabled and explicit settings are empty and `proxy.useEnvironment` is true, let `EnvHttpProxyAgent` read process environment variables.
4. If enabled but no proxy can be resolved, continue without proxy and show a non-blocking warning once per session.

Environment mapping:

- `proxy.http` maps to `HTTP_PROXY`.
- `proxy.https` maps to `HTTPS_PROXY`.
- `proxy.noProxy` maps to `NO_PROXY`.

MVP scope: HTTP and HTTPS proxy support. SOCKS and PAC support are follow-up work.

## 6. Package manifest changes

### Activation

Use command activation events:

```json
{
  "activationEvents": [
    "onCommand:vscode-tingly-translate.translateSelection",
    "onCommand:vscode-tingly-translate.translateSelectionReplace",
    "onCommand:vscode-tingly-translate.translateSelectionInsertBelow",
    "onCommand:vscode-tingly-translate.translateSelectionCopy"
  ]
}
```

### Commands contribution

Replace the sample `helloWorld` command with the translation commands listed in section 4.

### Menus contribution

```json
{
  "contributes": {
    "menus": {
      "editor/context": [
        {
          "command": "vscode-tingly-translate.translateSelection",
          "when": "editorHasSelection",
          "group": "9_cutcopypaste"
        },
        {
          "command": "vscode-tingly-translate.translateSelectionReplace",
          "when": "editorHasSelection",
          "group": "9_cutcopypaste"
        },
        {
          "command": "vscode-tingly-translate.translateSelectionInsertBelow",
          "when": "editorHasSelection",
          "group": "9_cutcopypaste"
        },
        {
          "command": "vscode-tingly-translate.translateSelectionCopy",
          "when": "editorHasSelection",
          "group": "9_cutcopypaste"
        }
      ]
    }
  }
}
```

### Dependency changes

Required for v1:

```bash
pnpm add undici
```

Do not add provider SDK dependencies in v1 unless the REST implementation proves insufficient.

## 7. Error handling

Use concise VS Code notifications for expected user-facing failures:

| Condition | User-facing message |
| --- | --- |
| No active editor | `Open an editor and select text to translate.` |
| No selected text | `Select text to translate first.` |
| Selection too long | `Selection is longer than tinglyTranslate.maxSelectionChars.` |
| Missing endpoint | `Configure tinglyTranslate.endpoint for this provider.` |
| Missing API key | `Configure tinglyTranslate.apiKey for this provider.` |
| Timeout | `Translation request timed out after <timeout> ms.` |
| Network/proxy failure | `Translation request failed. Check provider endpoint and proxy settings.` |
| Provider response parse failure | `Translation provider returned an unexpected response.` |

Detailed diagnostics should go to an output channel named `Tingly Translate`. Do not print secrets.

## 8. Security and privacy

- Never log selected source text by default.
- Never log API keys, authorization headers, full signed URLs, or proxy credentials.
- Warn in README and setting descriptions that `tinglyTranslate.apiKey` in settings is an MVP compromise.
- Follow-up: add commands:
  - `Tingly Translate: Set Provider API Key`
  - `Tingly Translate: Clear Provider API Key`
  - `Tingly Translate: Show Current Provider`
- Follow-up implementation should store API keys in `ExtensionContext.secrets`.

## 9. Testing strategy

### Unit tests

Prioritize pure functions and provider parsing:

- Config normalization:
  - defaults are applied
  - enum values are validated
  - endpoints are normalized without losing path/query
- Selection utilities:
  - empty selections are ignored
  - selections are sorted by document position
  - max length validation works
- Provider response parsing:
  - LibreTranslate `translatedText`
  - Azure translations array
  - Google response shape
  - DeepL translations array
  - Custom JSON/plain text response
- HTTP error mapping:
  - timeout
  - non-2xx response
  - malformed JSON

### Extension behavior tests

If VS Code extension tests are added, cover:

- Running command with no selection shows validation.
- Replace mode edits selected text.
- Insert-below mode inserts after selection end line.
- Copy mode writes to clipboard.

### Manual verification

1. Install dependencies: `pnpm install`.
2. Compile: `pnpm run compile`.
3. Launch extension host from VS Code.
4. Configure a LibreTranslate-compatible endpoint.
5. Select text in an editor and run each command.
6. Repeat with proxy enabled if the provider endpoint is only reachable through proxy.

## 10. Acceptance criteria

MVP is complete when:

- Sample `helloWorld` command is removed from contributions and implementation.
- The four translation commands are contributed and registered.
- Command Palette and editor context menu entries work.
- At least LibreTranslate provider works through the shared provider interface.
- Configurable source language, target language, output mode, endpoint, API key, timeout, and proxy settings are documented in `package.json`.
- Selection replacement, insert-below, copy, and show-only behavior are implemented.
- User-facing errors are actionable and do not leak secrets.
- `pnpm run compile` passes in a clean dependency state.
- README documents setup, settings, provider examples, and known limitations.

## 11. Implementation plan

Recommended order:

1. Add `undici` dependency.
2. Replace `package.json` sample contribution with commands, menus, and configuration.
3. Implement config loader and validation.
4. Implement shared HTTP helper with timeout and proxy dispatcher.
5. Implement LibreTranslate provider first.
6. Implement command handlers and editor edit helpers.
7. Add provider response parser tests where practical.
8. Update README.
9. Run compile/lint/tests.

Optional second phase:

1. Add Google, Azure, DeepL REST adapters.
2. Add SecretStorage commands for API keys.
3. Add language picker commands.
4. Add output channel command for viewing diagnostics.
5. Add SOCKS proxy support through `proxy-agent` if users need it.

## 12. Open questions

- Should the default LibreTranslate endpoint be empty to avoid relying on a public instance, or should the extension default to `https://libretranslate.com/translate` for easier onboarding?
- Should `translateSelection` default to `replace` or ask the user on first run?
- Should paid providers require an explicit confirmation setting before translating multiple selections?
- Should provider adapters be implemented all at once or should v1 ship with LibreTranslate plus custom REST only?
- What target language should be the product default: `zh-CN`, VS Code display language, or a first-run prompt?

## 13. Known limitations for v1

- API keys in settings are not ideal; use SecretStorage in the next phase.
- Public LibreTranslate endpoints may be unavailable or rate-limited.
- Provider language codes are not fully normalized across services.
- Proxy support is limited to HTTP/HTTPS in the recommended `undici` path.
- Large selections are intentionally blocked instead of chunked.
- No webview UI, history, glossary, or batch document translation.
