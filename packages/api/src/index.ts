import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type HonoEnv, authMiddleware } from './auth';
import authApp from './routes/auth';
import forwardApp from './routes/forward';
import projectsApp from './routes/projects';

const app = new Hono<HonoEnv>();

app.use('*', async (c, next) => {
	const allowed = (c.env.ALLOWED_ORIGINS ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean);

	return cors({
		origin: allowed.length > 0 ? allowed : '*',
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
		maxAge: 86400,
	})(c, next);
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
	console.error('Unhandled error:', err);
	return c.text('Internal Server Error', 500);
});

export default app;
