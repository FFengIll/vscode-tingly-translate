import * as assert from 'assert';

import {
	normalizeProvider,
	OutputMode,
	readConfigFromConfiguration,
} from '../extension';

class FakeConfiguration {
	constructor(private readonly values: Record<string, unknown>) {}

	get<T>(section: string, defaultValue: T): T {
		return Object.prototype.hasOwnProperty.call(this.values, section)
			? this.values[section] as T
			: defaultValue;
	}
}

function readConfig(values: Record<string, unknown>, forcedMode?: OutputMode) {
	return readConfigFromConfiguration(new FakeConfiguration(values), forcedMode);
}

suite('Configuration', () => {
	test('uses simple defaults for a free provider', () => {
		const config = readConfig({});

		assert.strictEqual(config.provider, 'googleFree');
		assert.strictEqual(config.sourceLanguage, 'auto');
		assert.strictEqual(config.targetLanguage, 'zh-CN');
		assert.strictEqual(config.outputMode, 'inline');
		assert.strictEqual(config.inlineMaxChars, 120);
		assert.strictEqual(config.timeoutMs, 30000);
		assert.strictEqual(config.proxyEnabled, false);
		assert.strictEqual(config.proxyUrl, '');
	});

	test('normalizes unknown providers to googleFree', () => {
		assert.strictEqual(normalizeProvider('missing-provider'), 'googleFree');
		assert.strictEqual(normalizeProvider('openai'), 'openai');
		assert.strictEqual(normalizeProvider('youdao'), 'youdao');
	});

	test('maps OpenAI-compatible options from aiProviderOptions', () => {
		const config = readConfig({
			provider: 'openai',
			sourceLanguage: 'en',
			targetLanguage: 'ja',
			aiProviderOptions: {
				openai: {
					apiKey: 'openai-key',
					baseUrl: 'https://example.test/v1',
					endpoint: 'https://example.test/custom/chat',
					model: 'custom-model',
					prompt: 'Translate {text} to {targetLanguage}',
					maxTokens: 321,
					temperature: 0.7,
				},
			},
		});

		assert.strictEqual(config.provider, 'openai');
		assert.strictEqual(config.openai.apiKey, 'openai-key');
		assert.strictEqual(config.openai.baseUrl, 'https://example.test/v1');
		assert.strictEqual(config.openai.endpoint, 'https://example.test/custom/chat');
		assert.strictEqual(config.openai.model, 'custom-model');
		assert.strictEqual(config.openai.prompt, 'Translate {text} to {targetLanguage}');
		assert.strictEqual(config.openai.maxTokens, 321);
		assert.strictEqual(config.openai.temperature, 0.7);
	});

	test('maps credentialed API provider options from apiProviderOptions', () => {
		const baidu = readConfig({
			provider: 'baidu',
			apiProviderOptions: {
				baidu: {
					appId: 'baidu-app',
					apiKey: 'baidu-secret',
					endpoint: 'https://baidu.example/translate',
				},
			},
		});
		const youdao = readConfig({
			provider: 'youdao',
			apiProviderOptions: {
				youdao: {
					appKey: 'youdao-app',
					apiSecret: 'youdao-secret',
					vocabId: 'domain-vocab',
					endpoint: 'https://youdao.example/api',
				},
			},
		});

		assert.strictEqual(baidu.baidu.appId, 'baidu-app');
		assert.strictEqual(baidu.baidu.apiKey, 'baidu-secret');
		assert.strictEqual(baidu.baidu.endpoint, 'https://baidu.example/translate');
		assert.strictEqual(youdao.youdao.appKey, 'youdao-app');
		assert.strictEqual(youdao.youdao.apiKey, 'youdao-secret');
		assert.strictEqual(youdao.youdao.vocabId, 'domain-vocab');
		assert.strictEqual(youdao.youdao.endpoint, 'https://youdao.example/api');
	});

	test('maps public provider options from publicProviderOptions', () => {
		const config = readConfig({
			provider: 'myMemory',
			publicProviderOptions: {
				myMemory: {
					apiKey: 'memory-key',
					email: 'you@example.com',
					endpoint: 'https://memory.example/get',
				},
			},
		});

		assert.strictEqual(config.myMemory.apiKey, 'memory-key');
		assert.strictEqual(config.myMemory.email, 'you@example.com');
		assert.strictEqual(config.myMemory.endpoint, 'https://memory.example/get');
	});

	test('applies provider defaults when provider groups omit advanced values', () => {
		const lingva = readConfig({ provider: 'lingva' });
		const apertium = readConfig({ provider: 'apertium' });
		const anthropic = readConfig({ provider: 'anthropic' });

		assert.strictEqual(lingva.lingva.endpoint, 'https://lingva.ml');
		assert.strictEqual(apertium.apertium.endpoint, 'https://apertium.org/apy');
		assert.strictEqual(anthropic.anthropic.baseUrl, 'https://api.anthropic.com/v1');
		assert.strictEqual(anthropic.anthropic.model, 'claude-3-5-haiku-latest');
		assert.strictEqual(anthropic.anthropic.maxTokens, 2000);
		assert.strictEqual(anthropic.anthropic.temperature, 0.2);
		assert.strictEqual(anthropic.anthropic.version, '2023-06-01');
	});

	test('does not read flat legacy provider paths', () => {
		const config = readConfig({
			provider: 'openai',
			'providers.openai.apiKey': 'legacy-key',
			'providers.openai.model': 'legacy-model',
			apiKey: 'flat-legacy-key',
			endpoint: 'https://legacy.example',
		});

		assert.strictEqual(config.openai.apiKey, '');
		assert.strictEqual(config.openai.model, 'gpt-4o-mini');
		assert.strictEqual(config.openai.endpoint, '');
	});

	test('forced output mode overrides configured output mode', () => {
		const config = readConfig({ outputMode: 'inline' }, 'copy');

		assert.strictEqual(config.outputMode, 'copy');
	});
});
