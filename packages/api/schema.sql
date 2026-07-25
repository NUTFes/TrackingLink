-- TrackingLink schema — source of truth. Safe to re-run any number of times.
--
-- Apply with:
--   wrangler d1 execute trackinglink-db --local  --file=./schema.sql
--   wrangler d1 execute trackinglink-db --remote --file=./schema.sql
--
-- Upgrading a database created before a schema change? Run the matching file in
-- migrations/ once first (in numeric order), then re-run this file.

CREATE TABLE IF NOT EXISTS Projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    admin_user_id TEXT
);

-- QR code *metadata*. The QR image itself is never stored: the web app renders
-- it client-side on every view (see useQRDataUrl in QRCodesPage.tsx). A row
-- exists because the id is baked into the printed URL (`/?id=<id>`), so it has
-- to be stable forever — regenerating it would break already-posted flyers —
-- and because AccessLogs joins on it to attribute scans to a medium/location.
CREATE TABLE IF NOT EXISTS QRCodes (
    id TEXT PRIMARY KEY,
    -- What the QR code is printed on, e.g. "造形大ポスター". Unique per project:
    -- one QR code per physical item.
    name TEXT NOT NULL,
    project_id TEXT NOT NULL,
    -- Source channel/type, e.g. "ポスター", "チラシ", "Instagram".
    medium TEXT NOT NULL,
    -- Where the item is posted/handed out. Optional — staff record it only when
    -- it is useful. Stored as '' rather than NULL when unset, so that reads,
    -- CSV export and the unique index all see a single representation.
    location TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    creator_id TEXT
);

CREATE TABLE IF NOT EXISTS AccessLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    accessed_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    -- 1 when the request came from a link-preview crawler rather than a person.
    -- Bot hits are recorded and flagged rather than dropped, so the classifier
    -- can be refined later and historical counts recomputed.
    is_bot INTEGER NOT NULL DEFAULT 0,
    -- Deleting a QR code (or a project, which cascades to its QR codes) takes
    -- its scan history with it. Without this, deletes left unreachable rows
    -- behind.
    FOREIGN KEY (qr_id) REFERENCES QRCodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qrcodes_project_id ON QRCodes(project_id);

-- One QR code per named item within a project. Guards against issuing a second
-- QR code for a poster that already has one, and keeps the download filename
-- (built from the name) unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_qrcodes_project_name ON QRCodes(project_id, name);

-- Serves both the access-log list and the CSV export, which filter by
-- project_id and order by accessed_at DESC — the leading column also covers
-- plain project_id lookups and COUNT(*), so no separate index on project_id is
-- needed (one less index to write on every scan).
CREATE INDEX IF NOT EXISTS idx_access_logs_project_accessed_at ON AccessLogs(project_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_qr_id ON AccessLogs(qr_id);
