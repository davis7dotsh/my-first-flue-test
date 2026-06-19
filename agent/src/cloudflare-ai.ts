import { registerApiProvider, registerProvider } from '@flue/runtime';
import { getCloudflareAIBindingApiProvider } from '@flue/runtime/cloudflare/internal';
import type { Model } from '@earendil-works/pi-ai';
import { AGENT_MODEL_ID } from './model';

const unifiedBindingApi = 'cloudflare-unified-ai-binding';
const contextWindow = 1_000_000;
const maxTokens = 128_000;

export function registerCloudflareAi(binding: Ai, gatewayId: string) {
	const bindingProvider = getCloudflareAIBindingApiProvider();
	const gateway = {
		id: gatewayId,
		collectLog: false,
		metadata: {
			application: 'flue-research-agent'
		}
	};

	// Flue beta.1 does not yet catalog third-party models exposed by the AI binding.
	// Bridge its transport here so GPT-5.5 keeps real context limits and low reasoning.
	const withBinding = (
		model: Model<typeof unifiedBindingApi>
	): Model<'cloudflare-ai-binding'> & { binding: Ai; gateway: typeof gateway } => ({
		...model,
		api: 'cloudflare-ai-binding',
		reasoning: model.id === AGENT_MODEL_ID || model.reasoning,
		binding,
		gateway
	});

	registerApiProvider({
		api: unifiedBindingApi,
		stream: (model, context, options) =>
			bindingProvider.stream(withBinding(model), context, options),
		streamSimple: (model, context, options) =>
			bindingProvider.streamSimple(withBinding(model), context, options)
	});

	registerProvider('cloudflare', {
		api: unifiedBindingApi,
		baseUrl: 'https://cloudflare-ai-binding.invalid',
		models: {
			[AGENT_MODEL_ID]: {
				contextWindow,
				maxTokens
			}
		}
	});
}
