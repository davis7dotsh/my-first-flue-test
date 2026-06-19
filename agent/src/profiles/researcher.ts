import { defineAgentProfile } from '@flue/runtime';
import instructions from '../instructions/research-agent.md' with { type: 'markdown' };
import citationReview from '../skills/citation-review/SKILL.md' with { type: 'skill' };
import codeInvestigation from '../skills/code-investigation/SKILL.md' with { type: 'skill' };
import researchRouting from '../skills/research-routing/SKILL.md' with { type: 'skill' };
import { AGENT_MODEL, AGENT_THINKING_LEVEL } from '../model';

export const researcherProfile = defineAgentProfile({
	name: 'researcher',
	description:
		'Owns the conversation, routes research work, synthesizes evidence, and produces sourced answers.',
	model: AGENT_MODEL,
	thinkingLevel: AGENT_THINKING_LEVEL,
	instructions,
	skills: [researchRouting, codeInvestigation, citationReview]
});
