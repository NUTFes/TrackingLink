import type { MiddlewareHandler } from 'hono';
import { verifyLocalSession } from './local';
import type { HonoEnv, Verifier } from './types';

function extractBearerToken(
	authHeader: string | undefined | null,
): string | null {
	if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
	const token = authHeader.slice(7);
	return token.length > 0 ? token : null;
}

/**
 * Builds a Hono middleware that verifies the caller's Bearer token with the
 * given `Verifier` and attaches the result to `c.get('user')`.
 *
 * To use a different identity provider, write your own `Verifier` (see
 * `Verifier` in `./types.ts` for an example) and call
 * `createAuthMiddleware(yourVerifier)` instead of using the default
 * `authMiddleware` export below.
 */
export function createAuthMiddleware(
	verify: Verifier,
): MiddlewareHandler<HonoEnv> {
	return async (c, next) => {
		const token = extractBearerToken(c.req.header('Authorization'));
		if (!token) {
			return c.json({ error: 'Authorization header required' }, 401);
		}

		const user = await verify(token, c.env);
		if (!user) {
			return c.json({ error: 'Invalid or expired token' }, 401);
		}

		c.set('user', user);
		await next();
	};
}

/** Default middleware, wired to the built-in single-admin-password strategy (`./local.ts`). */
export const authMiddleware = createAuthMiddleware(verifyLocalSession);
