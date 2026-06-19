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

INSERT INTO book_abbreviations_new (id, user_id, book, abbrev)
SELECT id, (SELECT id FROM users ORDER BY created_at ASC LIMIT 1), book, abbrev
FROM book_abbreviations;

DROP TABLE book_abbreviations;
ALTER TABLE book_abbreviations_new RENAME TO book_abbreviations;

CREATE INDEX IF NOT EXISTS idx_book_abbreviations_user_book ON book_abbreviations(user_id, book);
