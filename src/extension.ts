import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import * as vscode from 'vscode';

export type ProviderId =
	| 'googleFree'
	| 'googleCloud'
	| 'microsoftFree'
	| 'microsoftAzure'
	| 'libreTranslate'
	| 'deepl'
	| 'myMemory'
	| 'lingva'
	| 'apertium'
	| 'baidu'
	| 'youdao'
	| 'openai'
	| 'anthropic';
export type OutputMode = 'inline' | 'replace' | 'insertBelow' | 'copy' | 'showOnly';

export interface TranslationConfig {
	provider: ProviderId;
	sourceLanguage: string;
	targetLanguage: string;
	outputMode: OutputMode;
	timeoutMs: number;
	inlineMaxChars: number;
	proxyEnabled: boolean;
	proxyUrl: string;
	googleCloud: ApiKeyProviderConfig;
	microsoftAzure: ApiKeyProviderConfig & { region: string };
	libreTranslate: ApiKeyProviderConfig;
	deepl: ApiKeyProviderConfig;
	myMemory: ApiKeyProviderConfig & { email: string };
	lingva: ApiKeyProviderConfig;
	apertium: ApiKeyProviderConfig;
	baidu: ApiKeyProviderConfig & { appId: string };
	youdao: ApiKeyProviderConfig & { appKey: string; vocabId: string };
	openai: AiProviderConfig;
	anthropic: AiProviderConfig & { version: string };
}

interface ApiKeyProviderConfig {
	apiKey: string;
	endpoint: string;
}

interface AiProviderConfig extends ApiKeyProviderConfig {
	baseUrl: string;
	model: string;
	prompt: string;
	maxTokens: number;
	temperature: number;
}

interface HttpResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
}

type ProviderOptions = Record<string, unknown>;

interface ConfigurationReader {
	get<T>(section: string, defaultValue: T): T;
}

const output = vscode.window.createOutputChannel('Tingly Translate');
const inlineTranslationDecoration = vscode.window.createTextEditorDecorationType({
	after: {
		margin: '0 0 0 1em',
		color: new vscode.ThemeColor('descriptionForeground'),
		fontStyle: 'italic',
	},
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(output, inlineTranslationDecoration);

	context.subscriptions.push(
		vscode.commands.registerCommand('vscode-tingly-translate.translateSelection', () => translateSelection()),
		vscode.commands.registerCommand('vscode-tingly-translate.clearInlineTranslations', () => clearInlineTranslations()),
		vscode.commands.registerCommand('vscode-tingly-translate.translateSelectionReplace', () => translateSelection('replace')),
		vscode.commands.registerCommand('vscode-tingly-translate.translateSelectionInsertBelow', () => translateSelection('insertBelow')),
		vscode.commands.registerCommand('vscode-tingly-translate.translateSelectionCopy', () => translateSelection('copy')),
		vscode.languages.registerCodeActionsProvider(
			{ scheme: 'file' },
			new TinglyTranslateCodeActionProvider(),
			{
				providedCodeActionKinds: [vscode.CodeActionKind.RefactorRewrite],
			},
		),
	);
}

export function deactivate() {}

class TinglyTranslateCodeActionProvider implements vscode.CodeActionProvider {
	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range,
	): vscode.CodeAction[] {
		if (range.isEmpty || document.getText(range).trim().length === 0) {
			return [];
		}

		const translateAction = new vscode.CodeAction(
			'Tingly Translate: Translate Selection',
			vscode.CodeActionKind.RefactorRewrite,
		);
		translateAction.command = {
			command: 'vscode-tingly-translate.translateSelection',
			title: 'Tingly Translate: Translate Selection',
		};
		translateAction.isPreferred = true;

		return [translateAction];
	}
}

