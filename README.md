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

## Complete JSON Configuration

Put this in your VS Code user or workspace `settings.json`. Pick one `provider`, then fill the matching provider group.

```json
{
  "tinglyTranslate.provider": "googleFree",
  "tinglyTranslate.sourceLanguage": "auto",
  "tinglyTranslate.targetLanguage": "zh-CN",
  "tinglyTranslate.outputMode": "inline",
  "tinglyTranslate.inlineMaxChars": 120,
  "tinglyTranslate.publicProviderOptions": {},
  "tinglyTranslate.apiProviderOptions": {},
  "tinglyTranslate.aiProviderOptions": {},
  "tinglyTranslate.timeoutMs": 30000,
  "tinglyTranslate.proxy.enabled": false,
  "tinglyTranslate.proxy.url": "http://127.0.0.1:7890"
}
```

All available settings:

```json
{
  "tinglyTranslate.provider": "googleFree",
  "tinglyTranslate.sourceLanguage": "auto",
  "tinglyTranslate.targetLanguage": "zh-CN",
  "tinglyTranslate.outputMode": "inline",
  "tinglyTranslate.inlineMaxChars": 120,
  "tinglyTranslate.publicProviderOptions": {
    "libreTranslate": {
      "endpoint": "https://libretranslate.com/translate",
      "apiKey": ""
    },
    "myMemory": {
      "endpoint": "https://api.mymemory.translated.net/get",
      "email": "you@example.com",
      "apiKey": ""
    },
    "lingva": {
      "endpoint": "https://lingva.ml"
    },
    "apertium": {
      "endpoint": "https://apertium.org/apy"
    }
  },
  "tinglyTranslate.apiProviderOptions": {
    "googleCloud": {
      "apiKey": "YOUR_GOOGLE_CLOUD_API_KEY",
      "endpoint": "https://translation.googleapis.com/language/translate/v2"
    },
    "microsoftAzure": {
      "apiKey": "YOUR_AZURE_TRANSLATOR_KEY",
      "region": "eastus",
      "endpoint": "https://api.cognitive.microsofttranslator.com/translate"
    },
    "deepl": {
      "apiKey": "YOUR_DEEPL_KEY",
      "endpoint": "https://api-free.deepl.com/v2/translate"
    },
    "baidu": {
      "appId": "YOUR_BAIDU_APP_ID",
      "apiKey": "YOUR_BAIDU_SECRET_KEY",
      "endpoint": "https://fanyi-api.baidu.com/api/trans/vip/translate"
    },
    "youdao": {
      "appKey": "YOUR_YOUDAO_APP_KEY",
      "apiSecret": "YOUR_YOUDAO_APP_SECRET",
      "vocabId": "",
      "endpoint": "https://openapi.youdao.com/api"
    }
  },
  "tinglyTranslate.aiProviderOptions": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "YOUR_OPENAI_KEY",
      "model": "gpt-4o-mini",
      "prompt": "Translate the following text from {sourceLanguage} to {targetLanguage}. Return only the translation.\n\n{text}",
      "maxTokens": 2000,
      "temperature": 0.2
    },
    "anthropic": {
      "baseUrl": "https://api.anthropic.com/v1",
      "apiKey": "YOUR_ANTHROPIC_KEY",
      "model": "claude-3-5-haiku-latest",
      "prompt": "Translate the following text from {sourceLanguage} to {targetLanguage}. Return only the translation.\n\n{text}",
      "maxTokens": 2000,
      "temperature": 0.2,
      "version": "2023-06-01"
    }
  },
  "tinglyTranslate.timeoutMs": 30000,
  "tinglyTranslate.proxy.enabled": false,
  "tinglyTranslate.proxy.url": "http://127.0.0.1:7890"
}
```

`outputMode` values:

- `inline`: show translation at the end of the selected line without changing the document.
- `replace`: replace the selected text.
- `insertBelow`: insert the translation below the selection.
- `copy`: copy the translation to the clipboard.
- `showOnly`: print the translation to the Tingly Translate output channel.

## Provider Options

Only one provider is active at a time. Unused provider groups are ignored.

### Free or Public Providers

These are best for quick local testing. They may be rate limited or unavailable depending on the public endpoint.

