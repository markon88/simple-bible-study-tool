const OT_BOOK_COUNT = 39;

const state = {
  bible: null,
  books: [],
  currentBook: null,
  currentChapter: null,
  split: 50,
  collapsed: null,
};

async function api(path, opts) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) },
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('unauthorized');
  }
  return res;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function loadBible() {
  const res = await fetch('/data/kjv.json');
  state.bible = await res.json();
  state.books = Object.keys(state.bible);
}

// ── Book picker (two-column OT / NT panel) ────────────────────────────────

function populateBookPicker() {
  const ot = state.books.slice(0, OT_BOOK_COUNT);
  const nt = state.books.slice(OT_BOOK_COUNT);
  const renderCol = (books) => books.map((b) =>
    `<button type="button" class="book-option" data-book="${escapeHtml(b)}">${escapeHtml(b)}</button>`
  ).join('');
  document.getElementById('ot-books').innerHTML = renderCol(ot);
  document.getElementById('nt-books').innerHTML = renderCol(nt);

  document.querySelectorAll('.book-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      openChapter(btn.dataset.book, '1');
      document.getElementById('book-picker-panel').hidden = true;
    });
  });
}

function wireBookPicker() {
  const btn = document.getElementById('book-picker-btn');
  const panel = document.getElementById('book-picker-panel');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) panel.hidden = true;
  });
}

function populateChapterSelect(book) {
  const sel = document.getElementById('chapter-select');
  const chapters = Object.keys(state.bible[book]);
  sel.innerHTML = chapters.map((c) => `<option value="${c}">${c}</option>`).join('');
}

function populateVerseSelect(book, chapterKey) {
  const verses = state.bible[book][chapterKey];
  const sel = document.getElementById('verse-select');
  sel.innerHTML = verses.map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
}

// ── Markdown <-> HTML for the notes editor ────────────────────────────────
// Notes are exchanged with the server as plain text: **bold** spans and
// blank-line-separated paragraphs. The editor itself is a contenteditable
// div so bold actually renders as bold (a <textarea> can't do that) — each
// top-level child of the editor is one paragraph (the browser already makes
// every Enter start a new block and every Shift+Enter a soft <br>, which
// maps directly onto that paragraph/line model).

function markdownToHtml(text) {
  if (!text) return '';
  return text.split('\n\n').map((para) => {
    const withBold = escapeHtml(para).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const withBreaks = withBold.split('\n').join('<br>');
    return `<div>${withBreaks || '<br>'}</div>`;
  }).join('');
}

function inlineNodeToMarkdown(node) {
  let result = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName;
      if (tag === 'BR') result += '\n';
      else if (tag === 'B' || tag === 'STRONG') result += `**${inlineNodeToMarkdown(child)}**`;
      else result += inlineNodeToMarkdown(child);
    }
  }
  return result;
}

function htmlToMarkdown(container) {
  const blocks = Array.from(container.childNodes).filter(
    (n) => !(n.nodeType === Node.TEXT_NODE && n.textContent.trim() === '')
  );
  const hasBlockChildren = blocks.some((n) => n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'DIV' || n.tagName === 'P'));
  if (!hasBlockChildren) return inlineNodeToMarkdown(container);
  return blocks.map((n) => inlineNodeToMarkdown(n)).join('\n\n');
}

function placeCursorAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

const saveTimers = {};
function scheduleSave(book, chapterKey, verse, noteEl) {
  const key = `${book}|${chapterKey}|${verse}`;
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => {
    api(`/api/notes?book=${encodeURIComponent(book)}&chapter=${chapterKey}&verse=${verse}`, {
      method: 'PUT',
      body: JSON.stringify({ content: htmlToMarkdown(noteEl) }),
    });
  }, 600);
}

let activeNoteEl = null;
function showBoldButton(noteEl) {
  activeNoteEl = noteEl;
  const btn = document.getElementById('bold-btn');
  const rect = noteEl.getBoundingClientRect();
  btn.style.top = `${rect.top + window.scrollY - 30}px`;
  btn.style.left = `${rect.left + window.scrollX}px`;
  btn.hidden = false;
}

