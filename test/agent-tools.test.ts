import { describe, expect, it } from 'vitest';
import { createContext7Tool } from '../agent/src/tools/context7';
import { createFirecrawlTools } from '../agent/src/tools/firecrawl';
import {
	createProviderDeadline,
	isRecord,
	readBoundedText,
	type ProviderFetch
} from '../agent/src/tools/provider-http';

const parseJsonRecord = (text: string) => {
	const value: unknown = JSON.parse(text);
	if (!isRecord(value)) {
		throw new Error('Expected a JSON object.');
	}
	return value;
};

const getRequestBody = (init: RequestInit | undefined) => {
	if (typeof init?.body !== 'string') {
		throw new Error('Expected a JSON request body.');
	}
	return parseJsonRecord(init.body);
};

const getUrl = (input: Request | string | URL) => {
	if (input instanceof URL) {
		return input;
	}
	return new URL(typeof input === 'string' ? input : input.url);
};

describe('research tool validation', () => {
	const fetcher: ProviderFetch = async () => {
		throw new Error('Validation should run before fetch.');
	};

	it('rejects mutually exclusive search domain filters', async () => {
		const { searchWeb } = createFirecrawlTools({ apiKey: 'secret', fetcher });
		await expect(
			searchWeb.execute({
				query: 'worker tools',
				includeDomains: ['example.com'],
				excludeDomains: ['other.example']
			})
		).rejects.toThrow('includeDomains and excludeDomains are mutually exclusive.');
	});

	it('bounds result counts, content sizes, and Context7 sizes', async () => {
		const { searchWeb, getWebContent } = createFirecrawlTools({ apiKey: 'secret', fetcher });
		const getLibraryDocs = createContext7Tool({ apiKey: 'secret', fetcher });

		await expect(searchWeb.execute({ query: 'test', numResults: 11 })).rejects.toThrow(
			'do not match the required schema'
		);
		await expect(
			getWebContent.execute({
				urls: ['https://example.com'],
				maxCharacters: 6_001
			})
		).rejects.toThrow('do not match the required schema');
		await expect(
			getLibraryDocs.execute({
				libraryName: 'svelte',
				query: 'runes',
				maxCharacters: 20_001
			})
		).rejects.toThrow('do not match the required schema');
	});

	it('accepts only HTTP(S) content URLs', async () => {
		const { getWebContent } = createFirecrawlTools({ apiKey: 'secret', fetcher });
		await expect(getWebContent.execute({ urls: ['ftp://example.com/file'] })).rejects.toThrow(
			'URLs must use http or https.'
		);
	});

	it('requires a valid, ordered pair of Firecrawl dates', async () => {
		const { searchWeb } = createFirecrawlTools({ apiKey: 'secret', fetcher });
		await expect(
			searchWeb.execute({ query: 'test', startPublishedDate: '2026-01-01' })
		).rejects.toThrow('must be provided together');
		await expect(
			searchWeb.execute({
				query: 'test',
				startPublishedDate: '2026-02-30',
				endPublishedDate: '2026-03-01'
			})
		).rejects.toThrow('real calendar date');
		await expect(
			searchWeb.execute({
				query: 'test',
				startPublishedDate: '2026-03-02',
				endPublishedDate: '2026-03-01'
			})
		).rejects.toThrow('must not be after');
	});

	it('requires documented Context7 library ID shapes', async () => {
		const getLibraryDocs = createContext7Tool({ apiKey: 'secret', fetcher });
		for (const libraryId of ['/one', '/a/b/c/d', '/a//b', '/a/b?query=yes']) {
			await expect(
				getLibraryDocs.execute({ libraryName: 'test', libraryId, query: 'usage' })
			).rejects.toThrow('must use /source/name');
		}
	});
});

