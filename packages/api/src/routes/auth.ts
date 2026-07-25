import { Hono } from 'hono';
import * as z from 'zod';
import { type HonoEnv, authMiddleware, signLocalSession } from '../auth';
import { ErrorCodes, fail } from '../errors';
import { ALL_PERMISSIONS } from '../permissions';

const loginBodySchema = z.object({
	// Capped so an unauthenticated caller cannot make the Worker hash/compare an
	// arbitrarily large body.
	password: z.string().min(1).max(200),
});

const authApp = new Hono<HonoEnv>();

// POST /auth/login — exchange the shared admin password for a session token.
//
// This is the built-in single-admin login (see `../auth/local.ts`), meant to
// get you running without any external identity provider. If you need
// per-user accounts or SSO, write a new `Verifier` (see `Verifier` in
// `../auth/types.ts`) and swap it into `createAuthMiddleware` in
// `../auth/middleware.ts` — you can replace or remove this route entirely,
// since the rest of the API only cares that it ends up with a Bearer token
// that resolves to `{ sub, permissions }`.
authApp.post('/login', async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = loginBodySchema.safeParse(body);
	if (!parsed.success) {
		return fail(c, 400, ErrorCodes.PASSWORD_REQUIRED, { fields: ['password'] });
	}

	// A dedicated code, distinct from UNAUTHORIZED: the web app must not treat a
	// wrong password on the login form as "your session expired".
	if (parsed.data.password !== c.env.ADMIN_PASSWORD) {
		return fail(c, 401, ErrorCodes.INVALID_PASSWORD, { fields: ['password'] });
	}

	const token = await signLocalSession(
		{ sub: 'admin', permissions: ALL_PERMISSIONS },
		c.env.JWT_SECRET,
	);
	return c.json({ token });
});

// GET /auth/me — resolve the current session, for the admin UI to check on load.
authApp.get('/me', authMiddleware, async (c) => {
	return c.json(c.get('user'));
});

export default authApp;
