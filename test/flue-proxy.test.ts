import { describe, expect, it } from 'vitest';
import {
	AgentRequestTooLargeError,
	MAX_AGENT_REQUEST_BYTES,
	stripAccessCredentials,
	submittedMessage
} from '../src/lib/server/flue-proxy';

describe('Flue proxy request handling', () => {
	it('extracts a submitted message within the body limit', async () => {
		const request = new Request('https://app.example.com/api/flue/agents/research-agent/1', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ message: 'Research this' })
		});

		await expect(submittedMessage(request)).resolves.toBe('Research this');
	});

	it('rejects a body larger than the agent request limit', async () => {
		const request = new Request('https://app.example.com/api/flue/agents/research-agent/1', {
			method: 'POST',
			body: 'x'.repeat(MAX_AGENT_REQUEST_BYTES + 1)
		});

		await expect(submittedMessage(request)).rejects.toBeInstanceOf(AgentRequestTooLargeError);
	});

	it('removes browser credentials and preserves the body before proxying', async () => {
		const request = new Request('https://flue-agent.internal/agents/research-agent/1', {
			method: 'POST',
			headers: {
				accept: 'text/event-stream',
				authorization: 'Bearer browser-token',
				'cf-access-client-id': 'client-id',
				'cf-access-client-secret': 'client-secret',
				'cf-access-authenticated-user-email': 'researcher@example.com',
				'cf-access-jwt-assertion': 'access-jwt',
				cookie: 'CF_Authorization=cookie-token'
			},
			body: JSON.stringify({ message: 'Research this' })
		});

		const sanitized = stripAccessCredentials(request);

		expect(sanitized.headers.get('accept')).toBe('text/event-stream');
		expect(sanitized.headers.get('authorization')).toBeNull();
		expect(sanitized.headers.get('cf-access-client-id')).toBeNull();
		expect(sanitized.headers.get('cf-access-client-secret')).toBeNull();
		expect(sanitized.headers.get('cf-access-authenticated-user-email')).toBeNull();
		expect(sanitized.headers.get('cf-access-jwt-assertion')).toBeNull();
		expect(sanitized.headers.get('cookie')).toBeNull();
		await expect(sanitized.json()).resolves.toEqual({ message: 'Research this' });
	});
});
