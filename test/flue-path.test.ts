import { describe, expect, it } from 'vitest';
import { parseFlueAgentPath } from '../src/lib/server/flue-path';

describe('Flue proxy path authorization', () => {
	it('accepts only the configured research agent route', () => {
		expect(parseFlueAgentPath('agents/research-agent/thread-123')).toEqual({
			agentName: 'research-agent',
			threadId: 'thread-123'
		});
	});

	it.each([
		'agents/demo-agent/thread-123',
		'agents/research-agent/thread-123/extra',
		'workflows/research-agent/thread-123',
		'agents/research-agent',
		'agents//thread-123',
		'agents/research-agent/%E0%A4%A'
	])('rejects unauthorized or malformed path %s', (path) => {
		expect(parseFlueAgentPath(path)).toBeNull();
	});
});