function applyBold() {
  if (!activeNoteEl) return;
  document.execCommand('bold');
  const row = activeNoteEl.closest('.verse-row');
  scheduleSave(row.dataset.book, row.dataset.chapter, row.dataset.verse, activeNoteEl);
}

function handleBoldShortcut(e, noteEl) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    document.execCommand('bold');
    const row = noteEl.closest('.verse-row');
    scheduleSave(row.dataset.book, row.dataset.chapter, row.dataset.verse, noteEl);
  }
}

// ── Double-click a word in the verse text to start a comment on it ───────
// Notes are kept as blank-line-separated paragraphs. A "word paragraph"
// looks like "**word** - comment". When adding a new one, general (non-word)
// paragraphs always stay first, and word paragraphs are kept sorted by
// where that word actually appears in the verse text.

function addWordNote(book, chapterKey, verseNum, verseText, word, clickPos) {
  const row = document.querySelector(`.verse-row[data-book="${book}"][data-chapter="${chapterKey}"][data-verse="${verseNum}"]`);
  const noteEl = row.querySelector('.note-input');
  const existing = htmlToMarkdown(noteEl);
  const rawParagraphs = existing.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  const general = [];
  const wordParas = [];
  for (const p of rawParagraphs) {
    const m = p.match(/^\*\*(.+?)\*\*\s*-/);
    if (m) {
      const idx = verseText.toLowerCase().indexOf(m[1].toLowerCase());
      wordParas.push({ pos: idx === -1 ? Infinity : idx, text: p, isNew: false });
    } else {
      general.push({ text: p, isNew: false });
    }
  }

  const newPara = { pos: clickPos, text: `**${word}** - `, isNew: true };
  wordParas.push(newPara);
  wordParas.sort((a, b) => a.pos - b.pos);

  const combined = [...general, ...wordParas];
  noteEl.innerHTML = markdownToHtml(combined.map((p) => p.text).join('\n\n'));

  const newIndex = combined.findIndex((p) => p.isNew);
  noteEl.focus();
  placeCursorAtEnd(noteEl.children[newIndex] || noteEl);
  scheduleSave(book, chapterKey, verseNum, noteEl);
}

function wordAtClick(bibleCell, verseNum, verseText) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  let word = sel.toString().replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
  if (!word) return null;

  const range = sel.getRangeAt(0);
  const preRange = document.createRange();
  preRange.selectNodeContents(bibleCell);
  preRange.setEnd(range.startContainer, range.startOffset);
  const offsetInCell = preRange.toString().length;
  const prefixLen = String(verseNum).length + 1; // verse-number span text + the space after it
  const clickPos = offsetInCell - prefixLen;
  return { word, clickPos };
}

// Double-clicking a bolded word inside a note jumps straight to word search
// for it — bold is what word search keys on, so this is the fast path back
// to "everywhere else have I commented on this word".
function boldWordAtSelection(container) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const word = sel.toString().replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
  if (!word) return null;

  let node = sel.getRangeAt(0).startContainer;
  while (node && node !== container) {
    if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'STRONG' || node.tagName === 'B')) {
      return word;
    }
    node = node.parentNode;
  }
  return null;
}

function scrollToVerseNum(book, chapterKey, num, highlight = true) {
  const row = document.querySelector(`.verse-row[data-book="${book}"][data-chapter="${chapterKey}"][data-verse="${num}"]`);
  if (row) {
    row.scrollIntoView({ block: 'center' });
    if (highlight) {
      row.classList.add('highlight');
      setTimeout(() => row.classList.remove('highlight'), 1500);
    }
  }
}

// ── Chapter/book sibling lookups ──────────────────────────────────────────

function chapterKeys(book) {
  return Object.keys(state.bible[book]);
}

function siblingChapterKey(book, chapterKey, delta) {
  const keys = chapterKeys(book);
  const idx = keys.indexOf(chapterKey);
  const newIdx = idx + delta;
  return newIdx >= 0 && newIdx < keys.length ? keys[newIdx] : null;
}

