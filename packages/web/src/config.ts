// Base URL of the tracking-link API worker, e.g. http://localhost:8789 in
// dev or https://links.example.com in production. Set via `.env` (see
// `.env.example`) — Vite only exposes vars prefixed with VITE_.
export const TRACKING_LINK_API_URL =
	import.meta.env.VITE_API_URL ?? 'http://localhost:8789';