| Provider         | Required options | Optional options              | Notes                              |
| ---------------- | ---------------- | ----------------------------- | ---------------------------------- |
| `googleFree`     | none             | none                          | Unofficial public endpoint.        |
| `microsoftFree`  | none             | none                          | Unofficial public endpoint.        |
| `myMemory`       | none             | `endpoint`, `email`, `apiKey` | Public usage works best with email. |
| `lingva`         | none             | `endpoint`                    | Public instance availability varies. |
| `apertium`       | none             | `endpoint`                    | Requires Apertium language codes.  |
| `libreTranslate` | none             | `endpoint`, `apiKey`          | Some instances require `apiKey`.   |

Example:

```json
{
  "tinglyTranslate.provider": "myMemory",
  "tinglyTranslate.sourceLanguage": "auto",
  "tinglyTranslate.targetLanguage": "zh-CN",
  "tinglyTranslate.publicProviderOptions": {
    "myMemory": {
      "email": "you@example.com"
    }
  }
}
```

### Translation API Providers

These use official translation APIs and normally require credentials.

| Provider         | Required options      | Optional options | Notes                              |
| ---------------- | --------------------- | ---------------- | ---------------------------------- |
| `googleCloud`    | `apiKey`              | `endpoint`       | Uses Google Cloud Translation API. |
| `microsoftAzure` | `apiKey`, `region`    | `endpoint`       | Uses Azure Translator.             |
| `deepl`          | `apiKey`              | `endpoint`       | Defaults to DeepL free API endpoint. |
| `baidu`          | `appId`, `apiKey`     | `endpoint`       | `apiKey` is the Baidu secret key.  |
| `youdao`         | `appKey`, `apiSecret` | `endpoint`, `vocabId` | Uses Youdao signed API.       |

Google Cloud example:

```json
{
  "tinglyTranslate.provider": "googleCloud",
  "tinglyTranslate.targetLanguage": "zh-CN",
  "tinglyTranslate.apiProviderOptions": {
    "googleCloud": {
      "apiKey": "YOUR_GOOGLE_CLOUD_API_KEY",
      "endpoint": "https://translation.googleapis.com/language/translate/v2"
    }
  }
}
```

Microsoft Azure example:

```json
{
  "tinglyTranslate.provider": "microsoftAzure",
  "tinglyTranslate.targetLanguage": "zh-Hans",
  "tinglyTranslate.apiProviderOptions": {
    "microsoftAzure": {
      "apiKey": "YOUR_AZURE_TRANSLATOR_KEY",
      "region": "eastus",
      "endpoint": "https://api.cognitive.microsofttranslator.com/translate"
    }
  }
}
```

China signed API example:

```json
{
  "tinglyTranslate.provider": "baidu",
  "tinglyTranslate.targetLanguage": "zh",
  "tinglyTranslate.apiProviderOptions": {
    "baidu": {
      "appId": "YOUR_BAIDU_APP_ID",
      "apiKey": "YOUR_BAIDU_SECRET_KEY"
    }
  }
}
```

For Youdao, use `provider: "youdao"` with `appKey` and `apiSecret` instead.

### AI Providers

AI translation is configured separately because it has more knobs. Use it when prompt control or better contextual translation matters.

| Provider    | Required options  | Optional options                                                       | Notes                                             |
| ----------- | ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| `openai`    | `apiKey`, `model` | `baseUrl`, `endpoint`, `prompt`, `maxTokens`, `temperature`            | Supports OpenAI-compatible chat completions APIs. |
| `anthropic` | `apiKey`, `model` | `baseUrl`, `endpoint`, `prompt`, `maxTokens`, `temperature`, `version` | Uses Anthropic Messages API.                      |

OpenAI-compatible example:

```json
{
  "tinglyTranslate.provider": "openai",
  "tinglyTranslate.sourceLanguage": "auto",
  "tinglyTranslate.targetLanguage": "zh-CN",
  "tinglyTranslate.aiProviderOptions": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "YOUR_OPENAI_KEY",
      "model": "gpt-4o-mini",
      "prompt": "Translate the following text from {sourceLanguage} to {targetLanguage}. Return only the translation.\n\n{text}",
      "maxTokens": 2000,
      "temperature": 0.2
    }
  }
}
```

For Anthropic, set `tinglyTranslate.provider` to `anthropic` and use `tinglyTranslate.aiProviderOptions.anthropic` with `baseUrl`, `apiKey`, `model`, optional `prompt`, `maxTokens`, `temperature`, and `version`.

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
