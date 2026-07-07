# Tingly Translate VS Code Extension — Research + Specification

Date: 2026-07-07
Project: `vscode-tingly-translate`
Package manager: `pnpm`

## 1. Current project state

The repository is a TypeScript VS Code extension prototype:

- Extension entrypoint is `src/extension.ts` and output is bundled to `dist/extension.js` by webpack.
- `package.json` contributes translation commands, settings, context-menu entries, editor-title action, keybindings, and activation events.
- The original scaffolded `vscode-tingly-translate.helloWorld` command has been removed.
- Current provider support is Google free, Google Cloud, Microsoft/Bing free, Microsoft Azure Translator, LibreTranslate, DeepL, MyMemory, Lingva, Apertium, Baidu, Youdao, OpenAI-compatible chat completions, and Anthropic Messages.
- Default behavior is reading-layer inline translation using VS Code editor decorations, not replacing document text.
- HTTP requests are implemented with Node built-ins (`http`, `https`, `net`, `tls`) to avoid adding dependencies during the fast prototype.
- `.pnpm-store/` is ignored because dependency recovery created a local pnpm store artifact.

Attempted verification:

- `pnpm run compile` initially aborted because pnpm wanted to purge/recreate `node_modules` in a non-TTY environment.
- `CI=true pnpm run compile` and `CI=true pnpm install --offline` were attempted, but dependency recovery stalled on registry access to `registry.npmmirror.com`.
- `package.json` was validated with `JSON.parse`.
- After dependency recovery, `./node_modules/.bin/tsc -p . --noEmit` and `./node_modules/.bin/webpack` pass.

## 2. Goals

Build a VS Code extension that translates selected text in the active editor using configurable translation providers.

Primary user stories:

1. As a user, I select text in an editor and run **Tingly Translate: Translate Selection**.
2. The extension calls my configured translation provider.
3. The default result appears inline beside the selected text as a reading aid without modifying the file.
4. I can also explicitly replace the selected text, insert the translation below/after the selection, copy it, or show it in an output channel.
5. I can trigger translation from the Command Palette, editor context menu, editor title button, keyboard shortcut, or VS Code lightbulb/Code Action menu.
6. I can configure provider, source/target language, provider-specific credentials/endpoints/models/prompts, timeout, inline display length, and proxy settings.
7. I can use an HTTP proxy for providers that are unreachable from my network.

Non-goals for the first implementation:

- Full document translation.
- Automatic translation while typing.
- Webview translation UI.
- Storing secrets in plain settings long-term; first version may read API keys from settings, but follow-up should move API keys to VS Code SecretStorage.
- Production-grade stability for unofficial free web translation endpoints.

## 3. Research summary

### VS Code APIs

- Use `contributes.commands` and `contributes.menus` in `package.json` to expose commands in Command Palette and editor context menu. VS Code emits an `onCommand:<command>` activation event when commands are invoked.
  - Source: [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points?from=20423)
