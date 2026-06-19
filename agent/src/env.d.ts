export {};

declare global {
	namespace Cloudflare {
		interface Env {
			FIRECRAWL_API_KEY?: string;
			CONTEXT7_API_KEY?: string;
		}
	}
}
