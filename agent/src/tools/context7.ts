import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import {
	createProviderDeadline,
	isRecord,
	parseBoundedJson,
	readBoundedText,
	type ProviderFetch,
	ProviderHttpError,
	requestProvider
} from './provider-http';

const CONTEXT7_API_BASE = 'https://context7.com/api/v2';
const DEFAULT_TIMEOUT_MS = 30_000;
const SEARCH_RESPONSE_MAX_BYTES = 512_000;
const CONTEXT_RESPONSE_MAX_BYTES = 512_000;
const DEFAULT_DOC_CHARACTERS = 10_000;
const MAX_DOC_CHARACTERS = 20_000;
const libraryIdPattern = /^\/[^/\s?#@]+\/[^/\s?#@]+(?:@[^/\s?#@]+|\/[^/\s?#@]+)?$/u;

export const getLibraryDocsParameters = v.object({
	libraryName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)),
	query: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)),
	libraryId: v.optional(
		v.pipe(
			v.string(),
			v.trim(),
			v.minLength(2),
			v.maxLength(500),
			v.regex(
				libraryIdPattern,
				'Context7 library IDs must use /source/name with an optional /version or @version suffix.'
			)
		)
	),
	maxCharacters: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1_000), v.maxValue(MAX_DOC_CHARACTERS))
	)
});

const requireApiKey = (apiKey: string | undefined) => {
	if (!apiKey) {
		throw new ProviderHttpError('Context7', 'authentication');
	}
	return apiKey;
};

const readMatches = (payload: unknown) => {
	if (!isRecord(payload) || !Array.isArray(payload.results)) {
		throw new ProviderHttpError('Context7', 'invalid_response');
	}

	return payload.results
		.flatMap((item) => {
			if (
				!isRecord(item) ||
				typeof item.id !== 'string' ||
				item.id.length > 500 ||
				!libraryIdPattern.test(item.id)
			) {
				return [];
			}
			return [
				{
					id: item.id,
					title: (typeof item.title === 'string' ? item.title : item.id).slice(0, 300)
				}
			];
		})
		.slice(0, 5);
};

export const createContext7Tool = ({
	apiKey,
	fetcher = fetch,
	timeoutMs = DEFAULT_TIMEOUT_MS
}: {
	apiKey: string | undefined;
	fetcher?: ProviderFetch;
	timeoutMs?: number;
}) =>
	defineTool({
		name: 'get_library_docs',
		description:
			'Fetch current documentation and code examples for a named library from Context7. Prefer this over web search for library, framework, and API questions.',
		parameters: getLibraryDocsParameters,
		execute: async ({ libraryName, query, libraryId: exactLibraryId, maxCharacters }, signal) => {
			const headers = { authorization: `Bearer ${requireApiKey(apiKey)}` };
			const overallDeadline = createProviderDeadline({ signal, timeoutMs });
			let matches: ReturnType<typeof readMatches> = [];

			const request = async (url: URL, maxBytes: number, format: 'json' | 'text') => {
				const deadline = createProviderDeadline({ parent: overallDeadline, timeoutMs });
				try {
					const response = await requestProvider({
						provider: 'Context7',
						url,
						init: { method: 'GET', headers },
						deadline,
						fetcher
					});
					return format === 'json'
						? await parseBoundedJson(response, maxBytes, 'Context7', deadline)
						: await readBoundedText(response, maxBytes, 'Context7', deadline);
				} finally {
					deadline.dispose();
				}
			};

			try {
				if (!exactLibraryId) {
					const searchUrl = new URL(`${CONTEXT7_API_BASE}/libs/search`);
					searchUrl.searchParams.set('libraryName', libraryName);
					searchUrl.searchParams.set('query', query);
					matches = readMatches(await request(searchUrl, SEARCH_RESPONSE_MAX_BYTES, 'json'));
				}

				const libraryId = exactLibraryId ?? matches[0]?.id ?? null;
				if (!libraryId) {
					return JSON.stringify({
						libraryName,
						libraryId: null,
						query,
						matches,
						content: '',
						message: `No Context7 library matched "${libraryName}".`
					});
				}

				const contextUrl = new URL(`${CONTEXT7_API_BASE}/context`);
				contextUrl.searchParams.set('libraryId', libraryId);
				contextUrl.searchParams.set('query', query);
				contextUrl.searchParams.set('type', 'txt');
				const content = await request(contextUrl, CONTEXT_RESPONSE_MAX_BYTES, 'text');
				if (typeof content !== 'string') {
					throw new ProviderHttpError('Context7', 'invalid_response');
				}
				const characterLimit = maxCharacters ?? DEFAULT_DOC_CHARACTERS;

				return JSON.stringify({
					libraryName,
					libraryId,
					query,
					matches,
					content: content.slice(0, characterLimit),
					truncated: content.length > characterLimit
				});
			} finally {
				overallDeadline.dispose();
			}
		}
	});
