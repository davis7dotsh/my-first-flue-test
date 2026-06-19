import { env } from 'cloudflare:workers';
import { registerProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
import './observability';

type AgentBindings = {
	AI: Ai;
	AI_GATEWAY_ID?: string;
};

const bindings = env as AgentBindings;

registerProvider('cloudflare', {
	api: 'cloudflare-ai-binding',
	binding: bindings.AI,
	gateway: {
		id: bindings.AI_GATEWAY_ID || 'default',
		collectLog: false,
		metadata: {
			application: 'flue-research-agent'
		}
	}
});

export default flue();
