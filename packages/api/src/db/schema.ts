import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('Projects', {
	projectId: text('project_id').primaryKey(),
	name: text('name').notNull(),
	destinationUrl: text('destination_url').notNull(),
	createdAt: text('created_at').notNull(),
	adminUserId: text('admin_user_id'),
});

export const qrCodes = sqliteTable(
	'QRCodes',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.projectId, { onDelete: 'cascade' }),
		// Generic, non-unique label for the source (e.g. "造形大ポスター").
		name: text('name').notNull(),
		// Source channel/type (e.g. "Instagram", "ポスター").
		medium: text('medium').notNull(),
		// Where the source is posted/displayed or handed out (free text, or a URL
		// for online sources) — unrelated to Projects.destinationUrl.
		location: text('location').notNull(),
		createdAt: text('created_at').notNull(),
		creatorId: text('creator_id'),
	},
	(table) => ({
		projectMediumLocation: uniqueIndex(
			'idx_qrcodes_project_medium_location',
		).on(table.projectId, table.medium, table.location),
	}),
);

export const accessLogs = sqliteTable('AccessLogs', {
	qrId: text('qr_id').notNull(),
	projectId: text('project_id').notNull(),
	accessedAt: text('accessed_at').notNull(),
	userAgent: text('user_agent'),
	ipAddress: text('ip_address'),
});