async function translateSelection(forcedMode?: OutputMode): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showWarningMessage('Open an editor and select text to translate.');
		return;
	}

	const selectedRanges = editor.selections
		.filter((selection) => !selection.isEmpty)
		.sort((a, b) => a.start.compareTo(b.start));

	if (selectedRanges.length === 0) {
		vscode.window.showWarningMessage('Select text to translate first.');
		return;
	}

	const config = readConfig(forcedMode);
	const selections = selectedRanges.map((selection) => ({
		selection,
		text: editor.document.getText(selection),
	}));

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Tingly Translate: ${config.provider}`,
			cancellable: false,
		},
		async () => {
			try {
				if (config.outputMode === 'copy' || config.outputMode === 'showOnly') {
					const source = selections.map((item) => item.text).join('\n\n');
					const translated = await translateText(source, config);
					await applyCombinedResult(translated, config.outputMode);
					return;
				}

				const translated = [];
				for (const item of selections) {
					translated.push({
						selection: item.selection,
						text: await translateText(item.text, config),
					});
				}

				await applyEditorResults(editor, translated, config.outputMode, config);
			} catch (error) {
				reportError(error);
			}
		},
	);
}

function readConfig(forcedMode?: OutputMode): TranslationConfig {
	const config = vscode.workspace.getConfiguration('tinglyTranslate');
	return readConfigFromConfiguration(config, forcedMode);
}

export function readConfigFromConfiguration(config: ConfigurationReader, forcedMode?: OutputMode): TranslationConfig {
	const provider = normalizeProvider(config.get<string>('provider', 'googleFree'));
	const outputMode = forcedMode ?? config.get<OutputMode>('outputMode', 'inline');
	const publicProviderOptions = config.get<ProviderOptions>('publicProviderOptions', {});
	const apiProviderOptions = config.get<ProviderOptions>('apiProviderOptions', {});
	const aiProviderOptions = config.get<ProviderOptions>('aiProviderOptions', {});
	const libreTranslateOptions = getObjectOption(publicProviderOptions, 'libreTranslate');
	const myMemoryOptions = getObjectOption(publicProviderOptions, 'myMemory');
	const lingvaOptions = getObjectOption(publicProviderOptions, 'lingva');
	const apertiumOptions = getObjectOption(publicProviderOptions, 'apertium');
	const googleCloudOptions = getObjectOption(apiProviderOptions, 'googleCloud');
	const microsoftAzureOptions = getObjectOption(apiProviderOptions, 'microsoftAzure');
	const deeplOptions = getObjectOption(apiProviderOptions, 'deepl');
	const baiduOptions = getObjectOption(apiProviderOptions, 'baidu');
	const youdaoOptions = getObjectOption(apiProviderOptions, 'youdao');
	const openaiOptions = getObjectOption(aiProviderOptions, 'openai');
	const anthropicOptions = getObjectOption(aiProviderOptions, 'anthropic');

	return {
		provider,
		sourceLanguage: config.get<string>('sourceLanguage', 'auto'),
		targetLanguage: config.get<string>('targetLanguage', 'zh-CN'),
		outputMode,
		timeoutMs: config.get<number>('timeoutMs', 30000),
		inlineMaxChars: config.get<number>('inlineMaxChars', 120),
		proxyEnabled: config.get<boolean>('proxy.enabled', false),
		proxyUrl: config.get<string>('proxy.url', ''),
		googleCloud: {
			apiKey: getStringOption(googleCloudOptions, 'apiKey'),
			endpoint: getStringOption(googleCloudOptions, 'endpoint'),
		},
		microsoftAzure: {
			apiKey: getStringOption(microsoftAzureOptions, 'apiKey'),
			endpoint: getStringOption(microsoftAzureOptions, 'endpoint'),
			region: getStringOption(microsoftAzureOptions, 'region'),
		},
		libreTranslate: {
			apiKey: getStringOption(libreTranslateOptions, 'apiKey'),
			endpoint: getStringOption(libreTranslateOptions, 'endpoint'),
		},
		deepl: {
			apiKey: getStringOption(deeplOptions, 'apiKey'),
			endpoint: getStringOption(deeplOptions, 'endpoint'),
		},
		myMemory: {
			apiKey: getStringOption(myMemoryOptions, 'apiKey'),
			endpoint: getStringOption(myMemoryOptions, 'endpoint'),
			email: getStringOption(myMemoryOptions, 'email'),
		},
		lingva: {
			apiKey: '',
			endpoint: getStringOption(lingvaOptions, 'endpoint', 'https://lingva.ml'),
		},
		apertium: {
			apiKey: '',
			endpoint: getStringOption(apertiumOptions, 'endpoint', 'https://apertium.org/apy'),
		},
		baidu: {
			apiKey: getStringOption(baiduOptions, 'apiKey'),
			endpoint: getStringOption(baiduOptions, 'endpoint', 'https://fanyi-api.baidu.com/api/trans/vip/translate'),
			appId: getStringOption(baiduOptions, 'appId'),
		},
		youdao: {
			apiKey: getStringOption(youdaoOptions, 'apiSecret'),
			endpoint: getStringOption(youdaoOptions, 'endpoint', 'https://openapi.youdao.com/api'),
			appKey: getStringOption(youdaoOptions, 'appKey'),
			vocabId: getStringOption(youdaoOptions, 'vocabId'),
		},
		openai: {
			apiKey: getStringOption(openaiOptions, 'apiKey'),
			baseUrl: getStringOption(openaiOptions, 'baseUrl', 'https://api.openai.com/v1'),
			endpoint: getStringOption(openaiOptions, 'endpoint'),
			model: getStringOption(openaiOptions, 'model', 'gpt-4o-mini'),
			prompt: getStringOption(openaiOptions, 'prompt', defaultAiPrompt()),
			maxTokens: getNumberOption(openaiOptions, 'maxTokens', 2000),
			temperature: getNumberOption(openaiOptions, 'temperature', 0.2),
		},
		anthropic: {
			apiKey: getStringOption(anthropicOptions, 'apiKey'),
			baseUrl: getStringOption(anthropicOptions, 'baseUrl', 'https://api.anthropic.com/v1'),
			endpoint: getStringOption(anthropicOptions, 'endpoint'),
			model: getStringOption(anthropicOptions, 'model', 'claude-3-5-haiku-latest'),
			prompt: getStringOption(anthropicOptions, 'prompt', defaultAiPrompt()),
			maxTokens: getNumberOption(anthropicOptions, 'maxTokens', 2000),
			temperature: getNumberOption(anthropicOptions, 'temperature', 0.2),
			version: getStringOption(anthropicOptions, 'version', '2023-06-01'),
		},
	};
}

export function normalizeProvider(provider: string): ProviderId {
	switch (provider) {
		case 'googleFree':
		case 'googleCloud':
		case 'microsoftFree':
		case 'microsoftAzure':
		case 'libreTranslate':
		case 'deepl':
		case 'myMemory':
		case 'lingva':
		case 'apertium':
		case 'baidu':
		case 'youdao':
		case 'openai':
		case 'anthropic':
			return provider;
		default:
			return 'googleFree';
	}
}

function getStringOption(options: ProviderOptions, key: string, fallback = ''): string {
	const value = options[key];
	return typeof value === 'string' ? value : fallback;
}

function getObjectOption(options: ProviderOptions, key: string): ProviderOptions {
	const value = options[key];
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as ProviderOptions
		: {};
}

function getNumberOption(options: ProviderOptions, key: string, fallback: number): number {
	const value = options[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function defaultAiPrompt(): string {
	return 'Translate the following text from {sourceLanguage} to {targetLanguage}. Return only the translation, without explanations or quotes.\n\n{text}';
}

async function translateText(text: string, config: TranslationConfig): Promise<string> {
	switch (config.provider) {
		case 'googleFree':
			return translateWithGoogleFree(text, config);
		case 'googleCloud':
			return translateWithGoogleCloud(text, config);
		case 'microsoftFree':
			return translateWithBingFree(text, config);
		case 'microsoftAzure':
			return translateWithMicrosoftAzure(text, config);
		case 'libreTranslate':
			return translateWithLibreTranslate(text, config);
		case 'deepl':
			return translateWithDeepL(text, config);
		case 'myMemory':
			return translateWithMyMemory(text, config);
		case 'lingva':
			return translateWithLingva(text, config);
		case 'apertium':
			return translateWithApertium(text, config);
		case 'baidu':
			return translateWithBaidu(text, config);
		case 'youdao':
			return translateWithYoudao(text, config);
		case 'openai':
			return translateWithOpenAi(text, config);
		case 'anthropic':
			return translateWithAnthropic(text, config);
	}
}

async function translateWithGoogleFree(text: string, config: TranslationConfig): Promise<string> {
	const endpoint = new URL('https://translate.googleapis.com/translate_a/single');
	endpoint.searchParams.set('client', 'gtx');
	endpoint.searchParams.set('sl', config.sourceLanguage && config.sourceLanguage !== 'auto' ? config.sourceLanguage : 'auto');
	endpoint.searchParams.set('tl', config.targetLanguage);
	endpoint.searchParams.set('dt', 't');
	endpoint.searchParams.set('q', text);

	const response = await requestText(endpoint, 'GET', undefined, { Accept: 'application/json' }, config);
	const payload = parseJson(response, 'Google Translate free endpoint');
	const chunks = payload?.[0];
	if (!Array.isArray(chunks)) {
		throw new Error('Google Translate free endpoint returned an unexpected response.');
	}

	return chunks
		.map((chunk) => Array.isArray(chunk) && typeof chunk[0] === 'string' ? chunk[0] : '')
		.join('');
}

async function translateWithGoogleCloud(text: string, config: TranslationConfig): Promise<string> {
	requireApiKey('apiProviderOptions.googleCloud.apiKey', config.googleCloud.apiKey);
	const endpoint = new URL(config.googleCloud.endpoint || 'https://translation.googleapis.com/language/translate/v2');
	endpoint.searchParams.set('key', config.googleCloud.apiKey);

	const body: Record<string, string> = {
		q: text,
		target: config.targetLanguage,
		format: 'text',
	};

	if (config.sourceLanguage && config.sourceLanguage !== 'auto') {
		body.source = config.sourceLanguage;
	}

	const response = await postJson(endpoint, body, {}, config);
	const payload = parseJson(response, 'Google Translate');
	const translated = payload?.data?.translations?.[0]?.translatedText;
	if (typeof translated !== 'string') {
		throw new Error('Google Translate returned an unexpected response.');
	}

	return decodeHtmlEntities(translated);
}

async function translateWithMicrosoftAzure(text: string, config: TranslationConfig): Promise<string> {
	requireApiKey('apiProviderOptions.microsoftAzure.apiKey', config.microsoftAzure.apiKey);
	const endpoint = new URL(config.microsoftAzure.endpoint || 'https://api.cognitive.microsofttranslator.com/translate');
	endpoint.searchParams.set('api-version', endpoint.searchParams.get('api-version') || '3.0');
	endpoint.searchParams.set('to', config.targetLanguage);

	if (config.sourceLanguage && config.sourceLanguage !== 'auto') {
		endpoint.searchParams.set('from', config.sourceLanguage);
	}

	const headers: Record<string, string> = {
		'Ocp-Apim-Subscription-Key': config.microsoftAzure.apiKey,
	};

	if (config.microsoftAzure.region) {
		headers['Ocp-Apim-Subscription-Region'] = config.microsoftAzure.region;
	}

	const response = await postJson(endpoint, [{ Text: text }], headers, config);
	const payload = parseJson(response, 'Microsoft Translator');
	const translated = payload?.[0]?.translations?.[0]?.text;
	if (typeof translated !== 'string') {
		throw new Error('Microsoft Translator returned an unexpected response.');
	}

	return translated;
}

async function translateWithBingFree(text: string, config: TranslationConfig): Promise<string> {
	const translatorPage = new URL('https://www.bing.com/translator');
	const pageResponse = await requestText(translatorPage, 'GET', undefined, {
		Accept: 'text/html',
		'User-Agent': 'Mozilla/5.0',
	}, config);

	const ig = pageResponse.body.match(/IG:"([^"]+)"/)?.[1] ?? pageResponse.body.match(/"IG":"([^"]+)"/)?.[1];
	const iid = pageResponse.body.match(/data-iid="([^"]+)"/)?.[1] ?? 'translator.5028';
	if (!ig) {
		throw new Error('Could not read Bing Translator session token.');
	}

	const endpoint = new URL('https://www.bing.com/ttranslatev3');
	endpoint.searchParams.set('isVertical', '1');
	endpoint.searchParams.set('IG', ig);
	endpoint.searchParams.set('IID', iid);

	const form = new URLSearchParams();
	form.set('fromLang', config.sourceLanguage && config.sourceLanguage !== 'auto' ? config.sourceLanguage : 'auto-detect');
	form.set('text', text);
	form.set('to', config.targetLanguage);

	const response = await requestText(endpoint, 'POST', form.toString(), {
		Accept: 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
		'User-Agent': 'Mozilla/5.0',
		Referer: 'https://www.bing.com/translator',
	}, config);

	const payload = parseJson(response, 'Bing Translator free endpoint');
	const translated = payload?.[0]?.translations?.[0]?.text;
	if (typeof translated !== 'string') {
		throw new Error('Bing Translator free endpoint returned an unexpected response.');
	}

	return translated;
}

async function translateWithLibreTranslate(text: string, config: TranslationConfig): Promise<string> {
	const endpoint = new URL(config.libreTranslate.endpoint || 'https://libretranslate.com/translate');
	const body: Record<string, string> = {
		q: text,
		source: config.sourceLanguage && config.sourceLanguage !== 'auto' ? config.sourceLanguage : 'auto',
		target: config.targetLanguage,
		format: 'text',
	};

	if (config.libreTranslate.apiKey) {
		body.api_key = config.libreTranslate.apiKey;
	}

	const response = await postJson(endpoint, body, {}, config);
	const payload = parseJson(response, 'LibreTranslate');
	const translated = payload?.translatedText;
	if (typeof translated !== 'string') {
		throw new Error('LibreTranslate returned an unexpected response.');
	}

	return translated;
}

async function translateWithDeepL(text: string, config: TranslationConfig): Promise<string> {
	requireApiKey('apiProviderOptions.deepl.apiKey', config.deepl.apiKey);
	const endpoint = new URL(config.deepl.endpoint || 'https://api-free.deepl.com/v2/translate');
	const form = new URLSearchParams();
	form.set('text', text);
	form.set('target_lang', config.targetLanguage);

	if (config.sourceLanguage && config.sourceLanguage !== 'auto') {
		form.set('source_lang', config.sourceLanguage);
	}

	const response = await requestText(endpoint, 'POST', form.toString(), {
		Accept: 'application/json',
		Authorization: `DeepL-Auth-Key ${config.deepl.apiKey}`,
		'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	}, config);
	const payload = parseJson(response, 'DeepL');
	const translated = payload?.translations?.[0]?.text;
	if (typeof translated !== 'string') {
		throw new Error('DeepL returned an unexpected response.');
	}

	return translated;
}

async function translateWithMyMemory(text: string, config: TranslationConfig): Promise<string> {
	const endpoint = new URL(config.myMemory.endpoint || 'https://api.mymemory.translated.net/get');
	endpoint.searchParams.set('q', text);
	endpoint.searchParams.set('langpair', `${normalizeMyMemoryLanguage(config.sourceLanguage)}|${normalizeMyMemoryLanguage(config.targetLanguage)}`);

	if (config.myMemory.apiKey) {
		endpoint.searchParams.set('key', config.myMemory.apiKey);
	}
	if (config.myMemory.email) {
		endpoint.searchParams.set('de', config.myMemory.email);
	}

	const response = await requestText(endpoint, 'GET', undefined, { Accept: 'application/json' }, config);
	const payload = parseJson(response, 'MyMemory');
	const translated = payload?.responseData?.translatedText;
	if (typeof translated !== 'string') {
		throw new Error('MyMemory returned an unexpected response.');
	}

	return translated;
}

async function translateWithLingva(text: string, config: TranslationConfig): Promise<string> {
	const baseUrl = config.lingva.endpoint || 'https://lingva.ml';
	const source = encodeURIComponent(config.sourceLanguage && config.sourceLanguage !== 'auto' ? config.sourceLanguage : 'auto');
	const target = encodeURIComponent(config.targetLanguage);
	const query = encodeURIComponent(text);
	const endpoint = new URL(joinUrl(baseUrl, `api/v1/${source}/${target}/${query}`));

	const response = await requestText(endpoint, 'GET', undefined, { Accept: 'application/json' }, config);
	const payload = parseJson(response, 'Lingva');
	const translated = payload?.translation;
	if (typeof translated !== 'string') {
		throw new Error('Lingva returned an unexpected response.');
	}

	return translated;
}

async function translateWithApertium(text: string, config: TranslationConfig): Promise<string> {
	const endpoint = new URL(joinUrl(config.apertium.endpoint || 'https://apertium.org/apy', 'translate'));
	endpoint.searchParams.set('langpair', `${normalizeApertiumLanguage(config.sourceLanguage)}|${normalizeApertiumLanguage(config.targetLanguage)}`);
	endpoint.searchParams.set('q', text);

	const response = await requestText(endpoint, 'GET', undefined, { Accept: 'application/json' }, config);
	const payload = parseJson(response, 'Apertium');
	const translated = payload?.responseData?.translatedText;
	if (typeof translated !== 'string') {
		throw new Error('Apertium returned an unexpected response.');
	}

	return translated;
}

async function translateWithBaidu(text: string, config: TranslationConfig): Promise<string> {
	requireProviderSetting('apiProviderOptions.baidu.appId', config.baidu.appId);
	requireApiKey('apiProviderOptions.baidu.apiKey', config.baidu.apiKey);
	const endpoint = new URL(config.baidu.endpoint || 'https://fanyi-api.baidu.com/api/trans/vip/translate');
	const salt = Date.now().toString();
	const source = config.sourceLanguage && config.sourceLanguage !== 'auto' ? config.sourceLanguage : 'auto';
	const sign = md5(`${config.baidu.appId}${text}${salt}${config.baidu.apiKey}`);
	const form = new URLSearchParams();
	form.set('q', text);
	form.set('from', source);
	form.set('to', config.targetLanguage);
	form.set('appid', config.baidu.appId);
	form.set('salt', salt);
	form.set('sign', sign);

	const response = await requestText(endpoint, 'POST', form.toString(), {
		Accept: 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	}, config);
	const payload = parseJson(response, 'Baidu Translate');
	const translated = Array.isArray(payload?.trans_result)
		? payload.trans_result
			.map((item: unknown) => {
				const result = item as { dst?: unknown };
				return typeof result.dst === 'string' ? result.dst : '';
			})
			.join('\n')
		: undefined;

	if (typeof translated !== 'string' || translated.length === 0) {
		throw new Error(`Baidu Translate returned an unexpected response: ${response.body.slice(0, 300)}`);
	}

	return translated;
}

async function translateWithYoudao(text: string, config: TranslationConfig): Promise<string> {
	requireProviderSetting('apiProviderOptions.youdao.appKey', config.youdao.appKey);
	requireApiKey('apiProviderOptions.youdao.apiSecret', config.youdao.apiKey);
	const endpoint = new URL(config.youdao.endpoint || 'https://openapi.youdao.com/api');
	const salt = randomId();
	const curtime = Math.floor(Date.now() / 1000).toString();
	const source = config.sourceLanguage && config.sourceLanguage !== 'auto' ? config.sourceLanguage : 'auto';
	const sign = sha256(`${config.youdao.appKey}${truncateForYoudaoSign(text)}${salt}${curtime}${config.youdao.apiKey}`);
	const form = new URLSearchParams();
	form.set('q', text);
	form.set('from', source);
	form.set('to', config.targetLanguage);
	form.set('appKey', config.youdao.appKey);
	form.set('salt', salt);
	form.set('sign', sign);
	form.set('signType', 'v3');
	form.set('curtime', curtime);
	if (config.youdao.vocabId) {
		form.set('vocabId', config.youdao.vocabId);
	}

	const response = await requestText(endpoint, 'POST', form.toString(), {
		Accept: 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	}, config);
	const payload = parseJson(response, 'Youdao Translate');
	const translated = Array.isArray(payload?.translation) ? payload.translation.join('\n') : undefined;
	if (typeof translated !== 'string' || translated.length === 0) {
		throw new Error(`Youdao Translate returned an unexpected response: ${response.body.slice(0, 300)}`);
	}

	return translated;
}

async function translateWithOpenAi(text: string, config: TranslationConfig): Promise<string> {
	requireApiKey('aiProviderOptions.openai.apiKey', config.openai.apiKey);
	const endpoint = new URL(config.openai.endpoint || joinUrl(config.openai.baseUrl, 'chat/completions'));
	const response = await postJson(endpoint, {
		model: config.openai.model,
		messages: [
			{
				role: 'user',
				content: renderPrompt(config.openai.prompt, text, config),
			},
		],
		temperature: config.openai.temperature,
		max_tokens: config.openai.maxTokens,
	}, {
		Authorization: `Bearer ${config.openai.apiKey}`,
	}, config);

	const payload = parseJson(response, 'OpenAI-compatible provider');
	const translated = payload?.choices?.[0]?.message?.content;
	if (typeof translated !== 'string') {
		throw new Error('OpenAI-compatible provider returned an unexpected response.');
	}

	return translated.trim();
}

async function translateWithAnthropic(text: string, config: TranslationConfig): Promise<string> {
	requireApiKey('aiProviderOptions.anthropic.apiKey', config.anthropic.apiKey);
	const endpoint = new URL(config.anthropic.endpoint || joinUrl(config.anthropic.baseUrl, 'messages'));
	const response = await postJson(endpoint, {
		model: config.anthropic.model,
		max_tokens: config.anthropic.maxTokens,
		temperature: config.anthropic.temperature,
		messages: [
			{
				role: 'user',
				content: renderPrompt(config.anthropic.prompt, text, config),
			},
		],
	}, {
		'x-api-key': config.anthropic.apiKey,
		'anthropic-version': config.anthropic.version,
	}, config);

	const payload = parseJson(response, 'Anthropic');
	const translated = Array.isArray(payload?.content)
		? payload.content
			.map((part: unknown) => {
				const textPart = part as { text?: unknown };
				return typeof textPart.text === 'string' ? textPart.text : '';
			})
			.join('')
		: undefined;

	if (typeof translated !== 'string' || translated.length === 0) {
		throw new Error('Anthropic returned an unexpected response.');
	}

	return translated.trim();
}

function requireApiKey(settingName: string, apiKey: string): void {
	requireProviderSetting(settingName, apiKey);
}

function requireProviderSetting(settingName: string, value: string): void {
	if (!value) {
		throw new Error(`Configure tinglyTranslate.${settingName} before using this provider.`);
	}
}

function renderPrompt(prompt: string, text: string, config: TranslationConfig): string {
	return prompt
		.replace(/\{text\}/g, text)
		.replace(/\{sourceLanguage\}/g, config.sourceLanguage)
		.replace(/\{targetLanguage\}/g, config.targetLanguage);
}

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function md5(value: string): string {
	return crypto.createHash('md5').update(value).digest('hex');
}

function sha256(value: string): string {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function randomId(): string {
	return crypto.randomBytes(16).toString('hex');
}

function truncateForYoudaoSign(text: string): string {
	if (text.length <= 20) {
		return text;
	}

	return `${text.slice(0, 10)}${text.length}${text.slice(-10)}`;
}

function normalizeMyMemoryLanguage(language: string): string {
	return language === 'auto' ? 'auto' : language;
}

function normalizeApertiumLanguage(language: string): string {
	const normalized = language.toLowerCase();
	const mapping: Record<string, string> = {
		en: 'eng',
		es: 'spa',
		fr: 'fra',
		pt: 'por',
		ca: 'cat',
		oc: 'oci',
		it: 'ita',
	};

	return mapping[normalized] ?? normalized;
}

async function applyCombinedResult(text: string, outputMode: OutputMode): Promise<void> {
	if (outputMode === 'copy') {
		await vscode.env.clipboard.writeText(text);
		vscode.window.showInformationMessage('Translation copied to clipboard.');
		return;
	}

	output.clear();
	output.appendLine(text);
	output.show(true);
}

async function applyEditorResults(
	editor: vscode.TextEditor,
	results: Array<{ selection: vscode.Selection; text: string }>,
	outputMode: OutputMode,
	config?: TranslationConfig,
): Promise<void> {
	if (outputMode === 'inline') {
		applyInlineTranslations(editor, results, config?.inlineMaxChars ?? 120);
		return;
	}

	if (outputMode === 'insertBelow') {
		await editor.edit((edit) => {
			for (const result of [...results].reverse()) {
				const endLine = editor.document.lineAt(result.selection.end.line);
				edit.insert(endLine.range.end, `\n${result.text}`);
			}
		});
		return;
	}

	if (outputMode === 'showOnly') {
		output.clear();
		for (const result of results) {
			output.appendLine(result.text);
			output.appendLine('');
		}
		output.show(true);
		return;
	}

	await editor.edit((edit) => {
		for (const result of results) {
			edit.replace(result.selection, result.text);
		}
	});
}

function applyInlineTranslations(
	editor: vscode.TextEditor,
	results: Array<{ selection: vscode.Selection; text: string }>,
	inlineMaxChars: number,
): void {
	const decorations = results.map((result) => {
		const inlineText = formatInlineTranslation(result.text, inlineMaxChars);
		const hover = new vscode.MarkdownString();
		hover.appendMarkdown('**Tingly Translate**\n\n');
		hover.appendText(result.text);
		hover.isTrusted = false;

		const line = getInlineTranslationAnchorLine(editor.document, result.selection);
		const position = editor.document.lineAt(line).range.end;
		return {
			range: new vscode.Range(position, position),
			hoverMessage: hover,
			renderOptions: {
				after: {
					contentText: `  ${inlineText}`,
				},
			},
		};
	});

	editor.setDecorations(inlineTranslationDecoration, decorations);
}

function getInlineTranslationAnchorLine(document: vscode.TextDocument, selection: vscode.Selection): number {
	if (selection.end.character === 0 && selection.end.line > selection.start.line) {
		return selection.end.line - 1;
	}

	return Math.min(selection.end.line, document.lineCount - 1);
}

function clearInlineTranslations(): void {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	editor.setDecorations(inlineTranslationDecoration, []);
}

function formatInlineTranslation(text: string, inlineMaxChars: number): string {
	const compact = text.replace(/\s+/g, ' ').trim();
	if (compact.length <= inlineMaxChars) {
		return `=> ${compact}`;
	}

	return `=> ${compact.slice(0, Math.max(20, inlineMaxChars - 1))}...`;
}

async function postJson(
	url: URL,
	body: unknown,
	extraHeaders: Record<string, string>,
	config: TranslationConfig,
): Promise<HttpResponse> {
	const payload = JSON.stringify(body);
	const headers = {
		'Content-Type': 'application/json; charset=utf-8',
		Accept: 'application/json',
		...extraHeaders,
	};

	return requestText(url, 'POST', payload, headers, config);
}

async function requestText(
	url: URL,
	method: 'GET' | 'POST',
	payload: string | undefined,
	headers: Record<string, string>,
	config: TranslationConfig,
): Promise<HttpResponse> {
	const requestHeaders: Record<string, string> = {
		'Accept-Encoding': 'identity',
		...headers,
	};
	if (payload !== undefined) {
		requestHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
	}

	const response = config.proxyEnabled && config.proxyUrl
		? await requestViaHttpProxy(url, method, payload, requestHeaders, config)
		: await requestDirect(url, method, payload, requestHeaders, config.timeoutMs);

	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`Translation request failed with HTTP ${response.statusCode}: ${response.body.slice(0, 500)}`);
	}

	return response;
}

function requestDirect(
	url: URL,
	method: 'GET' | 'POST',
	payload: string | undefined,
	headers: Record<string, string>,
	timeoutMs: number,
): Promise<HttpResponse> {
	return new Promise((resolve, reject) => {
		const client = url.protocol === 'http:' ? http : https;
		const request = client.request(
			url,
			{
				method,
				headers,
				timeout: timeoutMs,
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () => resolve({
					statusCode: response.statusCode ?? 0,
					headers: normalizeHeaders(response.headers),
					body: Buffer.concat(chunks).toString('utf8'),
				}));
			},
		);

		request.on('timeout', () => request.destroy(new Error(`Translation request timed out after ${timeoutMs} ms.`)));
		request.on('error', reject);
		if (payload !== undefined) {
			request.write(payload);
		}
		request.end();
	});
}

function requestViaHttpProxy(
	url: URL,
	method: 'GET' | 'POST',
	payload: string | undefined,
	headers: Record<string, string>,
	config: TranslationConfig,
): Promise<HttpResponse> {
	if (url.protocol !== 'https:') {
		throw new Error('Proxy prototype currently supports HTTPS translation endpoints only.');
	}

	const proxy = new URL(config.proxyUrl);
	if (proxy.protocol !== 'http:') {
		throw new Error('Proxy prototype currently supports HTTP proxy URLs like http://127.0.0.1:7890.');
	}

	return new Promise((resolve, reject) => {
		const proxyPort = Number(proxy.port || '80');
		const socket = net.connect(proxyPort, proxy.hostname);
		const timer = setTimeout(() => {
			socket.destroy(new Error(`Translation request timed out after ${config.timeoutMs} ms.`));
		}, config.timeoutMs);

		const fail = (error: Error) => {
			clearTimeout(timer);
			reject(error);
		};

		socket.once('error', fail);
		socket.once('connect', () => {
			const targetPort = url.port || '443';
			const proxyHeaders = [
				`CONNECT ${url.hostname}:${targetPort} HTTP/1.1`,
				`Host: ${url.hostname}:${targetPort}`,
			];

			if (proxy.username || proxy.password) {
				const credentials = Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64');
				proxyHeaders.push(`Proxy-Authorization: Basic ${credentials}`);
			}

			socket.write(`${proxyHeaders.join('\r\n')}\r\n\r\n`);
		});

		let connectBuffer = Buffer.alloc(0);
		socket.on('data', function onConnectData(chunk: Buffer) {
			connectBuffer = Buffer.concat([connectBuffer, chunk]);
			const headerEnd = connectBuffer.indexOf('\r\n\r\n');
			if (headerEnd === -1) {
				return;
			}

			socket.removeListener('data', onConnectData);
			const connectHead = connectBuffer.subarray(0, headerEnd).toString('utf8');
			if (!connectHead.startsWith('HTTP/1.1 200') && !connectHead.startsWith('HTTP/1.0 200')) {
				fail(new Error(`Proxy CONNECT failed: ${connectHead.split('\r\n')[0]}`));
				return;
			}

			const secureSocket = tls.connect({
				socket,
				servername: url.hostname,
			});

			const responseChunks: Buffer[] = [];

			secureSocket.once('secureConnect', () => {
				const path = `${url.pathname}${url.search}`;
				const requestHeaders = {
					Host: url.host,
					Connection: 'close',
					...headers,
				};
				const headerText = Object.entries(requestHeaders)
					.map(([name, value]) => `${name}: ${value}`)
					.join('\r\n');

				secureSocket.write(`${method} ${path} HTTP/1.1\r\n${headerText}\r\n\r\n${payload ?? ''}`);
			});

			secureSocket.on('data', (secureChunk: Buffer) => responseChunks.push(secureChunk));
			secureSocket.once('end', () => {
				clearTimeout(timer);
				resolve(parseRawHttpResponse(Buffer.concat(responseChunks)));
			});
			secureSocket.once('error', fail);
		});
	});
}

function parseRawHttpResponse(raw: Buffer): HttpResponse {
	const headerEnd = raw.indexOf('\r\n\r\n');
	if (headerEnd === -1) {
		throw new Error('Translation provider returned an invalid HTTP response.');
	}

	const headerText = raw.subarray(0, headerEnd).toString('utf8');
	const bodyBuffer = raw.subarray(headerEnd + 4);
	const headerLines = headerText.split('\r\n');
	const statusCode = Number(headerLines[0].split(' ')[1] || '0');
	const headers: Record<string, string> = {};

	for (const line of headerLines.slice(1)) {
		const separator = line.indexOf(':');
		if (separator > -1) {
			headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
		}
	}

	const body = headers['transfer-encoding']?.toLowerCase().includes('chunked')
		? decodeChunkedBody(bodyBuffer).toString('utf8')
		: bodyBuffer.toString('utf8');

	return { statusCode, headers, body };
}

function decodeChunkedBody(body: Buffer): Buffer {
	const chunks: Buffer[] = [];
	let offset = 0;

	while (offset < body.length) {
		const lineEnd = body.indexOf('\r\n', offset);
		if (lineEnd === -1) {
			break;
		}

		const size = Number.parseInt(body.subarray(offset, lineEnd).toString('ascii'), 16);
		if (!Number.isFinite(size) || size <= 0) {
			break;
		}

		const start = lineEnd + 2;
		const end = start + size;
		chunks.push(body.subarray(start, end));
		offset = end + 2;
	}

	return Buffer.concat(chunks);
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === 'string') {
			normalized[key.toLowerCase()] = value;
		}
	}
	return normalized;
}

function parseJson(response: HttpResponse, providerName: string): any {
	try {
		return JSON.parse(response.body);
	} catch {
		throw new Error(`${providerName} returned invalid JSON.`);
	}
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, '\'')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

function reportError(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	output.appendLine(`[${new Date().toISOString()}] ${message}`);
	vscode.window.showErrorMessage(message);
}
