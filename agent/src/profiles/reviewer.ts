import { defineAgentProfile } from '@flue/runtime';
import citationReview from '../skills/citation-review/SKILL.md' with { type: 'skill' };
import { AGENT_MODEL, AGENT_THINKING_LEVEL } from '../model';

export const reviewerProfile = defineAgentProfile({
	name: 'reviewer',
	description:
		'Performs a read-only correctness review of claims, evidence, citations, and acknowledged limitations.',
	model: AGENT_MODEL,
	thinkingLevel: AGENT_THINKING_LEVEL,
	instructions: `Review the supplied draft and evidence without taking side effects.

Identify unsupported claims, missing caveats, citation mismatches, and contradictions.
Do not perform new research unless a tool is explicitly attached to this profile.
Do not imply that parent tools flowed into this profile; profiles are self-contained.`,
	skills: [citationReview]
});
