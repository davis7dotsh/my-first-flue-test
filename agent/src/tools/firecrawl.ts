import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import {
	createProviderDeadline,
	isRecord,
	parseBoundedJson,
	type ProviderDeadline,
	type ProviderFetch,
	ProviderHttpError,
	requestProvider
} from './provider-http';

const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v2/search';
const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';
const DEFAULT_TIMEOUT_MS = 30_000;
const SEARCH_RESPONSE_MAX_BYTES = 512_000;
const SCRAPE_RESPONSE_MAX_BYTES = 2_000_000;
const DEFAULT_RESULT_COUNT = 5;
const DEFAULT_CONTENT_CHARACTERS = 4_000;
const MAX_CONTENT_CHARACTERS = 6_000;
const MAX_CONCURRENT_SCRAPES = 3;

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

const isCalendarDate = (value: string) => {
	const match = isoDatePattern.exec(value);
	if (!match) {
		return false;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
};

const isoDate = v.pipe(
	v.string(),
	v.regex(isoDatePattern, 'Use YYYY-MM-DD.'),
	v.check(isCalendarDate, 'Use a real calendar date in YYYY-MM-DD format.')
);

const optionalDomainList = v.optional(
	v.pipe(
		v.array(
			v.pipe(
				v.string(),
				v.trim(),
				v.minLength(1),
				v.maxLength(253),
				v.regex(
					/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/iu,
					'Domains must be hostnames without a protocol or path.'
				)
			)
		),
		v.maxLength(10)
	)
);

export const searchWebParameters = v.pipe(
	v.object({
		query: v.pipe(v.string(), v.trim(), v.minLength(2), v.maxLength(500)),
		numResults: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10))),
		includeDomains: optionalDomainList,
		excludeDomains: optionalDomainList,
		startPublishedDate: v.optional(isoDate),
		endPublishedDate: v.optional(isoDate)
	}),
	v.check(
		({ includeDomains, excludeDomains }) => !(includeDomains?.length && excludeDomains?.length),
		'includeDomains and excludeDomains are mutually exclusive.'
	),
	v.check(
		({ startPublishedDate, endPublishedDate }) =>
			Boolean(startPublishedDate) === Boolean(endPublishedDate),
		'startPublishedDate and endPublishedDate must be provided together.'
	),
	v.check(
		({ startPublishedDate, endPublishedDate }) =>
			!(startPublishedDate && endPublishedDate) || startPublishedDate <= endPublishedDate,
		'startPublishedDate must not be after endPublishedDate.'
	)
);

const httpUrl = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(2_048),
	v.url(),
	v.check((value) => {
		const protocol = new URL(value).protocol;
		return protocol === 'http:' || protocol === 'https:';
	}, 'URLs must use http or https.')
);

export const getWebContentParameters = v.object({
	urls: v.pipe(v.array(httpUrl), v.minLength(1), v.maxLength(10)),
	maxCharacters: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(500), v.maxValue(MAX_CONTENT_CHARACTERS))
	),
	includeSummary: v.optional(v.boolean())
});

const getString = (record: Record<string, unknown>, key: string) =>
	typeof record[key] === 'string' ? record[key] : undefined;

const getHttpUrl = (value: string | undefined) => {
	if (!value || value.length > 2_048) {
		return undefined;
	}
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
	} catch {
		return undefined;
	}
};

const requireApiKey = (apiKey: string | undefined) => {
	if (!apiKey) {
		throw new ProviderHttpError('Firecrawl', 'authentication');
	}
	return apiKey;
};

const readSearchResults = (payload: unknown) => {
	if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
		throw new ProviderHttpError('Firecrawl', 'invalid_response');
	}

	const web = payload.data.web;
	if (!Array.isArray(web)) {
		throw new ProviderHttpError('Firecrawl', 'invalid_response');
	}

	return web.flatMap((item) => {
		if (!isRecord(item)) {
			return [];
		}
		const url = getHttpUrl(getString(item, 'url'));
		if (!url) {
			return [];
		}
		return [
			{
				title: (getString(item, 'title') ?? url).slice(0, 300),
				url,
				description: getString(item, 'description')?.slice(0, 500) ?? null
			}
		];
	});
};

const readScrapeResult = (payload: unknown, requestedUrl: string, maxCharacters: number) => {
	if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
		throw new ProviderHttpError('Firecrawl', 'invalid_response');
	}
	if (typeof payload.data.markdown !== 'string') {
		throw new ProviderHttpError('Firecrawl', 'invalid_response');
	}

	const metadata = isRecord(payload.data.metadata) ? payload.data.metadata : {};
	const sourceUrl =
		getHttpUrl(getString(metadata, 'sourceURL')) ??
		getHttpUrl(getString(metadata, 'url')) ??
		requestedUrl;
	const markdown = payload.data.markdown;
	const summary = getString(payload.data, 'summary') ?? null;

	return {
		title: (getString(metadata, 'title') ?? sourceUrl).slice(0, 300),
		url: sourceUrl,
		markdown: markdown.slice(0, maxCharacters),
		summary: summary?.slice(0, maxCharacters) ?? null,
		truncated: markdown.length > maxCharacters || (summary?.length ?? 0) > maxCharacters
	};
};