- Use `contributes.configuration` for extension settings and `vscode.workspace.getConfiguration('tinglyTranslate')` at runtime.
  - Source: [VS Code Contribution Points — configuration](https://code.visualstudio.com/api/references/contribution-points?from=20423)
- Use the active editor selections (`vscode.window.activeTextEditor`) and editor edit operations to replace ranges.
  - Source: [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api?from=20423&from_column=20423)
- Use `TextEditorDecorationType` with `after.contentText` to show reading-layer inline translation without mutating document text.
  - Source: [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api?from=20423&from_column=20423)
- Use `contributes.keybindings` and `editor/title` menu contribution for fast keyboard and editor-toolbar access.
  - Source: [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points?from=20423)
- Use `languages.registerCodeActionsProvider` to add translation to the lightbulb/Code Action menu for selected text.
  - Source: [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api?from=20423&from_column=20423)

### Translation provider options

| Option | Status | Pros | Cons | Recommendation |
| --- | --- | --- | --- | --- |
| `translate` npm package | Multi-provider wrapper supporting Google, Yandex, LibreTranslate, DeepL; TypeScript declarations; no dependencies. Source: [npm `translate`](https://www.npmjs.com/package/translate) | Fast MVP, simple API, supports multiple engines. | Some engines rely on unofficial/demo endpoints; limited explicit proxy/agent control. | Good for prototype/fallback only, not preferred core. |
| Official Google Cloud Translate client `@google-cloud/translate` | Official Google package. Source: [Google Cloud Node docs](https://docs.cloud.google.com/nodejs/docs/reference/translate/latest/overview) | Official, robust for paid Google Cloud Translate. | Heavier SDK; auth setup; proxy behavior less uniform across all providers. | Consider as dedicated adapter later. First version can use Google REST API directly. |
| Azure Translator `@azure-rest/ai-translation-text` | Official Azure REST client. Source: [npm `@azure-rest/ai-translation-text`](https://www.npmjs.com/package/%40azure-rest/ai-translation-text) | Official Microsoft/Azure Translator SDK, TypeScript declarations. | Azure auth/region setup; may complicate unified proxy layer. | Consider as dedicated adapter later. First version can use Azure REST API directly. |
| DeepL `deepl-node` | Official DeepL Node.js client. Source: [npm `deepl-node`](https://www.npmjs.com/package/deepl-node) | Official, typed, high quality. | Provider-specific API key and behavior. Proxy may require SDK-specific support or custom HTTP layer. | Add in later phase or implement REST adapter. |
| LibreTranslate REST API | Open-source/self-hostable API. Source: [LibreTranslate docs](https://docs.libretranslate.com/) | Easy REST API; can be self-hosted; useful for users avoiding proprietary APIs. | Public instances may rate-limit; quality varies by model. | Implemented as `libreTranslate`. |
| Google Translate free web endpoint | Unofficial endpoint `https://translate.googleapis.com/translate_a/single`. | No API key; quick manual validation; fits prototype. | Unofficial and may change or rate-limit. | Implemented as `googleFree`; current default. |
| Bing/Microsoft Translator web endpoint | Bing Translator web flow using `https://www.bing.com/translator` plus `ttranslatev3`. | No API key; quick manual validation. | Unofficial session-token flow; may change. | Implemented as `microsoftFree`. |
| MyMemory API | Public translation memory API. Source: [MyMemory API spec](https://mymemory.translated.net/doc/spec.php) | No local API key required for basic use; supports optional key/email. | Public limits and translation-memory quality vary; language pair should be explicit for best results. | Implemented as `myMemory`. |
| Lingva Translate | Open alternative frontend/API for Google Translate. Source: [Lingva Translate](https://github.com/thedaviddelta/lingva-translate) | No API key; simple REST shape; instance can be swapped. | Public instances can disappear, rate-limit, or change. | Implemented as `lingva`. |
| Apertium APY | Open-source rule-based machine translation API. Source: [Apertium APY](https://wiki.apertium.org/wiki/Apertium-apy) | Free/open ecosystem; good for supported language pairs. | Limited language pairs; often expects Apertium language codes like `eng`, `spa`. | Implemented as `apertium`. |
| Baidu Translate API | Signed Baidu Translate REST API. Source: [Baidu Translate docs](https://fanyi-api.baidu.com/doc/21) | Strong Chinese ecosystem support. | Requires app ID and secret key; signed requests. | Implemented as `baidu`. |
| Youdao Translate API | Signed Youdao Translate REST API. Source: [Youdao AI docs](https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html) | Strong Chinese ecosystem support; optional vocabulary ID. | Requires app key and secret; signed requests. | Implemented as `youdao`. |
| OpenAI-compatible Chat Completions | Chat-completions-compatible API. Source: [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat/create) | Configurable model, base URL, and prompt; works with OpenAI-compatible gateways. | Requires API key; prompt/model quality affects output. | Implemented as `openai`. |
| Anthropic Messages API | Anthropic Claude messages endpoint. Source: [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) | High-quality AI translation with configurable prompt/model. | Requires API key; endpoint shape differs from OpenAI-compatible APIs. | Implemented as `anthropic`. |

### HTTP/proxy module options

| Option | Status | Pros | Cons | Recommendation |
| --- | --- | --- | --- | --- |
| `undici` | Node HTTP client with `fetch`; Node built-in fetch is powered by undici; package includes TypeScript declarations. Source: [npm `undici`](https://www.npmjs.com/package/undici) | Modern, low dependency count, native fetch-like API. | Need to bundle/add `undici` for current proxy classes rather than relying on Node-bundled version. | Preferred HTTP layer. |
| `undici` `EnvHttpProxyAgent` | Reads `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and supports overrides. Source: [Undici EnvHttpProxyAgent docs](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md) | Clean proxy support, supports env-style config, request dispatcher model. | HTTP(S) proxy focused; SOCKS support may require another module/later phase. | Preferred proxy layer for v1. |
| `proxy-agent` | Automatically maps proxy protocols based on env vars, supports multiple proxy protocols. Source: [npm `proxy-agent`](https://www.npmjs.com/package/proxy-agent) | Mature, broad protocol support including SOCKS via family packages. | Agent style fits `http/https` or libraries that accept Node agents; less direct for fetch unless using non-fetch client. | Alternative/fallback if SOCKS is required early. |
| `https-proxy-agent` | HTTP(S) proxy agent for Node HTTPS requests. Source: [npm `https-proxy-agent`](https://www.npmjs.com/package/https-proxy-agent?link=https%25252525253A%25252525252F%25252525252Fnetnut.io%25252525252Fconfigure-proxy-settings-adspower%25252525252F%25252525253Flink%25252525253Dhttps%2525252525253A%2525252525252F%2525252525252Fnetnut.io%2525252525252Fintegrations%2525253Futm_medium) | Small and focused. | HTTPS proxy only; need extra packages for HTTP/SOCKS/PAC. | Use only if not using undici/proxy-agent. |
| `got` | Modern HTTP client with TypeScript and proxy support; ESM-only. Source: [npm `got`](https://www.npmjs.com/package/got) | Powerful, retries/timeouts/errors. | ESM-only may complicate webpack/CommonJS VS Code extension bundle. | Avoid for v1 unless project converts cleanly to ESM. |

Current prototype module set:

```bash
# no new runtime dependency
```

Rationale: dependency recovery was blocked, so the fast prototype uses Node built-in HTTP modules and a minimal HTTP proxy CONNECT tunnel. This keeps the extension testable by hand without adding packages.

Recommended hardening module set after dependency recovery:

```bash
pnpm add undici
```

Rationale: `undici` gives a fetch-compatible API, TypeScript definitions, low dependency footprint, and `EnvHttpProxyAgent` for explicit proxy/env proxy support. It should replace the hand-rolled HTTP/proxy helper when the prototype is stabilized.

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
   - Icon: `$(globe)`
   - Behavior: translate each non-empty active selection.
   - Default output action: configured by `tinglyTranslate.outputMode`.
   - Current default: `inline`.

2. `vscode-tingly-translate.clearInlineTranslations`
   - Title: `Tingly Translate: Clear Inline Translations`
   - Behavior: remove inline translation decorations from the active editor.

3. `vscode-tingly-translate.translateSelectionReplace`
   - Title: `Tingly Translate: Replace Selection with Translation`
   - Behavior: translate each selection and replace the selected ranges.

4. `vscode-tingly-translate.translateSelectionInsertBelow`
   - Title: `Tingly Translate: Insert Translation Below`
   - Behavior: insert translated text on a new line after each selection/range.

5. `vscode-tingly-translate.translateSelectionCopy`
   - Title: `Tingly Translate: Copy Translation`
   - Behavior: translate combined selected text and write result to clipboard.

### Trigger surfaces

- Command Palette: all contributed commands.
- Editor context menu: translation commands when `editorHasSelection`; clear command always available in the editor context menu.
- Editor title button: globe icon for `translateSelection` when `editorTextFocus && editorHasSelection`.
- Keybindings:
  - macOS: `Cmd+Alt+T` translates selection.
  - Windows/Linux: `Ctrl+Alt+T` translates selection.
  - macOS: `Cmd+Alt+Shift+T` clears inline translations.
  - Windows/Linux: `Ctrl+Alt+Shift+T` clears inline translations.
- Lightbulb / Code Action menu:
  - A `CodeActionProvider` contributes `Tingly Translate: Translate Selection` as `RefactorRewrite` when the range is non-empty.

### Settings

Configuration namespace: `tinglyTranslate`.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `tinglyTranslate.provider` | enum | `googleFree` | Provider: `googleFree`, `microsoftFree`, `googleCloud`, `microsoftAzure`, `libreTranslate`, `deepl`, `myMemory`, `lingva`, `apertium`, `baidu`, `youdao`, `openai`, `anthropic`. |
| `tinglyTranslate.sourceLanguage` | string | `auto` | Source language; `auto` means provider auto-detect where supported. |
| `tinglyTranslate.targetLanguage` | string | `zh-CN` | Target language. |
| `tinglyTranslate.outputMode` | enum | `inline` | `inline`, `replace`, `insertBelow`, `copy`, `showOnly`. |
| `tinglyTranslate.inlineMaxChars` | number | `120` | Maximum characters shown in the inline decoration; hover shows the full translation. |
| `tinglyTranslate.providerOptions` | object | `{}` | Advanced options for the selected provider. Common keys: `apiKey`, `endpoint`, `baseUrl`, `model`, `prompt`, `region`, `appId`, `appKey`, `apiSecret`, `email`, `vocabId`, `maxTokens`, `temperature`, `version`. |
| `tinglyTranslate.timeoutMs` | number | `30000` | Request timeout. |
| `tinglyTranslate.proxy.enabled` | boolean | `false` | Enable explicit proxy for translation requests. |
| `tinglyTranslate.proxy.url` | string | empty | HTTP proxy URL, e.g. `http://127.0.0.1:7890`. HTTPS translation endpoints are tunneled through CONNECT. |

Security note: API keys in VS Code settings can leak through checked-in `.vscode/settings.json`. Post-MVP should add commands to set/list/clear provider secrets using `context.secrets`.

### Current provider behavior

#### `googleFree`

- Endpoint default: `https://translate.googleapis.com/translate_a/single`.
- Method: `GET`.
- Query:
  - `client=gtx`
  - `sl=<source or auto>`
  - `tl=<target>`
  - `dt=t`
  - `q=<selected text>`
- Response: concatenate translated text chunks from the first response item.
- Limitation: unofficial endpoint; may change or rate-limit.

#### `googleCloud`

- Endpoint default: `https://translation.googleapis.com/language/translate/v2`.
- Method: `POST`.
- Query: `key=<apiKey>`.
- Body:
  - `q`: text
  - `target`: target language
  - `format`: `text`
  - `source`: omitted when source is `auto`
- Response: `data.translations[0].translatedText`.

#### `microsoftFree`

- Session page: `https://www.bing.com/translator`.
- Extracts `IG` and best-effort `IID`.
- Translation endpoint default: `https://www.bing.com/ttranslatev3`.
- Method: `POST`.
- Query:
  - `isVertical=1`
  - `IG=<session token>`
  - `IID=<session id>`
- Form body:
  - `fromLang`: source language or `auto-detect`
  - `text`: selected text
  - `to`: target language
- Response: `[0].translations[0].text`.
- Limitation: unofficial Bing web flow; may change.

#### `microsoftAzure`

- Endpoint default: `https://api.cognitive.microsofttranslator.com/translate`.
- Method: `POST`.
- Query:
  - `api-version=3.0`
  - `to=<target>`
  - `from=<source>` only when source is not `auto`
- Headers:
  - `Ocp-Apim-Subscription-Key`
  - `Ocp-Apim-Subscription-Region` when configured
  - `Content-Type: application/json`
- Body: `[{ "Text": "<selected text>" }]`.
- Response: first item in the response array, first translation in `translations`.

#### `libreTranslate`

- Endpoint default: `https://libretranslate.com/translate`.
- Method: `POST`.
- Body:
  - `q`: selected text
  - `source`: source language or `auto`
  - `target`: target language
  - `format`: `text`
  - `api_key`: optional
- Response: `translatedText`.

#### `deepl`

- Endpoint default: `https://api-free.deepl.com/v2/translate`.
- Method: `POST`.
- Headers:
  - `Authorization: DeepL-Auth-Key <apiKey>`
  - `Content-Type: application/x-www-form-urlencoded`
- Form body:
  - `text`: selected text
  - `target_lang`: target language
  - `source_lang`: source language when not `auto`
- Response: `translations[0].text`.

#### `myMemory`

- Endpoint default: `https://api.mymemory.translated.net/get`.
- Method: `GET`.
- Query:
  - `q`: selected text
  - `langpair`: `<source>|<target>`
  - `key`: optional API key
  - `de`: optional contact email
- Response: `responseData.translatedText`.
- Note: explicit `sourceLanguage` is recommended because MyMemory is language-pair oriented.

#### `lingva`

- Endpoint default: `https://lingva.ml/api/v1/<source>/<target>/<text>`.
- Method: `GET`.
- Response: `translation`.
- Note: endpoint is configurable as an instance base URL.

#### `apertium`

- Endpoint default: `https://apertium.org/apy/translate`.
- Method: `GET`.
- Query:
  - `langpair`: `<source>|<target>`
  - `q`: selected text
- Response: `responseData.translatedText`.
- Note: Apertium supports a limited set of language pairs and often uses three-letter codes such as `eng` and `spa`.

#### `baidu`

- Endpoint default: `https://fanyi-api.baidu.com/api/trans/vip/translate`.
- Method: `POST`.
- Form body:
  - `q`: selected text
  - `from`: source language or `auto`
  - `to`: target language
  - `appid`: configured app ID
  - `salt`: generated per request
  - `sign`: `md5(appId + q + salt + secretKey)`
- Response: join `trans_result[].dst`.

#### `youdao`

- Endpoint default: `https://openapi.youdao.com/api`.
- Method: `POST`.
- Form body:
  - `q`: selected text
  - `from`: source language or `auto`
  - `to`: target language
  - `appKey`: configured app key
  - `salt`: generated per request
  - `signType`: `v3`
  - `curtime`: Unix timestamp
  - `sign`: `sha256(appKey + input + salt + curtime + appSecret)`
  - `vocabId`: optional vocabulary ID
- Response: join `translation[]`.

#### `openai`

- Endpoint default: `{baseUrl}/chat/completions`.
- Method: `POST`.
- Headers:
  - `Authorization: Bearer <apiKey>`
  - `Content-Type: application/json`
- Body:
  - `model`
  - `messages`: one user message generated from the prompt template
  - `temperature`
  - `max_tokens`
- Response: `choices[0].message.content`.

#### `anthropic`

- Endpoint default: `{baseUrl}/messages`.
- Method: `POST`.
- Headers:
  - `x-api-key`
  - `anthropic-version`
  - `Content-Type: application/json`
- Body:
  - `model`
  - `max_tokens`
  - `temperature`
  - `messages`: one user message generated from the prompt template
- Response: concatenate text parts from `content`.

### AI prompt templates

Prompt templates support:

- `{text}`
- `{sourceLanguage}`
- `{targetLanguage}`

Default prompt:

```text
Translate the following text from {sourceLanguage} to {targetLanguage}. Return only the translation, without explanations or quotes.

{text}
```

### Inline display behavior

- `inline` mode uses `TextEditorDecorationType`.
- Decoration is placed at each selection end position.
- Inline text is displayed after the selected range using `after.contentText`.
- Inline text is compacted to one line and truncated to `tinglyTranslate.inlineMaxChars`.
- Hover message shows the full translated text.
- Inline translations are visual-only editor decorations; they do not modify the document and are not saved.
- `clearInlineTranslations` clears decorations in the active editor.

## 5. Technical design

### Current source layout

```text
src/
  extension.ts
```

The current implementation intentionally keeps the prototype in one file:

- command registration
- Code Action provider
- config loading
- selection handling
- inline decoration rendering
- provider implementations for web/free, traditional translation APIs, and AI translation APIs
- HTTP and HTTP-proxy helpers

Recommended post-prototype layout:

```text
src/
  extension.ts
  commands/
    translateSelection.ts
  config/
    getTranslationConfig.ts
  providers/
    googleProvider.ts
    microsoftProvider.ts
    types.ts
  http/
    createHttpClient.ts
  editor/
    inlineTranslations.ts
    selections.ts
```

### Runtime flow

1. Command handler gets `vscode.window.activeTextEditor`.
2. Validate that at least one selection is non-empty.
3. Read and normalize `tinglyTranslate` settings.
4. Validate provider-specific required settings:
   - only require API keys for providers that need them.
5. Translate each selection independently for editor-editing modes.
6. For `copy` and `showOnly`, join selected source text with `\n\n` before translation.
7. Apply output mode:
   - `inline`: show editor decorations at each selection end.
   - `replace`: replace each selected range.
   - `insertBelow`: insert translated text after the line containing the selection end.
   - `copy`: copy one combined translation result to clipboard.
   - `showOnly`: show the translated result in the `Tingly Translate` output channel.
8. Surface errors with actionable messages.

### Multi-selection behavior

- `inline`, `replace`, and `insertBelow` translate each non-empty selection independently.
- `copy` and `showOnly` join selected source text with `\n\n` before translation.
- Empty selections are ignored.
- If all selections are empty, show `Select text to translate first.`
- Selections are sorted by document position.

### HTTP client requirements

Current prototype:

- Uses Node built-ins `http`, `https`, `net`, and `tls`.
- Supports `GET` and `POST`.
- Treats non-2xx responses as provider errors.
- Requests `Accept-Encoding: identity` to avoid compression handling in the hand-rolled proxy path.
- Parses JSON in provider-specific code.
- Includes provider or request context in errors, but does not log API keys.

Follow-up hardening:

- Replace hand-rolled HTTP helper with `undici`.
- Use `AbortController` consistently.
- Add retry/backoff only for safe cases.

### Proxy behavior

Current prototype:

1. If `tinglyTranslate.proxy.enabled` is false or `proxy.url` is empty, use direct HTTP/HTTPS requests.
2. If enabled, `proxy.url` must be an HTTP proxy URL such as `http://127.0.0.1:7890`.
3. HTTPS translation endpoints are tunneled through HTTP `CONNECT`.
4. Proxy basic auth in the proxy URL is supported.

MVP scope: HTTP proxy to HTTPS endpoints. SOCKS, PAC, `NO_PROXY`, and environment proxy support are follow-up work.

## 6. Package manifest

### Activation

Current activation events:

```json
{
  "activationEvents": [
    "onLanguage",
    "onCommand:vscode-tingly-translate.translateSelection",
    "onCommand:vscode-tingly-translate.clearInlineTranslations",
    "onCommand:vscode-tingly-translate.translateSelectionReplace",
    "onCommand:vscode-tingly-translate.translateSelectionInsertBelow",
    "onCommand:vscode-tingly-translate.translateSelectionCopy"
  ]
}
```

`onLanguage` is included so the Code Action/lightbulb entry can be available before a command is manually executed.

### Contributions

Current contribution categories:

- `commands`
- `menus.editor/title`
- `menus.editor/context`
- `keybindings`
- `configuration`

### Dependency changes

Current prototype adds no runtime dependency.

Recommended follow-up:

```bash
pnpm add undici
```

Do not add provider SDK dependencies unless the REST/free endpoint implementation proves insufficient.

## 7. Error handling

Use concise VS Code notifications for expected user-facing failures:

| Condition | User-facing message |
| --- | --- |
| No active editor | `Open an editor and select text to translate.` |
| No selected text | `Select text to translate first.` |
| Missing provider API key | `Configure tinglyTranslate.providerOptions.apiKey before using this provider.` |
| Timeout | `Translation request timed out after <timeout> ms.` |
| Network/proxy failure | `Translation request failed. Check provider endpoint and proxy settings.` |
| Provider response parse failure | `Translation provider returned an unexpected response.` |
| Bing free-token failure | `Could not read Bing Translator session token.` |

Detailed diagnostics should go to an output channel named `Tingly Translate`. Do not print secrets.

## 8. Security and privacy

- Never log selected source text by default.
- Never log API keys, authorization headers, full signed URLs, or proxy credentials.
- Warn in README and setting descriptions that API keys inside `tinglyTranslate.providerOptions` are an MVP compromise.
- Warn that `googleFree` and `microsoftFree` use unofficial web endpoints that may change.
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
- Inline rendering:
  - inline text is compacted and truncated
  - hover contains the full translation
  - clear command removes active-editor decorations
- Provider response parsing:
  - Google free `translate_a/single` chunk response
  - Google official `data.translations`
  - Bing free `translations[0].text`
  - Microsoft official translations array
- HTTP error mapping:
  - timeout
  - non-2xx response
  - malformed JSON

### Extension behavior tests

If VS Code extension tests are added, cover:

- Running command with no selection shows validation.
- Inline mode decorates the selected text without editing the document.
- Clear inline translations removes decorations.
- Lightbulb/Code Action entry appears for non-empty selection.
- Editor title globe appears when text is selected.
- Keyboard shortcut triggers translation when text is selected.
- Replace mode edits selected text.
- Insert-below mode inserts after selection end line.
- Copy mode writes to clipboard.

### Manual verification

1. Install dependencies: `pnpm install`.
2. Compile: `pnpm run compile`.
3. Launch extension host from VS Code.
4. Select text in an editor and run `Tingly Translate: Translate Selection`.
5. Verify inline translation appears beside the selected text and hover shows the full translation.
6. Trigger translation from:
   - Command Palette
   - editor context menu
   - editor title globe
   - shortcut
   - lightbulb/Code Action menu
7. Verify `replace`, `insertBelow`, and `copy` commands still work.
8. Repeat with `provider=microsoftFree`, `libreTranslate`, `myMemory`, `lingva`, `apertium`, `deepl`, `baidu`, `youdao`, `openai`, and `anthropic` as endpoints/credentials allow.
9. Repeat with proxy enabled if the provider endpoint is only reachable through proxy.

## 10. Acceptance criteria

MVP is complete when:

- Translation commands are contributed and registered.
- Default `translateSelection` output mode is `inline`.
- Inline translation uses editor decorations and does not modify files.
- Clear inline translations command works.
- Command Palette, editor context menu, editor title button, keybinding, and Code Action/lightbulb entries work.
- `googleFree` works without API key.
- `microsoftFree` works without API key.
- `googleCloud`, `microsoftAzure`, `libreTranslate`, `deepl`, `myMemory`, `lingva`, `apertium`, `baidu`, `youdao`, `openai`, and `anthropic` provider paths are available.
- Configurable source language, target language, output mode, inline max chars, provider options, timeout, and proxy settings are documented in `package.json`.
- Selection replacement, insert-below, copy, and show-only behavior remain available.
- User-facing errors are actionable and do not leak secrets.
- `./node_modules/.bin/tsc -p . --noEmit`, `./node_modules/.bin/webpack`, and `./node_modules/.bin/vscode-test` pass.
- README documents setup, settings, provider examples, and known limitations.

## 11. Implementation plan

Recommended order:

1. Restore dependencies with `CI=true pnpm install`.
2. Run `pnpm run compile`.
3. Manually verify current prototype trigger surfaces and inline rendering.
4. Add focused tests for config parsing and simplified `providerOptions`.
5. Replace hand-rolled HTTP/proxy helper with `undici`.
6. Move code out of `src/extension.ts` into focused modules.
7. Add SecretStorage commands for API keys.
8. Run compile/lint/tests.

Optional second phase:

1. Add custom REST adapters.
2. Add language picker commands.
3. Add output channel command for viewing diagnostics.
4. Add SOCKS proxy support through `proxy-agent` if users need it.
5. Add max-selection guardrails and chunking for long text.

## 12. Open questions

- Should `onLanguage` be narrowed to specific languages or replaced with a more targeted activation strategy?
- Should paid/API-key providers require an explicit confirmation setting before translating multiple selections?
- Should unofficial free endpoints remain defaults or be opt-in after a warning?
- What target language should be the product default: `zh-CN`, VS Code display language, or a first-run prompt?

## 13. Known limitations for v1

- API keys in settings are not ideal; use SecretStorage in the next phase.
- Free Google/Bing web endpoints are unofficial and may change or rate-limit.
- Provider language codes are not fully normalized across services.
- Proxy support is limited to HTTP proxy URLs tunneling HTTPS endpoints.
- Large selections are not yet blocked or chunked.
- Inline decorations are active-editor only and are cleared when overwritten by another inline translation operation in that editor.
- No webview UI, history, glossary, or batch document translation.
