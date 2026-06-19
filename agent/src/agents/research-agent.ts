import { createAgent, defineTool, type AgentRouteHandler } from '@flue/runtime';
import * as v from 'valibot';
import { browserInspectorProfile } from '../profiles/browser-inspector';
import { codeInvestigatorProfile } from '../profiles/code-investigator';
import { researcherProfile } from '../profiles/researcher';
import { reviewerProfile } from '../profiles/reviewer';

export const route: AgentRouteHandler = async (_context, next) => next();

export const description =
	'A durable research and code-investigation agent with evidence-first specialist profiles.';

const runtimeCheck = defineTool({
	name: 'runtime_check',
	description:
		'Return a deterministic health payload. Use only when the user asks to verify this agent runtime or demonstrate typed tool calling.',
	parameters: v.object({
		label: v.pipe(
			v.string(),
			v.description('A short label describing what the user wants to test.')
		)
	}),
	execute: async ({ label }) =>
		JSON.stringify({
			ok: true,
			label,
			message: 'The typed Flue tool executed successfully inside the durable research agent.',
			steps: ['validated input', 'ran tool', 'returned result to the model']
		})
});

export default createAgent(() => ({
	profile: researcherProfile,
	tools: [runtimeCheck],
	subagents: [codeInvestigatorProfile, browserInspectorProfile, reviewerProfile],
	durability: {
		maxAttempts: 5,
		timeoutMs: 300_000
	}
}));
