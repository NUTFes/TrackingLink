-- TrackingLink schema
--
-- Apply with:
--   wrangler d1 execute trackinglink-db --local  --file=./schema.sql
--   wrangler d1 execute trackinglink-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS Projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    admin_user_id TEXT
);

CREATE TABLE IF NOT EXISTS QRCodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    medium TEXT NOT NULL,
    location TEXT NOT NULL,
    created_at TEXT NOT NULL,
    creator_id TEXT,
    FOREIGN KEY (project_id) REFERENCES Projects(project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS AccessLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    accessed_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_qrcodes_project_id ON QRCodes(project_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_project_id ON AccessLogs(project_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_qr_id ON AccessLogs(qr_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qrcodes_project_medium_location ON QRCodes(project_id, medium, location);

-- Upgrading a database created before the name/medium columns existed?
-- Run migrations/0001_add_qrcode_name_medium.sql once first, then re-run this
-- file (it's safe to re-run any number of times after that).
