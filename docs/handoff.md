# Handoff — UIL 5th-Grade Speller (2026)

## Status
**Shipped-ready, local-only.** App is functional end-to-end. All 41 unit tests
pass; browser smoke tests cover Practice (correct / wrong / retype / skip),
Flashcards (navigation, hints), and Test simulator (start, quit, scoring,
results). The fresh-context review's blocker-grade issues were all fixed.

## Project
`uil-speller/` next to the other "local-only code" projects.

```
uil-speller/
├── index.html          # one-file entry — double-click to run
├── app.js              # UI glue (modes, TTS, persistence)
├── core.js             # pure logic (UMD — tests + browser share it)
├── style.css
├── words.js            # auto-generated browser wrapper around the list
├── words.json          # data of record
├── README.md           # "how to run" for a future reader
├── docs/
│   ├── spec.md
│   └── handoff.md      # this file
├── scripts/
│   ├── parse_wordlist.js   # PDF-text → words.json + words.js
│   └── serve.js            # tiny static server for preview / tablets
└── tests/
    └── tests.cjs           # 41 unit tests — node tests/tests.cjs
```

## Spec link
[docs/spec.md](spec.md). All decisions below are reflected in the spec.

## Decision log (autonomous)
1. **Source = the 2025-2026 UIL PDF** (that's the list used at the 2026
   contest). Parsed locally; no vendored lists to go stale.
2. **Single HTML file + plain scripts**, no framework, no build step.
   Justification: parent-friendly (just open the file) and zero-dependency.
3. **UMD for `core.js`** so the same file powers Node tests and the browser.
   Picked this over ES modules because ES modules are blocked on `file://`
   in Chrome by default.
4. **Web Speech API for pronunciation**. 800 bundled audio files would be
   unwieldy; the real contest pronouncer is a live human anyway, so a
   slightly robotic voice is closer to "train for conditions you can't
   perfectly control" than a recording would be.
5. **Mastery = 3 correct in a row**. Not SM-2 / spaced repetition. The list
   is bounded; simple rule; tunable if it doesn't stick.
6. **No auto-advance after correct** — this was a mid-build reversal. The
   first cut auto-advanced 1.2s after a correct answer. Fresh-context review
   caught a real race: a fast kid typing the next answer during that window
   would split keystrokes between the disabled old input and the new one.
   Now: correct → feedback stays up, Enter advances. Explicit and race-free.
7. **Retype required on wrong**. When the kid gets one wrong, they must
   type the correct spelling (or press Skip) to advance. Educational intent,
   not just UX polish.
8. **Session-wrong tracked as FIFO array**, not Set. Set can't express
   insertion order portably; picking the next session-wrong word reliably
   needed an ordered structure.
9. **`batch` restricts the pool for `pickNext`**, not just priority-1.
   Simpler mental model: if a word isn't in today's batch, Practice won't
   show it. The "full pool" setting flips this off.
10. **Deep-merge settings on load** so future settings keys don't silently
    go missing for users with older localStorage state.

## Test results
- Unit tests: **41 / 41 passing**. Covers answer checking (alternates, case,
  whitespace, hyphens, multi-word); progress transitions and the mastery
  boundary; `todaysBatch` and the four-level `pickNext` priority including
  empty-batch and determinism cases; `shuffle` with explicit-permutation
  assertions and an "it must react to rng" guard.
- Browser smoke: Practice happy path, wrong + retype, alternates
  (`bandanna, bandana`), case-sensitive (`Neptune` — lowercase rejected),
  homonym hint (`boulder` → "hint: rock"), test simulator start + scoring +
  quit, deep-merge persistence across a simulated v0 → v1 settings shape.

## Demo artifacts
- Initial screen: Practice mode with "Hear the word" button, input, Check/Skip.
- HUD: "0 / 800 mastered · today: 20 to go".
- Alternate-word hint strip: "either spelling is OK".
- Case-sensitive hint strip: "needs a capital letter".
- Homonym hint strip: "hint: rock".
- Test results screen with per-word ✓/✗ list.

(All verified via `preview_eval` DOM assertions in the preview panel —
see the browser smoke log above.)

## Needs attention
- **TTS quality varies by OS / browser.** English voices are usually
  good, but words like `Kabuki` or `phantasy` may be mispronounced. For
  the real contest the pronouncer might be clearer; consider auditioning a
  few voices in Settings before the first real practice session.
- **The contest uses ~20% of words from outside the UIL list.** The app
  intentionally doesn't cover those — they're unpredictable, and the
  deterministic 80% is the highest-leverage thing to drill. If the kid
  nails the 800, we can add a "words of common usage" mini-list later.

## Open questions (for the parent)
1. Do you want a **printable word list** (pdf, grouped by first letter)?
   Easy to add from `words.json`.
2. Should **Test-mode results feed back into progress**? Currently they
   don't — the simulator is pure assessment. Plausible case either way.
3. Any interest in **day-by-day tracking** (streak days) or is
   "mastered / not" granular enough?

## Capability gaps
- **No PDF text extractor available at the system level** (pdftoppm missing
  in the Read tool's Python path, Python itself not installed). Worked
  around by using `pdftotext` (mingw version in Git Bash) + Node for the
  structured parser. Impact: the one-shot data pipeline is Windows-specific
  because of hardcoded absolute paths in `scripts/parse_wordlist.js`. If
  you want to re-run it on a Mac or Linux box, update the paths to use
  relative ones — a 2-minute change.
- **Can't hear TTS output from the preview panel**, so smoke tests
  confirmed `speechSynthesis.speak` was invoked but couldn't audit
  pronunciation quality. Parent should do one round of Practice with
  headphones to verify the chosen voice sounds right.

## What would be next
- **Printable list** (5 minutes with a dom-to-print CSS stylesheet).
- **Study reminders** via a local notification or calendar export.
- **"Near-miss" tolerant matching** for fat-finger typos — tempting but
  risky pedagogically (spelling contests are exact).
- **Visual word-of-the-day** on the setup screen.
