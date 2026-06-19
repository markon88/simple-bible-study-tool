-- Notes were previously shared globally across all logins. Each user now
-- gets their own notes, word tags, and activity history. Existing data is
-- attributed to the earliest-created account (the original owner), rather
-- than a hardcoded username, since usernames can be changed.

-- word_tags.note_id is a foreign key into notes(id). SQLite won't let you
-- drop a table that's still the target of a live foreign key elsewhere, so
-- both tables are rebuilt together and the OLD word_tags (the referencing
-- side) is dropped before the OLD notes (the referenced side).

CREATE TABLE notes_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, book, chapter, verse)
);

INSERT INTO notes_new (id, user_id, book, chapter, verse, content, created_at, updated_at)
SELECT id, (SELECT id FROM users ORDER BY created_at ASC LIMIT 1), book, chapter, verse, content, created_at, updated_at
FROM notes;

CREATE TABLE word_tags_new (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  word_normalized TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes_new(id)
);

INSERT INTO word_tags_new (id, note_id, user_id, book, chapter, verse, word_normalized, created_at)
SELECT id, note_id, (SELECT id FROM users ORDER BY created_at ASC LIMIT 1), book, chapter, verse, word_normalized, created_at
FROM word_tags;

DROP TABLE word_tags;
DROP TABLE notes;

ALTER TABLE notes_new RENAME TO notes;
ALTER TABLE word_tags_new RENAME TO word_tags;

CREATE INDEX IF NOT EXISTS idx_notes_user_book_chapter ON notes(user_id, book, chapter);
CREATE INDEX IF NOT EXISTS idx_word_tags_user_word ON word_tags(user_id, word_normalized);

ALTER TABLE note_images ADD COLUMN user_id TEXT;

ALTER TABLE activity_log ADD COLUMN user_id TEXT;
UPDATE activity_log SET user_id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_activity_log_user_created ON activity_log(user_id, created_at);
