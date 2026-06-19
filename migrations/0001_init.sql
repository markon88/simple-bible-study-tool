CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(book, chapter, verse)
);

CREATE TABLE IF NOT EXISTS word_tags (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER NOT NULL,
  word_normalized TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS note_images (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  url TEXT NOT NULL,
  caption TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS book_abbreviations (
  id TEXT PRIMARY KEY,
  book TEXT NOT NULL,
  abbrev TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  verse INTEGER,
  action TEXT NOT NULL CHECK(action IN ('view', 'note')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_book_chapter ON notes(book, chapter);
CREATE INDEX IF NOT EXISTS idx_word_tags_word ON word_tags(word_normalized);
CREATE INDEX IF NOT EXISTS idx_word_tags_note_id ON word_tags(note_id);
CREATE INDEX IF NOT EXISTS idx_note_images_note_id ON note_images(note_id);
CREATE INDEX IF NOT EXISTS idx_book_abbreviations_book ON book_abbreviations(book);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);
