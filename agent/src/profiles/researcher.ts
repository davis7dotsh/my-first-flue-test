import { defineAgentProfile } from '@flue/runtime';
import instructions from '../instructions/research-agent.md' with { type: 'markdown' };
import { AGENT_MODEL, AGENT_THINKING_LEVEL } from '../model';

export const researcherProfile = defineAgentProfile({
	name: 'researcher',
	description:
		'Owns the conversation, routes research work, synthesizes evidence, and produces sourced answers.',
	model: AGENT_MODEL,
	thinkingLevel: AGENT_THINKING_LEVEL,
	instructions
});
