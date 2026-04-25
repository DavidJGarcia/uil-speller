// Node test runner for core.js. Run:  node tests/tests.cjs
const {
  normalizeAttempt,
  isCorrect,
  updateProgress,
  isMastered,
  pickNext,
  todaysBatch,
  shuffle,
  seededRng,
  MASTERY_STREAK,
} = require('../core.js');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, err: e });
    console.log(`  FAIL ${name}\n       ${e && e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function eq(a, b, msg) {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || 'eq'}:\n     expected ${B}\n     got      ${A}`);
}

// -------- Fixtures --------
const ENTRY_PLAIN     = { n: 1,   display: 'abdomen',            accepted: ['abdomen'],           hint: null,      caseSensitive: false };
const ENTRY_ALT       = { n: 51,  display: 'bandanna, bandana',  accepted: ['bandanna', 'bandana'], hint: null,    caseSensitive: false };
const ENTRY_HOMONYM   = { n: 80,  display: 'boulder',            accepted: ['boulder'],           hint: 'rock',    caseSensitive: false };
const ENTRY_CASE      = { n: 501, display: 'Neptune',            accepted: ['Neptune'],           hint: null,      caseSensitive: true };
const ENTRY_CASE_ALT  = { n: 748, display: 'unitarian, Unitarian', accepted: ['unitarian', 'Unitarian'], hint: null, caseSensitive: true };
const ENTRY_HYPHEN    = { n: 325, display: 'hijack, high-jack',  accepted: ['hijack', 'high-jack'], hint: null,    caseSensitive: false };
const ENTRY_MULTIWORD = { n: 796, display: 'yard sale',          accepted: ['yard sale'],         hint: null,      caseSensitive: false };
const ENTRY_HINT_HYPH = { n: 171, display: 'do-it-yourself',     accepted: ['do-it-yourself'],    hint: 'adj.',    caseSensitive: false };

// Deterministic RNG: yields values from a queue, throws if empty
function rngOf(...values) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error('rng exhausted');
    return values[i++];
  };
}

// -------- normalizeAttempt --------
test('normalizeAttempt trims whitespace', () => {
  eq(normalizeAttempt('  abdomen  '), 'abdomen');
});
test('normalizeAttempt collapses inner whitespace', () => {
  eq(normalizeAttempt('yard   sale'), 'yard sale');
});
test('normalizeAttempt leaves case untouched', () => {
  eq(normalizeAttempt('Neptune'), 'Neptune');
});
test('normalizeAttempt returns empty for all-whitespace', () => {
  eq(normalizeAttempt('   '), '');
});

// -------- isCorrect --------
test('isCorrect: exact match on plain word', () => {
  assert(isCorrect('abdomen', ENTRY_PLAIN));
});
test('isCorrect: case-insensitive for non-proper nouns', () => {
  assert(isCorrect('ABDOMEN', ENTRY_PLAIN));
  assert(isCorrect('Abdomen', ENTRY_PLAIN));
});
test('isCorrect: wrong spelling is rejected', () => {
  assert(!isCorrect('abdomin', ENTRY_PLAIN));
});
test('isCorrect: either alternate spelling accepted', () => {
  assert(isCorrect('bandanna', ENTRY_ALT));
  assert(isCorrect('bandana', ENTRY_ALT));
});
test('isCorrect: hyphenated alternate accepted', () => {
  assert(isCorrect('hijack', ENTRY_HYPHEN));
  assert(isCorrect('high-jack', ENTRY_HYPHEN));
});
test('isCorrect: case-sensitive entry requires capital', () => {
  assert(isCorrect('Neptune', ENTRY_CASE));
  assert(!isCorrect('neptune', ENTRY_CASE));
  assert(!isCorrect('NEPTUNE', ENTRY_CASE));
});
test('isCorrect: case-sensitive entry with mixed-case alternates accepts both exactly', () => {
  assert(isCorrect('unitarian', ENTRY_CASE_ALT));
  assert(isCorrect('Unitarian', ENTRY_CASE_ALT));
  assert(!isCorrect('UNITARIAN', ENTRY_CASE_ALT));
});
test('isCorrect: trims whitespace before comparing', () => {
  assert(isCorrect('  abdomen  ', ENTRY_PLAIN));
});
test('isCorrect: empty attempt is not correct', () => {
  assert(!isCorrect('', ENTRY_PLAIN));
  assert(!isCorrect('   ', ENTRY_PLAIN));
});
test('isCorrect: multi-word entry accepted with normal whitespace', () => {
  assert(isCorrect('yard sale', ENTRY_MULTIWORD));
  assert(isCorrect('  yard   sale  ', ENTRY_MULTIWORD));
  assert(isCorrect('Yard Sale', ENTRY_MULTIWORD));
});
test('isCorrect: hyphen + hint entry still matches by letters', () => {
  assert(isCorrect('do-it-yourself', ENTRY_HINT_HYPH));
  assert(!isCorrect('do it yourself', ENTRY_HINT_HYPH));
});

