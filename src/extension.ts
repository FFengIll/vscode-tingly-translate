import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as tls from 'tls';
import * as vscode from 'vscode';

type ProviderId = 'google' | 'microsoft';
type OutputMode = 'inline' | 'replace' | 'insertBelow' | 'copy' | 'showOnly';
type AuthMode = 'free' | 'apiKey';

interface TranslationConfig {
	provider: ProviderId;
	sourceLanguage: string;
	targetLanguage: string;
	outputMode: OutputMode;
	authMode: AuthMode;
	apiKey: string;
	endpoint: string;
	microsoftRegion: string;
	timeoutMs: number;
	inlineMaxChars: number;
	proxyEnabled: boolean;
	proxyUrl: string;
}

interface HttpResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
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
	const provider = config.get<string>('provider', 'google');
	const outputMode = forcedMode ?? config.get<OutputMode>('outputMode', 'inline');

	return {
		provider: provider === 'microsoft' ? 'microsoft' : 'google',
		sourceLanguage: config.get<string>('sourceLanguage', 'auto'),
		targetLanguage: config.get<string>('targetLanguage', 'zh-CN'),
		outputMode,
		authMode: config.get<string>('authMode', 'free') === 'apiKey' ? 'apiKey' : 'free',
		apiKey: config.get<string>('apiKey', ''),
		endpoint: config.get<string>('endpoint', ''),
		microsoftRegion: config.get<string>('microsoftRegion', ''),
		timeoutMs: config.get<number>('timeoutMs', 30000),
		inlineMaxChars: config.get<number>('inlineMaxChars', 120),
		proxyEnabled: config.get<boolean>('proxy.enabled', false),
		proxyUrl: config.get<string>('proxy.url', ''),
	};
}

async function translateText(text: string, config: TranslationConfig): Promise<string> {
	if (config.authMode === 'apiKey' && !config.apiKey) {
		throw new Error(`Configure tinglyTranslate.apiKey before using ${config.provider}.`);
	}

	if (config.provider === 'microsoft') {
		return translateWithMicrosoft(text, config);
	}

	return translateWithGoogle(text, config);
}

async function translateWithGoogle(text: string, config: TranslationConfig): Promise<string> {
	if (config.authMode === 'free') {
		const endpoint = new URL(config.endpoint || 'https://translate.googleapis.com/translate_a/single');
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

	const endpoint = new URL(config.endpoint || 'https://translation.googleapis.com/language/translate/v2');
	endpoint.searchParams.set('key', config.apiKey);

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

async function translateWithMicrosoft(text: string, config: TranslationConfig): Promise<string> {
	if (config.authMode === 'free') {
		return translateWithBingFree(text, config);
	}

	const endpoint = new URL(config.endpoint || 'https://api.cognitive.microsofttranslator.com/translate');
	endpoint.searchParams.set('api-version', endpoint.searchParams.get('api-version') || '3.0');
	endpoint.searchParams.set('to', config.targetLanguage);

	if (config.sourceLanguage && config.sourceLanguage !== 'auto') {
		endpoint.searchParams.set('from', config.sourceLanguage);
	}

	const headers: Record<string, string> = {
		'Ocp-Apim-Subscription-Key': config.apiKey,
	};

	if (config.microsoftRegion) {
		headers['Ocp-Apim-Subscription-Region'] = config.microsoftRegion;
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

	const endpoint = new URL(config.endpoint || 'https://www.bing.com/ttranslatev3');
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

		const position = result.selection.end;
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
