-- Book abbreviations were previously a single shared list. Each user now
-- gets their own personalizable copy, seeded from the same defaults.
-- Existing entries are attributed to the earliest-created account (the
-- original owner), rather than a hardcoded username, since usernames can
-- be changed.

CREATE TABLE book_abbreviations_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book TEXT NOT NULL,
  abbrev TEXT NOT NULL,
  UNIQUE(user_id, abbrev)
);

-- On a brand-new database (no users yet — e.g. a fresh Electron install
-- before anyone has signed in) there's nothing meaningful to attribute the
-- global seed rows to, so this just leaves the table empty rather than
-- violating the NOT NULL constraint. The first real user gets their own
-- defaults seeded at signup time instead (see handleSignup).
INSERT INTO book_abbreviations_new (id, user_id, book, abbrev)
SELECT id, (SELECT id FROM users ORDER BY created_at ASC LIMIT 1), book, abbrev
FROM book_abbreviations
WHERE (SELECT COUNT(*) FROM users) > 0;

DROP TABLE book_abbreviations;
ALTER TABLE book_abbreviations_new RENAME TO book_abbreviations;

CREATE INDEX IF NOT EXISTS idx_book_abbreviations_user_book ON book_abbreviations(user_id, book);