function siblingBook(book, delta) {
  const idx = state.books.indexOf(book);
  const newIdx = idx + delta;
  return newIdx >= 0 && newIdx < state.books.length ? state.books[newIdx] : null;
}

// ── Building verse rows and chapter blocks ────────────────────────────────

function buildVerseRow(book, chapterKey, verseNum, text, noteContent) {
  const row = document.createElement('div');
  row.className = 'verse-row';
  row.dataset.book = book;
  row.dataset.chapter = chapterKey;
  row.dataset.verse = String(verseNum);

  const bibleCell = document.createElement('div');
  bibleCell.className = 'bible-cell';
  bibleCell.innerHTML = `<span class="verse-num">${verseNum}</span> ${escapeHtml(text)}`;

  const notesCell = document.createElement('div');
  notesCell.className = 'notes-cell';
  const notesVerseNum = document.createElement('span');
  notesVerseNum.className = 'verse-num';
  notesVerseNum.textContent = String(verseNum);
  const noteEl = document.createElement('div');
  noteEl.className = 'note-input';
  noteEl.contentEditable = 'true';
  noteEl.innerHTML = markdownToHtml(noteContent || '');
  noteEl.addEventListener('input', () => scheduleSave(book, chapterKey, verseNum, noteEl));
  noteEl.addEventListener('focus', () => showBoldButton(noteEl));
  noteEl.addEventListener('keydown', (e) => handleBoldShortcut(e, noteEl));
  noteEl.addEventListener('dblclick', () => {
    const word = boldWordAtSelection(noteEl);
    if (word) openWordSearchWith(word);
  });
  notesCell.appendChild(notesVerseNum);
  notesCell.appendChild(noteEl);

  // Clicking the verse number, or anywhere in the notes column for this
  // verse's row (not just directly on the note text), focuses that note.
  bibleCell.querySelector('.verse-num').addEventListener('click', () => noteEl.focus());
  notesVerseNum.addEventListener('click', () => noteEl.focus());
  notesCell.addEventListener('click', (e) => {
    // Clicking inside the note's own text already focuses it natively —
    // only step in for clicks that land in the empty stretched space
    // around it (e.g. below a short note next to a tall verse).
    if (!noteEl.contains(e.target)) noteEl.focus();
  });

  // Double-clicking a word in the verse text starts a comment on it.
  bibleCell.addEventListener('dblclick', () => {
    const hit = wordAtClick(bibleCell, verseNum, text);
    if (!hit) return;
    addWordNote(book, chapterKey, verseNum, text, hit.word, hit.clickPos);
  });

  row.appendChild(bibleCell);
  row.appendChild(notesCell);
  return row;
}

async function buildChapterBlock(book, chapterKey) {
  const verses = state.bible[book][chapterKey];
  const notesRes = await api(`/api/notes?book=${encodeURIComponent(book)}&chapter=${chapterKey}`);
  const { notes } = await notesRes.json();

  const block = document.createElement('div');
  block.className = 'chapter-block';
  block.dataset.book = book;
  block.dataset.chapter = chapterKey;

  const headerRow = document.createElement('div');
  headerRow.className = 'chapter-header-row';
  const header = document.createElement('div');
  header.className = 'chapter-header';
  header.textContent = `Chapter ${chapterKey}`;
  headerRow.appendChild(header);
  block.appendChild(headerRow);

  verses.forEach((text, idx) => {
    const verseNum = idx + 1;
    block.appendChild(buildVerseRow(book, chapterKey, verseNum, text, notes[verseNum] || ''));
  });

  return block;
}

// ── Continuous scroll across chapters (and book boundaries) ──────────────
// To avoid ever holding an unbounded amount of editable content in the page
// (which would slow down typing/scrolling on a long read), at most
// MAX_LOADED_CHAPTERS chapters are kept in the DOM at once. Scrolling past
// either edge of that window loads the next chapter and quietly drops the
// one furthest from view, compensating scroll position so nothing visually
// jumps.

const MAX_LOADED_CHAPTERS = 3;
let navToken = 0;

