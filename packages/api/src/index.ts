import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type HonoEnv, authMiddleware } from './auth';
import { logFailure } from './log';
import authApp from './routes/auth';
import forwardApp from './routes/forward';
import projectsApp from './routes/projects';

const app = new Hono<HonoEnv>();

app.use('*', async (c, next) => {
	const allowed = (c.env.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean);

	// Fail closed. This used to fall back to '*' when the list was empty, which
	// meant a missing or misspelled ALLOWED_ORIGINS silently became wildcard CORS
	// with Authorization allowed — the most permissive possible setting reached by
	// the most ordinary possible mistake. An empty allow-list now blocks browser
	// callers, so a config error shows up immediately instead of quietly widening
	// access. Non-browser callers (the QR redirect, curl, monitoring) are
	// unaffected: CORS only governs cross-origin browser requests.
	return cors({
		origin: allowed,
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
		// Content-Disposition is not CORS-safelisted, so without this the admin UI
		// cannot read the filename the CSV endpoints build, and every export saves
		// under a name the client had to guess instead.
		exposeHeaders: ['Content-Disposition'],
		maxAge: 86400,
	})(c, next);
});

// Liveness. Deliberately not `GET /`, which belongs to the QR redirect and
// answers 404 without an `?id=` — pointing a monitor at it would alert forever.
app.get('/healthz', (c) =>
	c.json({ ok: true, version: c.env.GIT_SHA ?? 'dev' }),
);

// Readiness: liveness plus "can we actually reach D1". Costs one row read, so
// it is safe to poll every minute (~1,440 reads/day against a 5M/day quota).
app.get('/readyz', async (c) => {
	try {
		await c.env.DB.prepare('SELECT 1').first();
		return c.json({ ok: true });
	} catch (error) {
		logFailure('readyz_db_unreachable', error);
		return c.json({ ok: false }, 503);
	}
});

// QR scan → access log → redirect.
app.route('/', forwardApp);

// Session login/check.
app.route('/auth', authApp);

// Project + QR code management (requires a Bearer session token).
app.use('/projects/*', authMiddleware);
app.route('/projects', projectsApp);

app.notFound((c) => c.text('404 Not Found', 404));
app.onError((err, c) => {
	// Structured so Workers Logs indexes the fields and an unhandled error is
	// searchable by path/method/ray rather than being one line of prose.
	logFailure('unhandled_error', err, {
		method: c.req.method,
		path: new URL(c.req.url).pathname,
		ray: c.req.header('cf-ray') ?? null,
	});
	return c.text('Internal Server Error', 500);
});

export default app;
