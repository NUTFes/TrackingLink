import { SignJWT, jwtVerify } from 'jose';
import type { AuthUser, Verifier } from './types';

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h

/** Issues a session token for the built-in single-admin-password login (see `../routes/auth.ts`). */
export async function signLocalSession(
	user: AuthUser,
	secret: string,
): Promise<string> {
	return new SignJWT({ permissions: user.permissions })
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(user.sub)
		.setIssuedAt()
		.setExpirationTime(`${SESSION_TTL_SECONDS}s`)
		.sign(new TextEncoder().encode(secret));
}

/**
 * The default `Verifier`: checks a self-issued HS256 JWT signed by
 * `signLocalSession`. Single shared admin password, no per-user accounts —
 * enough to get running without any external identity provider, and easy
 * to swap out (see `Verifier` in `./types.ts`).
 */
export const verifyLocalSession: Verifier = async (token, env) => {
	try {
		const { payload } = await jwtVerify(
			token,
			new TextEncoder().encode(env.JWT_SECRET),
		);
		if (
			typeof payload.sub !== 'string' ||
			typeof payload.permissions !== 'number'
		) {
			return null;
		}
		return { sub: payload.sub, permissions: payload.permissions };
	} catch {
		return null;
	}
};
