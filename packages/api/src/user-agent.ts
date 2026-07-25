// Telling link-preview crawlers apart from people.
//
// Two things make this worth its own file rather than an inline `includes()`:
//
// 1. Getting it backwards is expensive. LINE is the dominant sharing app for
//    this audience and it shows up as *two different things* — its link-preview
//    crawler (`facebookexternalhit/1.1;line-poker/0.1`) is a bot, while its
//    in-app browser (`Line/13.15.0`) is a real person holding a phone. Sweeping
//    the latter into the bot bucket would delete the largest slice of real
//    traffic.
//
// 2. Bot hits are recorded with `is_bot = 1` rather than dropped, so a wrong
//    answer here is recoverable: the classifier can be refined later and past
//    rows recounted. That is the whole reason the column exists.
//
// This list is a starting point, not a finished answer. Before the event, look
// at what actually arrives and tune from real data rather than guesswork:
//
//   SELECT user_agent, COUNT(*) FROM AccessLogs
//   GROUP BY 1 ORDER BY 2 DESC LIMIT 50;

const BOT_PATTERNS: RegExp[] = [
	// Messaging / social link previews
	/facebookexternalhit/i,
	/line-poker/i, // LINE's preview crawler (not its in-app browser)
	/Discordbot/i,
	/Twitterbot/i,
	/Slackbot/i,
	/TelegramBot/i,
	/WhatsApp/i,
	/SkypeUriPreview/i,
	/LinkedInBot/i,
	/Pinterest/i,
	/redditbot/i,
	// Search engines
	/Googlebot/i,
	/Google-InspectionTool/i,
	/bingbot/i,
	/DuckDuckBot/i,
	/YandexBot/i,
	/Baiduspider/i,
	/Applebot/i,
	// Generic. `bot\b` matches "Somebot/1.0" and "…bot)" but not a word like
	// "robotics" mid-token, and no mainstream browser UA contains it.
	/bot\b/i,
	/crawler/i,
	/spider/i,
];

// Checked first, and wins outright. LINE's in-app browser must never be
// classified as a bot, whatever the patterns above happen to match.
const HUMAN_PATTERNS: RegExp[] = [/\bLine\/\d/i];

/** True when the request looks like a link-preview crawler rather than a person. */
export function isBotUserAgent(userAgent: string): boolean {
	if (HUMAN_PATTERNS.some((pattern) => pattern.test(userAgent))) return false;
	return BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

/**
 * True when the crawler should be served OG meta tags instead of a redirect.
 *
 * Currently the same set as `isBotUserAgent` — every crawler we recognise wants
 * a preview. Kept as a separate function because the two questions are
 * genuinely different ("should this count as a scan?" vs "what should we send
 * back?") and will diverge the moment we want to log a crawler without
 * rendering a preview for it.
 */
export function wantsLinkPreview(userAgent: string): boolean {
	return isBotUserAgent(userAgent);
}
