import { defineAgentProfile } from '@flue/runtime';
import citationReview from '../skills/citation-review/SKILL.md' with { type: 'skill' };
import { AGENT_MODEL, AGENT_THINKING_LEVEL } from '../model';

export const browserInspectorProfile = defineAgentProfile({
	name: 'browser_inspector',
	description:
		'Reviews rendered-page evidence when an authorized browser capability is attached to this profile.',
	model: AGENT_MODEL,
	thinkingLevel: AGENT_THINKING_LEVEL,
	instructions: `Inspect rendered and interactive page evidence without guessing.

This profile does not currently have a Browser Run tool. If the delegated task requires live rendering, interaction, screenshots, or visual inspection, report that the capability is unavailable.
Analyze supplied screenshots or page evidence when present.
Do not imply that parent tools flowed into this profile; profiles are self-contained.`,
	skills: [citationReview]
});
