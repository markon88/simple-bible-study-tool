import { randomUUID } from 'node:crypto';
import { defaultAbbreviations } from './default-abbreviations.mjs';

const lines = [];
const seen = new Set();
for (const [book, abbrevs] of Object.entries(defaultAbbreviations)) {
  for (const a of abbrevs) {
    if (seen.has(a)) throw new Error(`Duplicate abbreviation: ${a} (${book})`);
    seen.add(a);
    lines.push(
      `INSERT INTO book_abbreviations (id, book, abbrev) VALUES ('${randomUUID()}', '${book.replace(/'/g, "''")}', '${a}');`
    );
  }
}

console.log(lines.join('\n'));