const toFirecrawlDate = (value: string) => {
	const match = isoDatePattern.exec(value);
	if (!match) {
		throw new ProviderHttpError('Firecrawl', 'invalid_response');
	}
	return `${match[2]}/${match[3]}/${match[1]}`;
};

const buildTimeRange = (startPublishedDate: string, endPublishedDate: string) =>
	`cdr:1,cd_min:${toFirecrawlDate(startPublishedDate)},cd_max:${toFirecrawlDate(endPublishedDate)}`;

export const createFirecrawlTools = ({
	apiKey,
	fetcher = fetch,
	timeoutMs = DEFAULT_TIMEOUT_MS
}: {
	apiKey: string | undefined;
	fetcher?: ProviderFetch;
	timeoutMs?: number;
}) => {
	const requestJson = async ({
		url,
		init,
		maxBytes,
		signal,
		parent
	}: {
		url: string;
		init: RequestInit;
		maxBytes: number;
		signal?: AbortSignal;
		parent?: ProviderDeadline;
	}) => {
		const deadline = createProviderDeadline({ signal, parent, timeoutMs });
		try {
			const response = await requestProvider({
				provider: 'Firecrawl',
				url,
				init,
				deadline,
				fetcher
			});
			return await parseBoundedJson(response, maxBytes, 'Firecrawl', deadline);
		} finally {
			deadline.dispose();
		}
	};

	const searchWeb = defineTool({
		name: 'search_web',
		description:
			'Search the public web with Firecrawl. Use this for broad discovery; use get_web_content to read selected results.',
		parameters: searchWebParameters,
		execute: async (
			{ query, numResults, includeDomains, excludeDomains, startPublishedDate, endPublishedDate },
			signal
		) => {
			const payload = await requestJson({
				url: FIRECRAWL_SEARCH_URL,
				init: {
					method: 'POST',
					headers: {
						authorization: `Bearer ${requireApiKey(apiKey)}`,
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						query,
						limit: numResults ?? DEFAULT_RESULT_COUNT,
						sources: [{ type: 'web' }],
						ignoreInvalidURLs: true,
						...(startPublishedDate && endPublishedDate
							? { tbs: buildTimeRange(startPublishedDate, endPublishedDate) }
							: {}),
						...(includeDomains?.length ? { includeDomains } : {}),
						...(excludeDomains?.length ? { excludeDomains } : {})
					})
				},
				signal,
				maxBytes: SEARCH_RESPONSE_MAX_BYTES
			});
			const results = readSearchResults(payload).slice(0, numResults ?? DEFAULT_RESULT_COUNT);
			return JSON.stringify({ query, count: results.length, results });
		}
	});

	const getWebContent = defineTool({
		name: 'get_web_content',
		description:
			'Retrieve readable markdown from one to ten selected public URLs with Firecrawl. Returns compact source URLs, titles, content, and optional summaries.',
		parameters: getWebContentParameters,
		execute: async ({ urls: inputUrls, maxCharacters, includeSummary }, signal) => {
			const overallDeadline = createProviderDeadline({ signal, timeoutMs });
			const urls = [...new Set(inputUrls)];
			const characterLimit = maxCharacters ?? DEFAULT_CONTENT_CHARACTERS;
			const results: ReturnType<typeof readScrapeResult>[] = [];

			try {
				for (let index = 0; index < urls.length; index += MAX_CONCURRENT_SCRAPES) {
					const chunk = urls.slice(index, index + MAX_CONCURRENT_SCRAPES);
					const settled = await Promise.allSettled(
						chunk.map(async (url) => {
							const payload = await requestJson({
								url: FIRECRAWL_SCRAPE_URL,
								init: {
									method: 'POST',
									headers: {
										authorization: `Bearer ${requireApiKey(apiKey)}`,
										'content-type': 'application/json'
									},
									body: JSON.stringify({
										url,
										formats: includeSummary ? ['markdown', 'summary'] : ['markdown'],
										onlyMainContent: true
									})
								},
								maxBytes: SCRAPE_RESPONSE_MAX_BYTES,
								parent: overallDeadline
							});
							return readScrapeResult(payload, url, characterLimit);
						})
					);

					for (const result of settled) {
						if (result.status === 'rejected') {
							const reason: unknown = result.reason;
							throw reason instanceof ProviderHttpError
								? reason
								: new ProviderHttpError('Firecrawl', 'request_failed');
						}
						results.push(result.value);
					}
				}
			} finally {
				overallDeadline.dispose();
			}

			return JSON.stringify({ urls, count: results.length, results });
		}
	});

	return { searchWeb, getWebContent };
};