describe('Firecrawl tools', () => {
	it('returns compact search results and forwards supported filters', async () => {
		let requestBody: Record<string, unknown> | undefined;
		const fetcher: ProviderFetch = async (_input, init) => {
			requestBody = getRequestBody(init);
			return Response.json({
				success: true,
				data: {
					web: [
						{
							title: 'Workers docs',
							url: 'https://developers.cloudflare.com/workers/',
							description: 'Cloudflare Workers documentation'
						}
					]
				}
			});
		};
		const { searchWeb } = createFirecrawlTools({ apiKey: 'firecrawl-secret', fetcher });

		const result = parseJsonRecord(
			await searchWeb.execute({
				query: 'Cloudflare Workers',
				numResults: 3,
				includeDomains: ['developers.cloudflare.com'],
				startPublishedDate: '2026-01-01',
				endPublishedDate: '2026-02-28'
			})
		);

		expect(result.count).toBe(1);
		expect(result.results).toEqual([
			{
				title: 'Workers docs',
				url: 'https://developers.cloudflare.com/workers/',
				description: 'Cloudflare Workers documentation'
			}
		]);
		expect(JSON.stringify(result)).not.toContain('firecrawl-secret');
		expect(requestBody).toMatchObject({
			query: 'Cloudflare Workers',
			limit: 3,
			tbs: 'cdr:1,cd_min:01/01/2026,cd_max:02/28/2026',
			includeDomains: ['developers.cloudflare.com'],
			sources: [{ type: 'web' }]
		});
	});

	it('deduplicates URLs, bounds concurrency, and truncates content', async () => {
		let active = 0;
		let peakActive = 0;
		const requestedUrls: string[] = [];
		const fetcher: ProviderFetch = async (_input, init) => {
			const body = getRequestBody(init);
			if (typeof body.url !== 'string') {
				throw new Error('Expected a URL.');
			}
			requestedUrls.push(body.url);
			active += 1;
			peakActive = Math.max(peakActive, active);
			await new Promise((resolve) => setTimeout(resolve, 1));
			active -= 1;
			return Response.json({
				success: true,
				data: {
					markdown: 'm'.repeat(700),
					summary: 's'.repeat(700),
					metadata: { title: body.url, sourceURL: body.url }
				}
			});
		};
		const { getWebContent } = createFirecrawlTools({ apiKey: 'firecrawl-secret', fetcher });
		const urls = [
			'https://one.example',
			'https://two.example',
			'https://three.example',
			'https://four.example',
			'https://five.example',
			'https://one.example'
		];

		const result = parseJsonRecord(
			await getWebContent.execute({ urls, maxCharacters: 500, includeSummary: true })
		);
		const results = Array.isArray(result.results) ? result.results : [];

		expect(requestedUrls).toEqual(urls.slice(0, 5));
		expect(peakActive).toBe(3);
		expect(result.count).toBe(5);
		expect(
			results.every(
				(item) =>
					isRecord(item) &&
					typeof item.markdown === 'string' &&
					item.markdown.length === 500 &&
					item.truncated === true
			)
		).toBe(true);
	});

	it.each([
		[401, 'Firecrawl authentication failed.'],
		[408, 'Firecrawl request timed out.'],
		[429, 'Firecrawl rate limit was reached.'],
		[503, 'Firecrawl is temporarily unavailable.']
	])('sanitizes provider status %i', async (status, message) => {
		const fetcher: ProviderFetch = async () => new Response('private detail', { status });
		const { searchWeb } = createFirecrawlTools({ apiKey: 'firecrawl-secret', fetcher });

		await expect(searchWeb.execute({ query: 'workers' })).rejects.toThrow(message);
	});

	it('sanitizes thrown errors and never exposes the API key', async () => {
		const secret = 'firecrawl-super-secret';
		const fetcher: ProviderFetch = async () => {
			throw new Error(`transport failed with ${secret}`);
		};
		const { searchWeb } = createFirecrawlTools({ apiKey: secret, fetcher });

		let errorMessage = '';
		try {
			await searchWeb.execute({ query: 'workers' });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}

		expect(errorMessage).toBe('Firecrawl request failed.');
		expect(errorMessage).not.toContain(secret);
	});

	it('rejects malformed and oversized JSON responses', async () => {
		const malformed: ProviderFetch = async () => Response.json({ success: true, data: {} });
		const oversized: ProviderFetch = async () =>
			new Response('{}', { headers: { 'content-length': '9999999' } });

		await expect(
			createFirecrawlTools({ apiKey: 'secret', fetcher: malformed }).searchWeb.execute({
				query: 'workers'
			})
		).rejects.toThrow('Firecrawl returned an invalid response.');
		await expect(
			createFirecrawlTools({ apiKey: 'secret', fetcher: oversized }).searchWeb.execute({
				query: 'workers'
			})
		).rejects.toThrow('Firecrawl returned too much data.');
	});

	it('rejects a scrape response without requested markdown', async () => {
		const fetcher: ProviderFetch = async () =>
			Response.json({ success: true, data: { metadata: { title: 'Missing markdown' } } });
		const { getWebContent } = createFirecrawlTools({ apiKey: 'secret', fetcher });

		await expect(getWebContent.execute({ urls: ['https://example.com'] })).rejects.toThrow(
			'Firecrawl returned an invalid response.'
		);
	});

	it('enforces streaming response limits without Content-Length', async () => {
		const response = new Response('x'.repeat(101));
		await expect(readBoundedText(response, 100, 'Firecrawl')).rejects.toThrow(
			'Firecrawl returned too much data.'
		);
	});

	it('times out while reading a stalled response body', async () => {
		const response = new Response(new ReadableStream({ start() {} }));
		const deadline = createProviderDeadline({ timeoutMs: 5 });
		try {
			await expect(readBoundedText(response, 100, 'Firecrawl', deadline)).rejects.toThrow(
				'Firecrawl request timed out.'
			);
		} finally {
			deadline.dispose();
		}
	});

	it('uses one deadline across response headers and body consumption', async () => {
		let requestSignal: AbortSignal | undefined;
		const fetcher: ProviderFetch = async (_input, init) => {
			requestSignal = init?.signal ?? undefined;
			return new Response(new ReadableStream({ start() {} }));
		};
		const { searchWeb } = createFirecrawlTools({ apiKey: 'secret', fetcher, timeoutMs: 5 });

		await expect(searchWeb.execute({ query: 'workers' })).rejects.toThrow(
			'Firecrawl request timed out.'
		);
		expect(requestSignal?.aborted).toBe(true);
	});

	it('bounds the complete multi-batch content operation', async () => {
		let calls = 0;
		let releaseFirstBatch = () => undefined;
		const firstBatchGate = new Promise<void>((resolve) => {
			releaseFirstBatch = resolve;
		});
		const fetcher: ProviderFetch = async (_input, init) => {
			calls += 1;
			if (calls <= 3) {
				await firstBatchGate;
				return Response.json({ success: true, data: { markdown: 'content' } });
			}
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
					once: true
				});
			});
		};
		const { getWebContent } = createFirecrawlTools({
			apiKey: 'secret',
			fetcher,
			timeoutMs: 25
		});

		const pending = getWebContent.execute({
			urls: [
				'https://one.example',
				'https://two.example',
				'https://three.example',
				'https://four.example'
			]
		});
		while (calls < 3) {
			await Promise.resolve();
		}
		releaseFirstBatch();

		await expect(pending).rejects.toThrow('Firecrawl request timed out.');
		expect(calls).toBe(4);
	});

	it('times out and propagates caller cancellation with sanitized errors', async () => {
		const hangingFetch: ProviderFetch = async (_input, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
					once: true
				});
			});
		const timeoutTool = createFirecrawlTools({
			apiKey: 'secret',
			fetcher: hangingFetch,
			timeoutMs: 5
		}).searchWeb;

		await expect(timeoutTool.execute({ query: 'workers' })).rejects.toThrow(
			'Firecrawl request timed out.'
		);

		const controller = new AbortController();
		const abortTool = createFirecrawlTools({
			apiKey: 'secret',
			fetcher: hangingFetch,
			timeoutMs: 1_000
		}).searchWeb;
		const pending = abortTool.execute({ query: 'workers' }, controller.signal);
		controller.abort();

		await expect(pending).rejects.toThrow('Firecrawl request was cancelled.');
	});
});