function showBookTurnButton(direction) {
  const id = direction === 'next' ? 'next-book-btn' : 'prev-book-btn';
  if (document.getElementById(id)) return; // already showing
  const target = siblingBook(state.currentBook, direction === 'next' ? 1 : -1);

  const btn = document.createElement('button');
  btn.id = id;
  btn.className = 'book-turn-btn';
  if (target) {
    btn.textContent = direction === 'next' ? `Next book: ${target} →` : `← Previous book: ${target}`;
    btn.addEventListener('click', () => {
      if (direction === 'next') {
        openChapter(target, '1', 1, false);
      } else {
        const keys = chapterKeys(target);
        const lastChapter = keys[keys.length - 1];
        openChapter(target, lastChapter, state.bible[target][lastChapter].length, false);
      }
    });
  } else {
    btn.textContent = direction === 'next' ? 'End of the Bible' : 'Beginning of the Bible';
    btn.disabled = true;
  }

  const row = document.createElement('div');
  row.className = 'book-turn-row';
  row.appendChild(btn);

  const list = document.getElementById('verse-list');
  if (direction === 'next') list.appendChild(row);
  else list.insertBefore(row, list.firstChild);
}

async function growBottom() {
  if (state.growingBottom) return;
  state.growingBottom = true;
  const myToken = navToken;
  const last = state.loadedBlocks[state.loadedBlocks.length - 1];
  const nextKey = siblingChapterKey(state.currentBook, last.chapter, 1);
  if (!nextKey) {
    showBookTurnButton('next');
    state.growingBottom = false;
    return;
  }
  const block = await buildChapterBlock(state.currentBook, nextKey);
  if (myToken !== navToken) { state.growingBottom = false; return; }

  document.getElementById('sentinel-bottom').before(block);
  state.loadedBlocks.push({ chapter: nextKey, el: block });
  if (state.loadedBlocks.length > MAX_LOADED_CHAPTERS) {
    const removed = state.loadedBlocks.shift();
    const removedHeight = removed.el.getBoundingClientRect().height;
    removed.el.remove();
    window.scrollBy(0, -removedHeight); // keep visible content from jumping
  }
  state.growingBottom = false;
}

async function growTop() {
  if (state.growingTop) return;
  state.growingTop = true;
  const myToken = navToken;
  const first = state.loadedBlocks[0];
  const prevKey = siblingChapterKey(state.currentBook, first.chapter, -1);
  if (!prevKey) {
    showBookTurnButton('prev');
    state.growingTop = false;
    return;
  }
  const beforeHeight = document.documentElement.scrollHeight;
  const block = await buildChapterBlock(state.currentBook, prevKey);
  if (myToken !== navToken) { state.growingTop = false; return; }

  document.getElementById('sentinel-top').after(block);
  state.loadedBlocks.unshift({ chapter: prevKey, el: block });
  const afterHeight = document.documentElement.scrollHeight;
  window.scrollBy(0, afterHeight - beforeHeight); // keep visible content from jumping
  if (state.loadedBlocks.length > MAX_LOADED_CHAPTERS) {
    state.loadedBlocks.pop().el.remove();
  }
  state.growingTop = false;
}

function setupScrollObserver() {
  if (state.scrollObserver) state.scrollObserver.disconnect();
  state.scrollObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (entry.target.id === 'sentinel-bottom') growBottom();
      if (entry.target.id === 'sentinel-top') growTop();
    }
  }, { rootMargin: '800px 0px 800px 0px' });
  state.scrollObserver.observe(document.getElementById('sentinel-top'));
  state.scrollObserver.observe(document.getElementById('sentinel-bottom'));
}

// Tracks which loaded chapter is actually in view while scrolling, so the
// chapter/verse pickers and "last read" tracking stay in sync without
// re-rendering anything.
let scrollSpyTicking = false;
function onWindowScroll() {
  if (scrollSpyTicking) return;
  scrollSpyTicking = true;
  requestAnimationFrame(() => {
    scrollSpyTicking = false;
    updateActiveChapterFromScroll();
  });
}

