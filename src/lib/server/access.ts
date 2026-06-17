import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

const accessJwtHeader = 'cf-access-jwt-assertion';

export type AccessConfig = {
	teamDomain: string;
	audience: string;
};

export type AccessIdentity = {
	subject: string;
	email: string | null;
};

export class AccessAuthenticationError extends Error {
	constructor() {
		super('Cloudflare Access authentication failed.');
		this.name = 'AccessAuthenticationError';
	}
}

function issuerFor(teamDomain: string) {
	return teamDomain.replace(/\/$/, '');
}

function identityFromPayload(payload: JWTPayload): AccessIdentity {
	if (typeof payload.sub !== 'string' || !payload.sub) {
		throw new AccessAuthenticationError();
	}

	return {
		subject: payload.sub,
		email: typeof payload.email === 'string' ? payload.email : null
	};
}

export async function verifyAccessToken(
	token: string,
	config: AccessConfig,
	key?: JWTVerifyGetKey
) {
	const issuer = issuerFor(config.teamDomain);
	const verificationKey = key ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

	try {
		const { payload } = await jwtVerify(token, verificationKey, {
			issuer,
			audience: config.audience,
			algorithms: ['RS256']
		});

		return identityFromPayload(payload);
	} catch {
		throw new AccessAuthenticationError();
	}
}

export async function authenticateAccessRequest(
	request: Request,
	config: AccessConfig,
	key?: JWTVerifyGetKey
) {
	const token = request.headers.get(accessJwtHeader);
	if (!token) {
		throw new AccessAuthenticationError();
	}

	return verifyAccessToken(token, config, key);
}
