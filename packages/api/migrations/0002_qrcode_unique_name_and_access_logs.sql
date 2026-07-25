-- One-time migration for databases created before:
--   * QRCodes was unique on (project_id, name) instead of
--     (project_id, medium, location)
--   * AccessLogs had an id column exposed, an is_bot column, a foreign key to
--     QRCodes, and a (project_id, accessed_at) index
--
-- Not idempotent. A brand-new database does not need this at all — schema.sql
-- already creates everything below.
--
-- BEFORE RUNNING:
--
-- 1. Take a backup. This rebuilds AccessLogs, which is the only step here that
--    is hard to undo:
--      wrangler d1 export trackinglink-db --remote --output=backup-YYYYMMDD.sql
--
-- 2. Check for duplicate names within a project. The new unique index will fail
--    to create if this returns any rows — rename the duplicates first:
--      SELECT project_id, name, COUNT(*) FROM QRCodes
--      GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
-- 3. Note that the AccessLogs rebuild DROPS rows whose qr_id no longer exists
--    in QRCodes. Those are logs orphaned by earlier project deletions: the old
--    schema had no foreign key, so deleting a project left its scan history
--    behind with nothing in the UI able to reach it. Count them first if you
--    want to know what you are losing:
--      SELECT COUNT(*) FROM AccessLogs
--      WHERE qr_id NOT IN (SELECT id FROM QRCodes);
--
-- Apply with:
--   wrangler d1 execute trackinglink-db --local  --file=./migrations/0002_qrcode_unique_name_and_access_logs.sql
--   wrangler d1 execute trackinglink-db --remote --file=./migrations/0002_qrcode_unique_name_and_access_logs.sql
-- Then re-run schema.sql.

-- 1. QRCodes: one QR code per named item, instead of one per medium+location.
--    The old constraint made the intended workflow impossible: with location
--    optional, a second poster with a blank location collided with the first.
DROP INDEX IF EXISTS idx_qrcodes_project_medium_location;
CREATE UNIQUE INDEX IF NOT EXISTS idx_qrcodes_project_name ON QRCodes(project_id, name);

-- 2. AccessLogs: rebuild to add the foreign key and is_bot.
--    SQLite cannot ALTER TABLE ... ADD CONSTRAINT, so this is the standard
--    create-copy-drop-rename. Do it while the table is small.
CREATE TABLE AccessLogs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    accessed_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    is_bot INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (qr_id) REFERENCES QRCodes(id) ON DELETE CASCADE
);

-- The WHERE clause is required, not optional: rows referencing a deleted QR
-- code would fail the new foreign key.
INSERT INTO AccessLogs_new (qr_id, project_id, accessed_at, user_agent, ip_address)
SELECT qr_id, project_id, accessed_at, user_agent, ip_address
FROM AccessLogs
WHERE qr_id IN (SELECT id FROM QRCodes);

DROP TABLE AccessLogs;
ALTER TABLE AccessLogs_new RENAME TO AccessLogs;

-- 3. Indexes. The composite index serves the log list and the CSV export
--    (WHERE project_id = ? ORDER BY accessed_at DESC) without a sort step, and
--    its leading column covers what idx_access_logs_project_id used to do —
--    dropping it removes one index write per scan on the hot path.
DROP INDEX IF EXISTS idx_access_logs_project_id;
CREATE INDEX IF NOT EXISTS idx_access_logs_project_accessed_at ON AccessLogs(project_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_qr_id ON AccessLogs(qr_id);
