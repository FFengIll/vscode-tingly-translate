# Tingly Translate

Fast prototype VS Code extension for translating selected editor text with Google Translate or Microsoft Translator.

## Features

- Translate the current editor selection as an inline reading aid by default.
- Show translations beside the selected text without changing the file.
- Replace the selection, insert the translation below, copy the translation, or show it in the `Tingly Translate` output channel when explicitly configured or commanded.
- Use free Google/Bing web translation endpoints by default.
- Optional official Google Cloud / Microsoft Translator API-key mode.
- Optional HTTP proxy support for HTTPS translation endpoints.

## Commands

- `Tingly Translate: Translate Selection`
- `Tingly Translate: Clear Inline Translations`
- `Tingly Translate: Replace Selection with Translation`
- `Tingly Translate: Insert Translation Below`
- `Tingly Translate: Copy Translation`

## Settings

```json
{
  "tinglyTranslate.provider": "google",
  "tinglyTranslate.authMode": "free",
  "tinglyTranslate.sourceLanguage": "auto",
  "tinglyTranslate.targetLanguage": "zh-CN",
  "tinglyTranslate.outputMode": "inline",
  "tinglyTranslate.inlineMaxChars": 120,
  "tinglyTranslate.timeoutMs": 30000,
  "tinglyTranslate.proxy.enabled": false,
  "tinglyTranslate.proxy.url": "http://127.0.0.1:7890"
}
```

Microsoft Translator example:

```json
{
  "tinglyTranslate.provider": "microsoft",
  "tinglyTranslate.authMode": "free",
  "tinglyTranslate.targetLanguage": "zh-Hans"
}
```

Official API-key mode is still available:

```json
{
  "tinglyTranslate.provider": "microsoft",
  "tinglyTranslate.authMode": "apiKey",
  "tinglyTranslate.apiKey": "YOUR_AZURE_TRANSLATOR_KEY",
  "tinglyTranslate.microsoftRegion": "eastus",
  "tinglyTranslate.targetLanguage": "zh-Hans"
}
```

Google free mode uses `https://translate.googleapis.com/translate_a/single` by default.
Microsoft free mode uses Bing Translator web endpoints by default.
Official Google API-key mode uses `https://translation.googleapis.com/language/translate/v2`.
Official Microsoft API-key mode uses `https://api.cognitive.microsofttranslator.com/translate`.

Use `tinglyTranslate.endpoint` only when you need to override the provider endpoint.

## Prototype Notes

- Free web endpoints are unofficial and may change.
- Inline translations are editor decorations only; they do not modify or save the document.
- API keys are read from VS Code settings for speed when `authMode` is `apiKey`. Do not commit workspace settings containing keys.
- Proxy support currently expects an HTTP proxy URL and tunnels HTTPS requests with `CONNECT`.
- SOCKS and PAC proxy support are not implemented yet.