// -------- updateProgress / isMastered --------
test('updateProgress: first-ever correct increments streak to 1', () => {
  const p = updateProgress(undefined, true, 1000);
  eq(p.streak, 1);
  eq(p.attempts, 1);
  eq(p.wrong, 0);
  eq(p.lastSeen, 1000);
});
test('updateProgress: first-ever wrong resets streak and counts wrong', () => {
  const p = updateProgress(undefined, false, 2000);
  eq(p.streak, 0);
  eq(p.attempts, 1);
  eq(p.wrong, 1);
  eq(p.lastSeen, 2000);
});
test('updateProgress: streak accumulates across correct answers', () => {
  let p;
  p = updateProgress(p,     true, 100);
  p = updateProgress(p,     true, 200);
  p = updateProgress(p,     true, 300);
  eq(p.streak, 3);
  eq(p.attempts, 3);
});
test('updateProgress: wrong answer resets streak to 0 but keeps attempts', () => {
  let p = { streak: 2, attempts: 2, wrong: 0, lastSeen: 0 };
  p = updateProgress(p, false, 500);
  eq(p.streak, 0);
  eq(p.attempts, 3);
  eq(p.wrong, 1);
});
test('updateProgress: correct answer past mastery continues to increase streak', () => {
  let p = { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 0 };
  p = updateProgress(p, true, 600);
  eq(p.streak, MASTERY_STREAK + 1);
  eq(p.attempts, 4);
  assert(isMastered(p));
});
test('isMastered: true when streak meets threshold', () => {
  assert(isMastered({ streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 0 }));
  assert(isMastered({ streak: MASTERY_STREAK + 1, attempts: 5, wrong: 0, lastSeen: 0 }));
});
test('isMastered: false when streak below threshold', () => {
  assert(!isMastered({ streak: MASTERY_STREAK - 1, attempts: 2, wrong: 0, lastSeen: 0 }));
  assert(!isMastered(undefined));
});

// -------- todaysBatch --------
test("todaysBatch: first N unmastered in source order", () => {
  const entries = [
    { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 },
  ];
  const prog = {
    1: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 0 },
    3: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 0 },
  };
  eq(todaysBatch(entries, prog, 3).map(e => e.n), [2, 4, 5]);
});
test("todaysBatch: size larger than unmastered count returns what's available", () => {
  const entries = [{ n: 1 }, { n: 2 }];
  const prog = { 1: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 0 } };
  eq(todaysBatch(entries, prog, 10).map(e => e.n), [2]);
});
test("todaysBatch: all mastered returns empty array", () => {
  const entries = [{ n: 1 }, { n: 2 }];
  const prog = {
    1: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 0 },
    2: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 0 },
  };
  eq(todaysBatch(entries, prog, 5), []);
});
test("todaysBatch: with rng, returns a random sample of unmastered", () => {
  const entries = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }];
  const got = todaysBatch(entries, {}, 3, rngOf(0.1, 0.4, 0.7, 0.2));
  eq(got.length, 3);
  // Output must be a subset of input
  for (const e of got) assert(entries.some(x => x.n === e.n));
});
test("todaysBatch: same seed → same batch (daily stability)", () => {
  const entries = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }];
  const a = todaysBatch(entries, {}, 3, seededRng('2026-04-24'));
  const b = todaysBatch(entries, {}, 3, seededRng('2026-04-24'));
  eq(a.map(e => e.n), b.map(e => e.n));
});
test("todaysBatch: different seed → different batch (most days)", () => {
  const entries = Array.from({ length: 100 }, (_, i) => ({ n: i + 1 }));
  const a = todaysBatch(entries, {}, 5, seededRng('2026-04-24'));
  const b = todaysBatch(entries, {}, 5, seededRng('2026-04-25'));
  // Cosmically possible they're identical, but with 100C5 ≈ 75M combinations the odds are nil.
  assert(JSON.stringify(a.map(e => e.n)) !== JSON.stringify(b.map(e => e.n)));
});

