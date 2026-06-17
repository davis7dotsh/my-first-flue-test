import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	AccessAuthenticationError,
	authenticateAccessRequest,
	verifyAccessToken,
	type AccessConfig
} from '../src/lib/server/access';

const config = {
	teamDomain: 'https://example.cloudflareaccess.com',
	audience: 'test-audience'
} satisfies AccessConfig;

let key: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;

beforeAll(async () => {
	const pair = await generateKeyPair('RS256', { extractable: true });
	privateKey = pair.privateKey;
	const jwk = await exportJWK(pair.publicKey);
	jwk.kid = 'test-key';
	jwk.alg = 'RS256';
	key = createLocalJWKSet({ keys: [jwk] });
});

function createToken(options?: { issuer?: string; audience?: string; expiresAt?: number }) {
	return new SignJWT({
		email: 'researcher@example.com'
	})
		.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
		.setSubject('access-user-123')
		.setIssuer(options?.issuer ?? config.teamDomain)
		.setAudience(options?.audience ?? config.audience)
		.setIssuedAt()
		.setExpirationTime(options?.expiresAt ?? Math.floor(Date.now() / 1000) + 300)
		.sign(privateKey);
}

describe('Cloudflare Access authentication', () => {
	it('accepts a valid Access JWT', async () => {
		const token = await createToken();
		const identity = await verifyAccessToken(token, config, key);

		expect(identity).toEqual({
			subject: 'access-user-123',
			email: 'researcher@example.com'
		});
	});

	it('rejects a token for a different audience', async () => {
		const token = await createToken({ audience: 'other-application' });

		await expect(verifyAccessToken(token, config, key)).rejects.toBeInstanceOf(
			AccessAuthenticationError
		);
	});

	it('rejects a token from a different issuer', async () => {
		const token = await createToken({
			issuer: 'https://other.cloudflareaccess.com'
		});

		await expect(verifyAccessToken(token, config, key)).rejects.toBeInstanceOf(
			AccessAuthenticationError
		);
	});

	it('rejects an expired token', async () => {
		const token = await createToken({
			expiresAt: Math.floor(Date.now() / 1000) - 60
		});

		await expect(verifyAccessToken(token, config, key)).rejects.toBeInstanceOf(
			AccessAuthenticationError
		);
	});

	it('rejects a request without the Access assertion header', async () => {
		const request = new Request('https://app.example.com/');

		await expect(authenticateAccessRequest(request, config, key)).rejects.toBeInstanceOf(
			AccessAuthenticationError
		);
	});
});