function updateActiveChapterFromScroll() {
  const referenceY = 130; // just below the sticky toolbar + column headers
  let active = null;
  for (const { chapter, el } of state.loadedBlocks) {
    const rect = el.getBoundingClientRect();
    if (rect.top <= referenceY && rect.bottom > referenceY) { active = chapter; break; }
  }
  if (!active || active === state.activeViewChapter) return;
  state.activeViewChapter = active;
  document.getElementById('chapter-select').value = active;
  populateVerseSelect(state.currentBook, active);

  clearTimeout(state.viewLogTimer);
  state.viewLogTimer = setTimeout(() => {
    api('/api/activity/view', { method: 'POST', body: JSON.stringify({ book: state.currentBook, chapter: Number(active) }) });
  }, 1000);
}

async function openChapter(book, chapter, scrollToVerse, highlight = true) {
  navToken++;
  state.currentBook = book;
  state.currentChapter = String(chapter);
  state.activeViewChapter = state.currentChapter;

  document.getElementById('book-picker-btn').innerHTML = `${escapeHtml(book)} &#9662;`;
  populateChapterSelect(book);
  document.getElementById('chapter-select').value = state.currentChapter;
  populateVerseSelect(book, state.currentChapter);
  document.getElementById('verse-select').value = String(scrollToVerse || 1);
  document.getElementById('search-results').hidden = true;

  if (state.scrollObserver) state.scrollObserver.disconnect();

  const list = document.getElementById('verse-list');
  list.innerHTML = '';
  const sentinelTop = document.createElement('div');
  sentinelTop.id = 'sentinel-top';
  sentinelTop.className = 'scroll-sentinel';
  const sentinelBottom = document.createElement('div');
  sentinelBottom.id = 'sentinel-bottom';
  sentinelBottom.className = 'scroll-sentinel';
  list.appendChild(sentinelTop);

  const block = await buildChapterBlock(book, state.currentChapter);
  list.appendChild(block);
  list.appendChild(sentinelBottom);
  state.loadedBlocks = [{ chapter: state.currentChapter, el: block }];

  if (scrollToVerse) {
    requestAnimationFrame(() => scrollToVerseNum(book, state.currentChapter, scrollToVerse, highlight));
  } else {
    // The page never auto-resets scroll position on its own (this is a
    // single-page app, not a real navigation) — without this, opening a
    // chapter with no specific verse leaves you wherever you'd scrolled to
    // in whatever was open before, landing partway into the new chapter.
    window.scrollTo(0, 0);
  }

  // Eagerly fill the small fixed window (prev + current + next) so the
  // first scroll in either direction feels instant — this still never
  // exceeds MAX_LOADED_CHAPTERS chapters held in the page at once.
  // Do this BEFORE wiring up the scroll observer: IntersectionObserver
  // fires an initial callback as soon as you call .observe(), which could
  // otherwise race with these eager loads (same growBottom/growTop calls
  // running twice, sometimes resolving after our scroll reset above and
  // silently shifting the page back down).
  await growBottom();
  await growTop();

  setupScrollObserver();

  api('/api/activity/view', { method: 'POST', body: JSON.stringify({ book, chapter: Number(state.currentChapter) }) });
}

function navChapter(delta) {
  const sibling = siblingChapterKey(state.currentBook, state.currentChapter, delta);
  if (sibling) { openChapter(state.currentBook, sibling); return; }
  const targetBook = siblingBook(state.currentBook, delta);
  if (!targetBook) return;
  if (delta > 0) {
    openChapter(targetBook, '1', 1, false);
  } else {
    const keys = chapterKeys(targetBook);
    const lastChapter = keys[keys.length - 1];
    openChapter(targetBook, lastChapter, state.bible[targetBook][lastChapter].length, false);
  }
}

// ── Split / collapse layout ──────────────────────────────────────────────

function applySplit(pct) {
  const container = document.getElementById('reader-split');
  container.style.setProperty('--split', `${pct}%`);
  document.getElementById('divider').style.left = `${pct}%`;
}

function setCollapsed(side, persist) {
  state.collapsed = side;
  const container = document.getElementById('reader-split');
  container.classList.remove('collapse-left', 'collapse-right');
  if (side === 'left') container.classList.add('collapse-left');
  if (side === 'right') container.classList.add('collapse-right');
  document.getElementById('divider').style.display = side ? 'none' : '';
  if (persist) localStorage.setItem('collapsedPanel', side || '');
}