// -------- seededRng --------
test('seededRng: same seed produces same sequence', () => {
  const r1 = seededRng('hello');
  const r2 = seededRng('hello');
  for (let i = 0; i < 10; i++) eq(r1(), r2());
});
test('seededRng: different seeds diverge', () => {
  const r1 = seededRng('hello');
  const r2 = seededRng('world');
  let same = 0;
  for (let i = 0; i < 5; i++) if (r1() === r2()) same++;
  assert(same < 5, 'two different seeds should not produce identical sequences');
});
test('seededRng: outputs are in [0, 1)', () => {
  const r = seededRng('seed');
  for (let i = 0; i < 100; i++) {
    const v = r();
    assert(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

// -------- pickNext --------
test('pickNext: an unseen pool entry comes first (random among unseen)', () => {
  const entries = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const prog = {};
  // 3 unseen → 2 rng calls in shuffle. Result must be one of {1,2,3}.
  const got = pickNext(entries, prog, [], [1, 2, 3], rngOf(0.5, 0.5));
  assert([1, 2, 3].includes(got), `got ${got}, expected one of 1,2,3`);
});
test('pickNext: random unseen pick changes with the rng', () => {
  const entries = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const prog = {};
  const a = pickNext(entries, prog, [], [1, 2, 3], rngOf(0,    0));
  const b = pickNext(entries, prog, [], [1, 2, 3], rngOf(0.99, 0.99));
  // With opposite rng extremes Fisher-Yates produces different head elements.
  assert(a !== b, `expected different picks; both were ${a}`);
});
test('pickNext: within pool, unseen comes before wrong-this-session', () => {
  const entries = [{ n: 1 }, { n: 2 }];
  const prog = { 1: { streak: 0, attempts: 1, wrong: 1, lastSeen: 100 } };
  // Only #2 is unseen; shuffle of 1-element consumes 0 rng values.
  const got = pickNext(entries, prog, [1], [1, 2], rngOf());
  eq(got, 2);
});
test('pickNext: session-wrong is FIFO (oldest first)', () => {
  const entries = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const prog = {
    1: { streak: 0, attempts: 1, wrong: 1, lastSeen: 100 },
    2: { streak: 0, attempts: 1, wrong: 1, lastSeen: 200 },
    3: { streak: 0, attempts: 1, wrong: 1, lastSeen: 150 },
  };
  // 3 was added first, then 1, then 2 — FIFO order: 3, 1, 2
  const got = pickNext(entries, prog, [3, 1, 2], [1, 2, 3], rngOf());
  eq(got, 3);
});
test('pickNext: session-wrong beats low-streak even with empty batch', () => {
  const entries = [{ n: 1 }, { n: 2 }];
  const prog = {
    1: { streak: 1, attempts: 1, wrong: 0, lastSeen: 100 },
    2: { streak: 0, attempts: 1, wrong: 1, lastSeen: 50 },
  };
  // Pool is null (all entries). 2 is session-wrong; 1 is just low-streak.
  const got = pickNext(entries, prog, [2], null, rngOf());
  eq(got, 2);
});
test('pickNext: low-streak oldest-lastSeen first', () => {
  const entries = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const prog = {
    1: { streak: 1, attempts: 1, wrong: 0, lastSeen: 500 },
    2: { streak: 1, attempts: 1, wrong: 0, lastSeen: 100 },
    3: { streak: 1, attempts: 1, wrong: 0, lastSeen: 300 },
  };
  const got = pickNext(entries, prog, [], null, rngOf());
  eq(got, 2);
});
test('pickNext: low-streak tie on lastSeen broken by lower n', () => {
  const entries = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const prog = {
    1: { streak: 1, attempts: 1, wrong: 0, lastSeen: 100 },
    2: { streak: 1, attempts: 1, wrong: 0, lastSeen: 100 },
    3: { streak: 1, attempts: 1, wrong: 0, lastSeen: 100 },
  };
  const got = pickNext(entries, prog, [], null, rngOf());
  eq(got, 1);
});
test('pickNext: falls back to random mastered when nothing else is available', () => {
  const entries = [{ n: 1 }, { n: 2 }];
  const prog = {
    1: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 10 },
    2: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 20 },
  };
  // rng returns 0.7 -> floor(0.7 * 2) = index 1 -> entry.n = 2
  const got = pickNext(entries, prog, [], null, rngOf(0.7));
  eq(got, 2);
});
test('pickNext: batch restricts pool — entries outside batch are never returned', () => {
  const entries = [{ n: 1 }, { n: 2 }, { n: 3 }];
  const prog = {};
  // Only #2 is eligible, even though #1 and #3 are unseen.
  const got = pickNext(entries, prog, [], [2], rngOf());
  eq(got, 2);
});
test('pickNext: determinism — same inputs produce same output', () => {
  const entries = [{ n: 1 }, { n: 2 }];
  const prog = {
    1: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 10 },
    2: { streak: MASTERY_STREAK, attempts: 3, wrong: 0, lastSeen: 20 },
  };
  const a = pickNext(entries, prog, [], null, rngOf(0.3));
  const b = pickNext(entries, prog, [], null, rngOf(0.3));
  eq(a, b);
});
test('pickNext: empty pool returns null', () => {
  eq(pickNext([], {}, [], [], rngOf()), null);
});
test('pickNext: empty entries returns null', () => {
  eq(pickNext([], {}, [], null, rngOf()), null);
});

// -------- shuffle --------
test('shuffle: explicit permutation for a known rng sequence', () => {
  // Fisher-Yates descending i = n-1..1, j = floor(rng() * (i+1)); swap arr[i], arr[j].
  // arr = [1,2,3,4,5], n=5
  //   i=4, rng=0.1 -> j=floor(0.5)=0; swap a[4],a[0] -> [5,2,3,4,1]
  //   i=3, rng=0.1 -> j=floor(0.4)=0; swap a[3],a[0] -> [4,2,3,5,1]
  //   i=2, rng=0.1 -> j=floor(0.3)=0; swap a[2],a[0] -> [3,2,4,5,1]
  //   i=1, rng=0.1 -> j=floor(0.2)=0; swap a[1],a[0] -> [2,3,4,5,1]
  const got = shuffle([1, 2, 3, 4, 5], rngOf(0.1, 0.1, 0.1, 0.1));
  eq(got, [2, 3, 4, 5, 1]);
});
test('shuffle: different rng produces different permutation', () => {
  const a = shuffle([1, 2, 3, 4, 5], rngOf(0.1, 0.1, 0.1, 0.1));
  const b = shuffle([1, 2, 3, 4, 5], rngOf(0.9, 0.9, 0.9, 0.9));
  assert(JSON.stringify(a) !== JSON.stringify(b), 'shuffle must react to rng');
});
test('shuffle: preserves all elements (multiset)', () => {
  const got = shuffle([1, 2, 3, 4, 5], rngOf(0.9, 0.2, 0.5, 0.5));
  eq(got.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});
test('shuffle: does not mutate input array', () => {
  const arr = [1, 2, 3];
  const before = JSON.stringify(arr);
  shuffle(arr, rngOf(0.5, 0.5));
  eq(JSON.stringify(arr), before);
});
test('shuffle: single-element and empty arrays', () => {
  eq(shuffle([], rngOf()), []);
  eq(shuffle([42], rngOf()), [42]);
});

// -------- Summary --------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
