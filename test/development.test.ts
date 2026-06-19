import { describe, expect, it } from 'vitest';
import { localDevelopmentIdentity } from '../src/lib/server/development';

describe('local development identity', () => {
	it.each([
		['http://localhost:5173', '::1'],
		['http://127.0.0.1:5173', '127.0.0.1'],
		['http://[::1]:5173', '::ffff:127.0.0.1']
	])('allows an exact loopback host and client in development', (url, clientAddress) => {
		expect(localDevelopmentIdentity(new URL(url), clientAddress, true)).toEqual({
			subject: 'local-development-user',
			email: 'local-development@localhost.invalid'
		});
	});

	it('does not bypass Access outside development mode', () => {
		expect(localDevelopmentIdentity(new URL('http://localhost:5173'), '::1', false)).toBeNull();
	});

	it('does not trust a loopback hostname from a remote client', () => {
		expect(
			localDevelopmentIdentity(new URL('http://localhost:5173'), '203.0.113.10', true)
		).toBeNull();
	});

	it('does not trust a non-loopback hostname from a local client', () => {
		expect(
			localDevelopmentIdentity(new URL('https://chat.example.com'), '127.0.0.1', true)
		).toBeNull();
	});
});
