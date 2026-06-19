import { env } from 'cloudflare:workers';
import { flue } from '@flue/runtime/routing';
import { registerCloudflareAi } from './cloudflare-ai';
import './observability';

type AgentBindings = {
	AI: Ai;
	AI_GATEWAY_ID?: string;
};

const bindings = env as AgentBindings;

registerCloudflareAi(bindings.AI, bindings.AI_GATEWAY_ID || 'default');

export default flue();
