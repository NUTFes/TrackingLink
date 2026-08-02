import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('Projects', {
	projectId: text('project_id').primaryKey(),
	name: text('name').notNull(),
	destinationUrl: text('destination_url').notNull(),
	// Keyword baked into this project's QR codes as `&p=<key>`, resolved against
	// the FALLBACK_DESTINATIONS var when D1 is unreachable. See schema.sql for why
	// this is a keyword rather than the destination URL.
	//
	// Deliberately not `.default('')`, for the same reason as qrCodes.location:
	// keeping it required in Drizzle forces every insert to pass a value, so the
	// code never depends on a column default being present in a given database.
	fallbackKey: text('fallback_key').notNull(),
	createdAt: text('created_at').notNull(),
	adminUserId: text('admin_user_id'),
});

// QR code *metadata*. The image is never persisted — the web app regenerates it
// client-side on every view. The row exists because the identifier is baked into
// the printed URL (`/?id=<...>`) and so has to stay stable forever, and because
// AccessLogs joins on it.
export const qrCodes = sqliteTable(
	'QRCodes',
	{
		id: text('id').primaryKey(),
		// Short stand-in for `id` in the printed URL, which takes the symbol from
		// 57x57 modules to 49x49 — see ../short-code.ts for the measurements and the
		// alphabet.
		//
		// Nullable because migrations/0004 adds it to existing rows empty and a
		// separate backfill fills them in; treat it as present everywhere and fall
		// back to `id` when it is not, since the scan endpoint resolves either. Never
		// reassign one — it is as printed, and as permanent, as the id.
		shortCode: text('short_code'),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.projectId, { onDelete: 'cascade' }),
		// What the QR code is printed on (e.g. "造形大ポスター"). Unique per
		// project: one QR code per physical item.
		name: text('name').notNull(),
		// Source channel/type (e.g. "Instagram", "ポスター").
		medium: text('medium').notNull(),
		// Where the item is posted/handed out — unrelated to
		// Projects.destinationUrl. Optional to the *caller*: stored as '' rather
		// than NULL when unset, so reads, CSV export and the unique index see one
		// representation.
		//
		// Deliberately NOT `.default('')` here even though schema.sql declares
		// DEFAULT '': a database upgraded via migrations/0002 still has plain
		// `location TEXT NOT NULL` with no default, so relying on the column
		// default would fail there. Keeping it required in Drizzle forces every
		// insert to pass `location ?? ''` explicitly, which works on both.
		location: text('location').notNull(),
		createdAt: text('created_at').notNull(),
		creatorId: text('creator_id'),
	},
	(table) => ({
		projectName: uniqueIndex('idx_qrcodes_project_name').on(
			table.projectId,
			table.name,
		),
		// The backstop behind the create path's collision retry. A duplicate would
		// point two posters at one row.
		shortCode: uniqueIndex('idx_qrcodes_short_code').on(table.shortCode),
	}),
);

export const accessLogs = sqliteTable(
	'AccessLogs',
	{
		// Autoincrement rowid. Needed as a tiebreaker for `accessed_at` ordering
		// (two scans can share a millisecond) and as the keyset cursor the
		// streaming CSV export pages on.
		id: integer('id').primaryKey({ autoIncrement: true }),
		qrId: text('qr_id')
			.notNull()
			.references(() => qrCodes.id, { onDelete: 'cascade' }),
		projectId: text('project_id').notNull(),
		accessedAt: text('accessed_at').notNull(),
		userAgent: text('user_agent'),
		ipAddress: text('ip_address'),
		// 1 for link-preview crawlers. Bot hits are flagged rather than dropped so
		// the classifier can be refined and past counts recomputed.
		isBot: integer('is_bot').notNull().default(0),
	},
	(table) => ({
		projectAccessedAt: index('idx_access_logs_project_accessed_at').on(
			table.projectId,
			table.accessedAt,
		),
		qrId: index('idx_access_logs_qr_id').on(table.qrId),
	}),
);
