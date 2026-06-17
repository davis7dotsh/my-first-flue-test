import { createAgent, defineTool, type AgentRouteHandler } from '@flue/runtime';
import * as v from 'valibot';

export const route: AgentRouteHandler = async (_context, next) => next();

const runTest = defineTool({
	name: 'run_test',
	description:
		'Run the demo test and return a deterministic success payload. Use this whenever the user asks to test, check, or demonstrate tool calling.',
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
			message: 'The typed Flue tool executed successfully inside the durable agent.',
			steps: ['validated input', 'ran tool', 'returned result to the model']
		})
});

export default createAgent(() => ({
	model: 'openrouter/openai/gpt-5.4-mini',
	description: 'A small general-purpose assistant with one visible test tool.',
	instructions: `You are a concise, thoughtful general assistant.

Answer ordinary questions directly and clearly.
When the user asks to test, check, or demonstrate the tool, call run_test before answering.
Never claim the tool ran unless you actually called it.
There is no project repository or external sandbox attached to this agent. Do not use filesystem or shell tools.
When run_test completes, briefly explain what its result proves about this Flue agent.`,
	tools: [runTest],
	durability: {
		maxAttempts: 5,
		timeoutMs: 300_000
	}
}));
