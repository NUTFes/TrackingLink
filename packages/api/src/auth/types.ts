export interface Bindings {
	DB: D1Database;
	/** Secret used to sign/verify the built-in admin session tokens. Only needed if you keep the default Verifier (see ./local.ts). */
	JWT_SECRET: string;
	/** Password required to log in to the admin UI/API. Only needed if you keep the default Verifier. */
	ADMIN_PASSWORD: string;
	/** Comma-separated list of origins allowed to call this API from a browser. */
	ALLOWED_ORIGINS?: string;
	/**
	 * Set to "true" to enable the CSV export endpoint. Defaults to disabled.
	 * A real JSON boolean is accepted too — `vars` in wrangler.jsonc is JSON, so
	 * `true` without quotes is an easy slip and should not silently do nothing.
	 */
	CSV_EXPORT_ENABLED?: string | boolean;
	/**
	 * Maximum rows one CSV export may contain before it returns 413 and asks the
	 * caller to narrow the date range. Defaults to 50,000, which costs 25 of the
	 * Workers Free 50-subrequest budget at the streaming page size.
	 */
	CSV_MAX_ROWS?: string | number;
	/**
	 * How the scan endpoint writes its access log. Defaults to "async", which
	 * takes the D1 write off the response path via waitUntil. Set to "sync" to
	 * await it instead — an escape hatch that can be flipped from the Cloudflare
	 * dashboard, without a deploy, if logged writes ever look like they are being
	 * dropped during an event.
	 */
	LOG_WRITE_MODE?: 'async' | 'sync';
	/**
	 * Rate limiter guarding POST /auth/login.
	 *
	 * Declared by hand because `unsafe` bindings are excluded from
	 * `wrangler types` generation. Optional so that a deployment without the
	 * binding still serves logins rather than locking everyone out — the handler
	 * logs loudly when it is missing instead.
	 */
	LOGIN_LIMITER?: RateLimiter;
	/** Build identifier surfaced by /healthz, for confirming what is deployed. */
	GIT_SHA?: string;
}

/** The shape of a Workers Rate Limiting binding (`type: "ratelimit"`). */
export interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AuthUser {
	sub: string;
	permissions: number;
}

export interface Variables {
	user?: AuthUser;
}

export interface HonoEnv {
	Bindings: Bindings;
	Variables: Variables;
}

/**
 * The one seam to replace if you want a different identity provider.
 *
 * A `Verifier` turns a Bearer token into an `AuthUser` (or `null` if it's
 * invalid/expired). It's a plain function, not a class, so plugging in your
 * own auth is: write a function matching this signature, then pass it to
 * `createAuthMiddleware` in place of the built-in `verifyLocalSession`
 * (see `src/auth/local.ts` and `src/auth/middleware.ts`).
 *
 * Example — verifying an externally-issued JWT (Auth0/Clerk/your own SSO)
 * via a JWKS endpoint instead of the built-in single-admin-password login:
 *
 * ```ts
 * import { createRemoteJWKSet, jwtVerify } from 'jose';
 * import { createAuthMiddleware, type Verifier } from './auth';
 *
 * const JWKS = createRemoteJWKSet(new URL('https://your-idp.example.com/.well-known/jwks.json'));
 *
 * const verifyExternalSession: Verifier = async (token) => {
 *   try {
 *     const { payload } = await jwtVerify(token, JWKS);
 *     return { sub: payload.sub as string, permissions: mapClaimsToPermissions(payload) };
 *   } catch {
 *     return null;
 *   }
 * };
 *
 * export const authMiddleware = createAuthMiddleware(verifyExternalSession);
 * ```
 *
 * Then swap the `authMiddleware` import in `src/index.ts` for this one —
 * every route that uses it (`/projects/*`) keeps working unchanged, since
 * they only depend on `c.get('user')` resolving to `{ sub, permissions }`.
 */
export type Verifier = (
	token: string,
	env: Bindings,
) => Promise<AuthUser | null>;
