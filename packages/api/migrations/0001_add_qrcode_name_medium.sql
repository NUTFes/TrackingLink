-- One-time migration for databases created before QRCodes had name/medium
-- columns. Not idempotent — running it twice against the same database will
-- error ("duplicate column name"). A brand-new database doesn't need this at
-- all: schema.sql's CREATE TABLE already includes these columns.
--
-- Before running, make sure no project has more than one QRCodes row sharing
-- the same (now-blank) medium+location — schema.sql's unique index creation
-- will otherwise fail. Give any such duplicates distinct location values
-- first.
--
-- Apply with:
--   wrangler d1 execute trackinglink-db --local  --file=./migrations/0001_add_qrcode_name_medium.sql
--   wrangler d1 execute trackinglink-db --remote --file=./migrations/0001_add_qrcode_name_medium.sql
-- Then re-run schema.sql to create the unique index.

ALTER TABLE QRCodes ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE QRCodes ADD COLUMN medium TEXT NOT NULL DEFAULT '';
