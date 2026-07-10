/**
 * Mirrors `packages/api/src/permissions.ts` — kept as a small duplicated
 * file rather than a shared package, since these four bits change rarely.
 * Keep both in sync if you add permissions.
 */
export const Permissions = {
	TRACKING_LINK_VIEW: 1 << 0,
	TRACKING_LINK_EDIT: 1 << 1,
	TRACKING_LINK_ANALYTICS: 1 << 2,
	TRACKING_LINK_DELETE: 1 << 3,
} as const;

export function hasPermission(
	userPermissions: number,
	required: number,
): boolean {
	return (userPermissions & required) === required;
}
