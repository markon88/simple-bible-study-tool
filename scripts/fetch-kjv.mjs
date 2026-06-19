// One-time fetch of public-domain KJV text into public/data/kjv.json.
// Source: https://github.com/aruljohn/Bible-kjv (KJV is public domain; this repo
// just packages it as per-book JSON files).
import { writeFile } from 'node:fs/promises';

const books = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

const fileName = (book) => book.replace(/\s+/g, '');

const result = {};
for (const book of books) {
  const url = `https://raw.githubusercontent.com/aruljohn/Bible-kjv/master/${fileName(book)}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${book}: ${res.status}`);
  const data = await res.json();
  const chapters = {};
  for (const ch of data.chapters) {
    chapters[ch.chapter] = ch.verses.map((v) => v.text);
  }
  result[book] = chapters;
  console.error(`Fetched ${book} (${data.chapters.length} chapters)`);
}

await writeFile(new URL('../public/data/kjv.json', import.meta.url), JSON.stringify(result));
console.error('Wrote public/data/kjv.json');