describe('Context7 tool', () => {
	it('resolves a library and returns bounded plain-text context', async () => {
		const urls: URL[] = [];
		const fetcher: ProviderFetch = async (input) => {
			const url = getUrl(input);
			urls.push(url);
			if (url.pathname.endsWith('/libs/search')) {
				return Response.json({
					results: [{ id: '/sveltejs/svelte', title: 'Svelte' }],
					searchFilterApplied: false
				});
			}
			return new Response('d'.repeat(1_200));
		};
		const tool = createContext7Tool({ apiKey: 'context7-secret', fetcher });

		const result = parseJsonRecord(
			await tool.execute({
				libraryName: 'svelte',
				query: 'How do runes work?',
				maxCharacters: 1_000
			})
		);

		expect(result.libraryId).toBe('/sveltejs/svelte');
		expect(result.content).toBe('d'.repeat(1_000));
		expect(result.truncated).toBe(true);
		expect(urls).toHaveLength(2);
		expect(urls[1]?.searchParams.get('type')).toBe('txt');
	});

	it('uses an exact library ID without searching', async () => {
		let calls = 0;
		const fetcher: ProviderFetch = async (input) => {
			calls += 1;
			expect(getUrl(input).pathname).toBe('/api/v2/context');
			return new Response('Exact docs');
		};
		const tool = createContext7Tool({ apiKey: 'context7-secret', fetcher });

		const result = parseJsonRecord(
			await tool.execute({
				libraryName: 'Svelte',
				libraryId: '/sveltejs/svelte',
				query: 'runes'
			})
		);

		expect(calls).toBe(1);
		expect(result.content).toBe('Exact docs');
	});

	it.each([
		'/vercel/next.js',
		'/packages/name',
		'/websites/name',
		'/vercel/next.js@v15.1.8',
		'/vercel/next.js/v15.1.8'
	])('accepts documented library ID %s', async (libraryId) => {
		const fetcher: ProviderFetch = async () => new Response('Docs');
		const tool = createContext7Tool({ apiKey: 'context7-secret', fetcher });
		const result = parseJsonRecord(
			await tool.execute({ libraryName: 'library', libraryId, query: 'usage' })
		);

		expect(result.libraryId).toBe(libraryId);
	});

	it('ignores malformed provider library IDs', async () => {
		const fetcher: ProviderFetch = async () =>
			Response.json({ results: [{ id: '/one', title: 'Invalid' }] });
		const tool = createContext7Tool({ apiKey: 'context7-secret', fetcher });
		const result = parseJsonRecord(await tool.execute({ libraryName: 'invalid', query: 'usage' }));

		expect(result.libraryId).toBeNull();
	});

	it('returns a stable no-match result without fetching context', async () => {
		let calls = 0;
		const fetcher: ProviderFetch = async () => {
			calls += 1;
			return Response.json({ results: [], searchFilterApplied: false });
		};
		const tool = createContext7Tool({ apiKey: 'context7-secret', fetcher });
		const result = parseJsonRecord(
			await tool.execute({ libraryName: 'not-a-library', query: 'usage' })
		);

		expect(calls).toBe(1);
		expect(result.libraryId).toBeNull();
		expect(result.content).toBe('');
		expect(result.message).toBe('No Context7 library matched "not-a-library".');
	});

	it.each([
		[202, 'Context7 library documentation is not ready yet.'],
		[401, 'Context7 authentication failed.'],
		[429, 'Context7 rate limit was reached.'],
		[500, 'Context7 is temporarily unavailable.']
	])('sanitizes provider status %i', async (status, message) => {
		const secret = 'context7-super-secret';
		const fetcher: ProviderFetch = async () =>
			new Response(`private error containing ${secret}`, { status });
		const tool = createContext7Tool({ apiKey: secret, fetcher });

		let errorMessage = '';
		try {
			await tool.execute({ libraryName: 'svelte', query: 'runes' });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}

		expect(errorMessage).toBe(message);
		expect(errorMessage).not.toContain(secret);
	});

	it('rejects malformed search data and oversized context', async () => {
		const malformedTool = createContext7Tool({
			apiKey: 'secret',
			fetcher: async () => Response.json({ results: 'wrong' })
		});
		await expect(malformedTool.execute({ libraryName: 'svelte', query: 'runes' })).rejects.toThrow(
			'Context7 returned an invalid response.'
		);

		const oversizedTool = createContext7Tool({
			apiKey: 'secret',
			fetcher: async () => new Response('docs', { headers: { 'content-length': '9999999' } })
		});
		await expect(
			oversizedTool.execute({
				libraryName: 'svelte',
				libraryId: '/sveltejs/svelte',
				query: 'runes'
			})
		).rejects.toThrow('Context7 returned too much data.');
	});
});
