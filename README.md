# Tingly Translate

VS Code reading-layer translation for selected editor text.

## Features

- Translate the current editor selection as inline decorations by default.
- Show translations beside selected text without modifying or saving the file.
- Trigger translation from the Command Palette, editor title globe button, context menu, keyboard shortcut, or lightbulb Code Action menu.
- Keep explicit replace, insert-below, copy, and output-channel commands for editing workflows.
- Use free web endpoints, traditional translation APIs, or AI translation providers.
- Route requests through an HTTP proxy when needed.

## Commands

- `Tingly Translate: Translate Selection` (`Cmd+Alt+T` on macOS, `Ctrl+Alt+T` on Windows/Linux)
- `Tingly Translate: Clear Inline Translations` (`Cmd+Alt+Shift+T` on macOS, `Ctrl+Alt+Shift+T` on Windows/Linux)
- `Tingly Translate: Replace Selection with Translation`
- `Tingly Translate: Insert Translation Below`
- `Tingly Translate: Copy Translation`

## Basic Settings

```json
{
  "tinglyTranslate.provider": "googleFree",
  "tinglyTranslate.sourceLanguage": "auto",
  "tinglyTranslate.targetLanguage": "zh-CN",
  "tinglyTranslate.outputMode": "inline",
  "tinglyTranslate.inlineMaxChars": 120,
  "tinglyTranslate.providerOptions": {},
  "tinglyTranslate.timeoutMs": 30000,
  "tinglyTranslate.proxy.enabled": false,
  "tinglyTranslate.proxy.url": "http://127.0.0.1:7890"
}
```

Provider choices:

- `googleFree`
- `microsoftFree`
- `googleCloud`
- `microsoftAzure`
- `libreTranslate`
- `deepl`
- `myMemory`
- `lingva`
- `apertium`
- `baidu`
- `youdao`
- `openai`
- `anthropic`

## Provider Examples

Provider-specific values all live in `tinglyTranslate.providerOptions`. Only fill the keys needed by the selected provider.

LibreTranslate:

```json
{
  "tinglyTranslate.provider": "libreTranslate",
  "tinglyTranslate.providerOptions": {
    "endpoint": "https://libretranslate.com/translate",
    "apiKey": ""
  }
}
```

DeepL:

```json
{
  "tinglyTranslate.provider": "deepl",
  "tinglyTranslate.targetLanguage": "ZH",
  "tinglyTranslate.providerOptions": {
    "apiKey": "YOUR_DEEPL_KEY"
  }
}
```

MyMemory:

```json
{
  "tinglyTranslate.provider": "myMemory",
  "tinglyTranslate.sourceLanguage": "en",
  "tinglyTranslate.targetLanguage": "zh-CN",
  "tinglyTranslate.providerOptions": {
    "email": "you@example.com"
  }
}
```

Lingva:

```json
{
  "tinglyTranslate.provider": "lingva",
  "tinglyTranslate.providerOptions": {
    "endpoint": "https://lingva.ml"
  }
}
```

Apertium:

```json
{
  "tinglyTranslate.provider": "apertium",
  "tinglyTranslate.sourceLanguage": "eng",
  "tinglyTranslate.targetLanguage": "spa",
  "tinglyTranslate.providerOptions": {
    "endpoint": "https://apertium.org/apy"
  }
}
```

Baidu:

```json
{
  "tinglyTranslate.provider": "baidu",
  "tinglyTranslate.providerOptions": {
    "appId": "YOUR_BAIDU_APP_ID",
    "apiKey": "YOUR_BAIDU_SECRET_KEY"
  }
}
```

Youdao:

```json
{
  "tinglyTranslate.provider": "youdao",
  "tinglyTranslate.providerOptions": {
    "appKey": "YOUR_YOUDAO_APP_KEY",
    "apiSecret": "YOUR_YOUDAO_APP_SECRET"
  }
}
```

OpenAI-compatible:

```json
{
  "tinglyTranslate.provider": "openai",
  "tinglyTranslate.providerOptions": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "YOUR_OPENAI_KEY",
    "model": "gpt-4o-mini",
    "prompt": "Translate the following text from {sourceLanguage} to {targetLanguage}. Return only the translation.\n\n{text}"
  }
}
```

Anthropic:

```json
{
  "tinglyTranslate.provider": "anthropic",
  "tinglyTranslate.providerOptions": {
    "baseUrl": "https://api.anthropic.com/v1",
    "apiKey": "YOUR_ANTHROPIC_KEY",
    "model": "claude-3-5-haiku-latest",
    "prompt": "Translate the following text from {sourceLanguage} to {targetLanguage}. Return only the translation.\n\n{text}"
  }
}
```

Prompt variables:

- `{text}`
- `{sourceLanguage}`
- `{targetLanguage}`

## Notes

- Free Google/Bing endpoints are unofficial and may change.
- MyMemory, Lingva, and Apertium can be used without local API keys, subject to public instance limits and language-pair support.
- Baidu and Youdao use signed API requests and require app credentials.
- Inline translations are editor decorations only.
- API keys are read from VS Code settings for this prototype. Do not commit workspace settings containing keys.
- Proxy support currently expects an HTTP proxy URL and tunnels HTTPS requests with `CONNECT`.
- SOCKS and PAC proxy support are not implemented yet.