function wireSplitControls() {
  const container = document.getElementById('reader-split');
  const divider = document.getElementById('divider');

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    divider.classList.add('dragging');
    const rect = container.getBoundingClientRect();
    function onMove(ev) {
      let pct = ((ev.clientX - rect.left) / rect.width) * 100;
      pct = Math.min(90, Math.max(10, pct));
      state.split = pct;
      applySplit(pct);
    }
    function onUp() {
      divider.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      localStorage.setItem('splitPosition', String(state.split));
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  document.getElementById('collapse-bible').addEventListener('click', () => {
    setCollapsed(state.collapsed === 'left' ? null : 'left', true);
  });
  document.getElementById('collapse-notes').addEventListener('click', () => {
    setCollapsed(state.collapsed === 'right' ? null : 'right', true);
  });
}

function loadPrefs() {
  const split = parseFloat(localStorage.getItem('splitPosition'));
  state.split = Number.isNaN(split) ? 50 : split;
  const collapsed = localStorage.getItem('collapsedPanel');
  state.collapsed = collapsed || null;
}

// ── Search ──────────────────────────────────────────────────────────────

function renderSearchResults(textMatches, noteMatches) {
  const el = document.getElementById('search-results');
  const section = (title, items) => {
    if (!items.length) return '';
    const rows = items.map((it) => `
      <button class="result-item" data-book="${escapeHtml(it.book)}" data-chapter="${it.chapter}" data-verse="${it.verse}">
        <strong>${escapeHtml(it.book)} ${it.chapter}:${it.verse}</strong>
        <span>${escapeHtml((it.snippet || it.content || '').slice(0, 140))}</span>
      </button>`).join('');
    return `<div class="result-section"><h4>${title}</h4>${rows}</div>`;
  };
  el.innerHTML = section('Bible text', textMatches) + section('Notes', noteMatches);
  if (!textMatches.length && !noteMatches.length) el.innerHTML = '<p class="hint">No matches.</p>';
  el.hidden = false;
  // #search-results sits at a fixed point in the page right after the
  // toolbar — if you're scrolled deep into a long chapter when you search,
  // it would render off-screen above your current view without this.
  // scroll-margin-top accounts for the sticky toolbar overlapping the very
  // top of the viewport, so the panel lands fully visible below it rather
  // than partially hidden underneath it.
  el.style.scrollMarginTop = `${document.getElementById('toolbar').offsetHeight + 8}px`;
  el.scrollIntoView({ block: 'start' });
  el.querySelectorAll('.result-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      openChapter(btn.dataset.book, btn.dataset.chapter, Number(btn.dataset.verse));
    });
  });
}

function searchBibleText(q) {
  const qLower = q.toLowerCase();
  const matches = [];
  for (const book of state.books) {
    for (const [chapter, verses] of Object.entries(state.bible[book])) {
      for (let i = 0; i < verses.length; i++) {
        if (verses[i].toLowerCase().includes(qLower)) {
          matches.push({ book, chapter, verse: i + 1, snippet: verses[i] });
          if (matches.length >= 25) return matches;
        }
      }
    }
  }
  return matches;
}

let mainSearchToken = 0;
async function runMainSearch(q) {
  const resultsEl = document.getElementById('search-results');
  if (!q) { resultsEl.hidden = true; return; }

  const refRes = await api(`/api/reference?q=${encodeURIComponent(q)}`);
  const { reference } = await refRes.json();
  if (reference) {
    await openChapter(reference.book, String(reference.chapter), reference.verse || undefined);
    return;
  }

  const token = ++mainSearchToken;
  const textMatches = searchBibleText(q);
  const notesRes = await api(`/api/notes/search?q=${encodeURIComponent(q)}`);
  const { results: noteMatches } = await notesRes.json();
  if (token !== mainSearchToken) return; // a newer keystroke already started a fresher search
  renderSearchResults(textMatches, noteMatches);
}

