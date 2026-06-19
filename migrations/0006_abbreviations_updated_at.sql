-- Needed for last-write-wins sync between the cloud account and the
-- Electron app's local copy (notes already have this).
ALTER TABLE book_abbreviations ADD COLUMN updated_at TEXT;
UPDATE book_abbreviations SET updated_at = datetime('now') WHERE updated_at IS NULL;
