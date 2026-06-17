import { defineAgentProfile } from '@flue/runtime';
import instructions from '../instructions/research-agent.md' with { type: 'markdown' };
import citationReview from '../skills/citation-review/SKILL.md' with { type: 'skill' };
import codeInvestigation from '../skills/code-investigation/SKILL.md' with { type: 'skill' };
import researchRouting from '../skills/research-routing/SKILL.md' with { type: 'skill' };

export const researcherProfile = defineAgentProfile({
	name: 'researcher',
	description:
		'Owns the conversation, routes research work, synthesizes evidence, and produces sourced answers.',
	model: 'cloudflare/@cf/moonshotai/kimi-k2.7-code',
	thinkingLevel: 'high',
	instructions,
	skills: [researchRouting, codeInvestigation, citationReview]
});
