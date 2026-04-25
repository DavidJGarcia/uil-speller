# UIL 5th-Grade Speller — Spec

## Goal
A local, kid-friendly web app to practice the official 2025-2026 UIL A+ Spelling
word list for the Grades 5-6 division (the list used for the 2026 competition).

## User
One fifth-grader. Practices daily, ideally on a tablet or the family computer.
A parent launches the app. No accounts, no server.

## Source list
- UIL A+ Spelling Word List 2025-2026, Grades 5-6 section: **800 words**.
- Parsed from the official UIL PDF via `scripts/parse_wordlist.js`.
- Edge cases captured:
  - **Alternate spellings** (accept either): ~15 entries, e.g. `bandanna, bandana`,
    `fulfill, fulfil`, `judgment, judgement`, `carousel, carrousel`, `zombie, zombi`.
  - **Case-sensitive** entries: 7 unique words — `Japanese`, `Kabuki`, `Neptune`,
    `Northerner`, `Uranus`, `Virgo`, plus `unitarian, Unitarian` (both accepted).
  - **Homonym hints** in parens: `boulder (rock)`, `deepwater (adj.)`,
    `do-it-yourself (adj.)`, `leech (worm)`, `yippee (delight)`.
- The contest itself also draws ~20% from outside the list; **out of scope** here.

## Platform & stack
- Single-page app. Vanilla HTML + CSS + vanilla JS. **No build step.**
- Runs by opening `index.html` in a modern browser (desktop or tablet).
- Web Speech API (`speechSynthesis`) for pronunciation.
- `localStorage` for progress.
- No network calls, no external CDNs — fully offline after first load.

## Modes

### 1. Practice (primary)
Closest analog to the contest: hear the word, type it.
- App picks the next word using a simple mastery-weighted queue (see Progress).
- Press a "Hear it" button to play TTS (replays allowed).
- Type the answer, press Enter.
- Above the input, a hint strip shows: homonym clue (`hint: rock`),
  alternate-spelling note (`either spelling is OK`), and proper-noun note
  (`needs a capital letter`) — whichever apply to the current word.
- If an alternate spelling exists, either is accepted.
- Case-sensitive entries require the capital letter.
- On correct: the input is disabled with the attempt visible, a "Correct!"
  banner shows the canonical form and says `Press Enter for the next word`.
  **No auto-advance** — explicit confirm avoids a race where a fast kid's
  next keystrokes land in a disabled field.
- On wrong: show the correct spelling and the hint "Type it again to move on."
  The kid must type the correct spelling (or press Skip) to advance.
- First-time-wrong entries stay in the session queue (FIFO) and come back
  after unseen batch entries are exhausted.

### 2. Flashcards
Browse-and-reveal mode for study, not testing.
- Shows word spelled out with hint/alternates visible.
- "Hear it" button. Prev/Next buttons.
- Useful for first pass through a new batch.

### 3. Test simulator
Mimics the actual competition.
- 80 random words at ~5 words per minute (configurable).
- Auto-plays each word once, then waits ~12 sec for input; then next.
- No feedback until the end — final score + per-word correct/wrong list.
- Tiebreaker round (20 more words) after the main test.

## Daily batches
- Kid or parent picks a batch size (default 20).
- "Today's batch" is a **random sample of N unmastered words**, seeded by the
  local calendar date — so the same batch shows up all day no matter how many
  reloads, but tomorrow brings fresh words from across the alphabet.
- Within practice, Priority 1 in `pickNext` (unseen-in-batch) returns words
  in random order rather than alphabetical, so the kid doesn't keep seeing
  the same word first.
- Practice & Flashcards default to "Today's batch"; user can switch to
  "All 800" anytime.

## Progress tracking
Stored in `localStorage` under `uil-speller:v1`:
- Per-word state: `streak` (consecutive correct), `lastSeen`, `attempts`, `wrong`.
- **Mastered** = streak ≥ 3 correct in Practice mode.
- Pick-next selection (Practice):
  1. Unseen in today's batch (in order).
  2. Words that were wrong in this session.
  3. Words with low streak, oldest `lastSeen` first.
  4. Fall back to random mastered word (refresher).
- A "Reset progress" button in settings, confirmed with a prompt.

## UI
- Big, kid-friendly type. High contrast. Touch-sized buttons.
- Top bar: progress summary (`42 / 800 mastered · today: 12 / 20`).
- Mode switcher (Practice / Flashcards / Test).
- Settings: batch size, TTS voice/rate, reset progress.

## Acceptance criteria
1. App opens by double-clicking `index.html` with no server.
2. All 800 words are loaded and one is playable immediately.
3. Practice correctly accepts alternates and enforces case on case-sensitive words.
4. Homonym hint is shown only when the entry has a parenthetical disambiguator.
5. Wrong answer shows the correct spelling and allows retype.
6. Streak of 3 in Practice marks a word mastered.
7. Mastery persists across reloads.
8. Test simulator advances automatically at the configured pace and produces a score.
9. Reset clears all state.
10. Works in latest Chrome and Edge on Windows.

## Out of scope (v1)
- The ~20% of test words from outside the UIL list.
- Dictionary definitions / example sentences (could be added later via a static JSON).
- Multi-user profiles.
- Sync across devices.
- PWA install / offline service worker (opening the file works without it).

## Key decisions (commit-points)
- **One HTML file, no framework, no build**. Justification: simplest for a
  parent to launch; zero dependencies to rot; works offline.
- **Web Speech API for TTS** rather than bundled audio. Justification: 800 audio
  files would be huge; browser TTS is intelligible enough for English words;
  the human pronouncer at the real meet is also live, not pre-recorded.
- **Mastery = 3-correct-streak**, not SM-2 / spaced repetition. Justification:
  the list is bounded (800) and the competition is in 2026 — simple is fine;
  can be tuned later if it doesn't stick.
- **Batches default to 20** and progress through the list in order.
  Justification: list is alphabetical, but study in order gives a predictable
  pace; parent can change it.