function wireSearch() {
  const input = document.getElementById('search-input');
  document.getElementById('search-form').addEventListener('submit', (e) => e.preventDefault());

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runMainSearch(input.value.trim()), 150);
  });
}

let wordSearchToken = 0;
async function runWordSearch(word) {
  const list = document.getElementById('word-search-results');
  if (!word) { list.innerHTML = ''; return; }

  const token = ++wordSearchToken;
  const res = await api(`/api/word-search?word=${encodeURIComponent(word)}`);
  const { results } = await res.json();
  if (token !== wordSearchToken) return; // a newer keystroke already started a fresher search

  if (!results.length) {
    list.innerHTML = '<p class="hint">No matches.</p>';
    return;
  }
  const modal = document.getElementById('word-search-modal');
  list.innerHTML = results.map((r) => `
    <button class="result-item" data-book="${escapeHtml(r.book)}" data-chapter="${r.chapter}" data-verse="${r.verse}">
      <strong>${escapeHtml(r.book)} ${r.chapter}:${r.verse}</strong> <span class="hint">(${escapeHtml(r.word_normalized)})</span>
      <span>${escapeHtml(r.content.slice(0, 140))}</span>
    </button>`).join('');
  list.querySelectorAll('.result-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      openChapter(btn.dataset.book, btn.dataset.chapter, Number(btn.dataset.verse));
      modal.hidden = true;
    });
  });
}

function openWordSearchWith(word) {
  const modal = document.getElementById('word-search-modal');
  const input = document.getElementById('word-search-input');
  modal.hidden = false;
  input.value = word;
  input.focus();
  runWordSearch(word);
}

function wireWordSearch() {
  const modal = document.getElementById('word-search-modal');
  const input = document.getElementById('word-search-input');
  document.getElementById('word-search-btn').addEventListener('click', () => {
    modal.hidden = false;
    input.focus();
  });
  document.getElementById('word-search-close').addEventListener('click', () => { modal.hidden = true; });
  document.getElementById('word-search-form').addEventListener('submit', (e) => e.preventDefault());

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runWordSearch(input.value.trim()), 150);
  });
}

function wireMisc() {
  document.getElementById('chapter-select').addEventListener('change', (e) => openChapter(state.currentBook, e.target.value));
  document.getElementById('verse-select').addEventListener('change', (e) =>
    scrollToVerseNum(state.currentBook, state.activeViewChapter, Number(e.target.value))
  );
  document.getElementById('prev-chapter').addEventListener('click', () => navChapter(-1));
  document.getElementById('next-chapter').addEventListener('click', () => navChapter(1));
  window.addEventListener('scroll', onWindowScroll, { passive: true });
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  const boldBtn = document.getElementById('bold-btn');
  boldBtn.addEventListener('mousedown', (e) => e.preventDefault());
  boldBtn.addEventListener('click', applyBold);
  document.addEventListener('focusout', (e) => {
    if (e.target.classList && e.target.classList.contains('note-input')) {
      setTimeout(() => { if (document.activeElement !== boldBtn) boldBtn.hidden = true; }, 150);
    }
  });
}

function syncToolbarHeight() {
  const height = document.getElementById('toolbar').offsetHeight;
  document.documentElement.style.setProperty('--toolbar-height', `${height}px`);
}

async function init() {
  loadPrefs();
  syncToolbarHeight();
  window.addEventListener('resize', syncToolbarHeight);
  wireSplitControls();
  wireBookPicker();
  wireSearch();
  wireWordSearch();
  wireMisc();
  applySplit(state.split);
  setCollapsed(state.collapsed, false);

  await loadBible();
  populateBookPicker();

  const params = new URLSearchParams(window.location.search);
  if (params.get('book') && params.get('chapter')) {
    await openChapter(params.get('book'), params.get('chapter'), params.get('verse') ? Number(params.get('verse')) : undefined);
    history.replaceState(null, '', '/');
    return;
  }

  const posRes = await api('/api/last-position');
  const { position } = await posRes.json();
  if (position) {
    await openChapter(position.book, position.chapter, position.verse || undefined);
  } else {
    await openChapter(state.books[0], '1');
  }
}

init();
