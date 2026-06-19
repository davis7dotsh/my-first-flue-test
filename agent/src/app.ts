import { env } from 'cloudflare:workers';
import { registerProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
import './observability';

registerProvider('cloudflare', {
	api: 'cloudflare-ai-binding',
	binding: env.AI,
	gateway: {
		id: env.AI_GATEWAY_ID || 'default',
		collectLog: false,
		metadata: {
			application: 'flue-research-agent'
		}
	}
});

export default flue();
