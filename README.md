# UIL 5th-Grade Speller — 2026

A browser app for practicing the official **UIL A+ Spelling Word List 2025-2026**,
Grades 5-6 division (the list that will be used at the 2026 competition).
Built for a single fifth-grader; no accounts, no server, no cloud.

## Running it

Two ways.

### Easiest: open the file

Double-click `index.html`. The app is self-contained — HTML, CSS, JS, and the
800-word list all sit in this folder, and it uses plain `<script>` tags so
nothing is blocked by the file:// sandbox.

Works in recent Chrome, Edge, and Firefox.

### Over a local server (if you prefer)

```
node scripts/serve.js
```

Then open http://127.0.0.1:5173/. Useful if your browser is stricter about
file:// audio or if you want to run it on an iPad on the same wifi.

## Modes

- **Practice** — hear the word, type it. This is the main mode.
- **Flashcards** — browse the list at your own pace, see hints.
- **Test simulator** — 80 random words at 5 words per minute, like the real contest.

## Settings

- **Today's batch size** — how many unmastered words Practice draws from at a time (default 20).
- **Speaking rate** — adjust the voice speed if it's too fast or too slow.
- **Voice** — pick any English voice your OS provides.
- **Use full 800-word pool** — skip batches and draw from everything.
- **Reset all progress** — wipes mastery, streaks, and attempt counts.

Progress lives in the browser's `localStorage`. Different browsers / incognito
windows have separate progress.

## Mastery

A word counts as **mastered** once the kid spells it right three times in a
row in Practice mode. Mastered words stop appearing in new batches but can
still show up as refresher picks.

## Data

The word list is parsed directly from the official UIL PDF. The data shape is:

```json
{ "n": 51, "display": "bandanna, bandana", "accepted": ["bandanna", "bandana"], "hint": null, "caseSensitive": false }
```

- **800 entries** for grades 5-6.
- **~15 entries with alternate spellings** — either is accepted
  (`bandanna, bandana`; `judgment, judgement`; `fulfill, fulfil`; …).
- **7 case-sensitive proper nouns** (`Neptune`, `Virgo`, `Kabuki`,
  `Japanese`, `Northerner`, `Uranus`, and `unitarian/Unitarian` where both
  forms are OK).
- **5 entries with homonym/POS hints** (`boulder (rock)`, `leech (worm)`,
  `yippee (delight)`, `deepwater (adj.)`, `do-it-yourself (adj.)`).

To regenerate from a new PDF:

```
pdftotext -layout /path/to/A+Spelling_2025_26.pdf /tmp/aplusspelling.txt
# isolate the grades 5-6 section, save as /tmp/grade56.txt, then:
node scripts/parse_wordlist.js
```

The parser writes both `words.json` (data of record) and `words.js`
(script-tag-friendly wrapper loaded by the app).

## Tests

```
node tests/tests.cjs
```

Pure-logic unit tests — 41 of them — for answer checking, progress
transitions, the pickNext priority order, shuffling, and edge cases around
alternates / case-sensitivity / multi-word entries / mastery boundaries.

## What's out of scope (v1)

- The ~20% of test words that come from outside the UIL list at the real contest.
- Definitions or example sentences.
- Multi-kid profiles.
- Cross-device sync.

## Source

- UIL A+ Spelling page: https://www.uiltexas.org/aplus/events/aplus-spelling
- The 2025-2026 PDF this list was extracted from:
  https://www.uiltexas.org/files/academics/aplus/A+Spelling_2025_26.pdf
