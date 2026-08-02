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
    -- Short ASCII keyword baked into this project's QR codes as `&p=<key>`, used
    -- to pick a destination from the FALLBACK_DESTINATIONS var when D1 cannot be
    -- reached. Deliberately not the destination URL itself: a recoverable URL in
    -- the QR costs its own length in payload and grows the symbol from 53x53 to
    -- 69x69 modules, while a keyword costs 4 — and because the parameter only
    -- selects from an operator-configured list, an open redirect is impossible.
    --
    -- Optional; '' means "no keyword". The admin UI then derives one from the
    -- destination host, so no backfill is needed for older projects.
    --
    -- Changing it does not update QR codes that are already printed — those keep
    -- the keyword they were generated with.
    fallback_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    admin_user_id TEXT
);

-- QR code *metadata*. The QR image itself is never stored: the web app renders
-- it client-side on every view (see useQRDataUrl in QRCodesPage.tsx). A row
-- exists because the identifier is baked into the printed URL (`/?id=<...>`), so
-- it has to be stable forever — regenerating it would break already-posted
-- flyers — and because AccessLogs joins on it to attribute scans to a
-- medium/location.
--
-- Two columns can address a row: `id` and `short_code`. New QR codes are printed
-- with the short code; flyers printed before it existed carry the id. The scan
-- endpoint accepts either, and neither is ever reassigned.
CREATE TABLE IF NOT EXISTS QRCodes (
    id TEXT PRIMARY KEY,
    -- What new QR codes put in the printed URL, in place of the 36-character id:
    -- `/?id=q7mfe3x&p=instagram` is 74 characters and encodes as a 49x49 symbol,
    -- against 103 characters and 57x57 for the id. Bigger modules at the same
    -- printed size is the entire benefit. 7 characters from a 32-character
    -- alphabet that omits 0, 1, l and o, so a code survives being read aloud, and
    -- lowercase only because TEXT comparison here is case-sensitive.
    --
    -- Nullable only so migrations/0004 can add it to a populated database without
    -- inventing values in SQL. Every row is expected to carry one — the migration
    -- is paired with scripts/backfill-short-codes.mjs, which fills in the rows
    -- that predate the column. Never overwrite one: it is as printed, and as
    -- permanent, as the id.
    short_code TEXT,
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

-- A short code is what a scan resolves against, so a duplicate would attribute
-- two posters' scans to one row and send some visitors to the wrong project. Also
-- the backstop the create path's collision retry relies on. NULLs count as
-- distinct in a SQLite UNIQUE index, which is what lets migrations/0004 add the
-- column before the backfill populates it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_qrcodes_short_code ON QRCodes(short_code);

-- Serves both the access-log list and the CSV export, which filter by
-- project_id and order by accessed_at DESC — the leading column also covers
-- plain project_id lookups and COUNT(*), so no separate index on project_id is
-- needed (one less index to write on every scan).
CREATE INDEX IF NOT EXISTS idx_access_logs_project_accessed_at ON AccessLogs(project_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_qr_id ON AccessLogs(qr_id);
