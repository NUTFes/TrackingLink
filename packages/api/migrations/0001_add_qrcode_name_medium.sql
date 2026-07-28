-- One-time migration for databases created before QRCodes had name/medium
-- columns. Not idempotent — running it twice against the same database will
-- error ("duplicate column name"). A brand-new database doesn't need this at
-- all: schema.sql's CREATE TABLE already includes these columns.
--
-- The columns are added blank. QRCodes is unique on (project_id, name) as of
-- migration 0002, so before creating that index you have to give the blank
-- names distinct values — run 0002 next and follow its instructions.
--
-- Apply with:
--   wrangler d1 execute trackinglink-db --local  --file=./migrations/0001_add_qrcode_name_medium.sql
--   wrangler d1 execute trackinglink-db --remote --file=./migrations/0001_add_qrcode_name_medium.sql
-- Then run 0002, then re-run schema.sql.

ALTER TABLE QRCodes ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE QRCodes ADD COLUMN medium TEXT NOT NULL DEFAULT '';
