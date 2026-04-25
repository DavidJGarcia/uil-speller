// Pure logic for the speller — no DOM, no audio.
// UMD-style: works as a Node CommonJS module (for tests) and as a plain
// <script> tag in the browser (attaches to window.Speller). This lets the
// app open via file:// without a server.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Speller = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const MASTERY_STREAK = 3;

  function normalizeAttempt(attempt) {
    if (attempt == null) return '';
    return String(attempt).trim().replace(/\s+/g, ' ');
  }

  function isCorrect(attempt, entry) {
    const a = normalizeAttempt(attempt);
    if (!a) return false;
    if (entry.caseSensitive) {
      return entry.accepted.includes(a);
    }
    const lower = a.toLowerCase();
    return entry.accepted.some(w => w.toLowerCase() === lower);
  }

  function updateProgress(prev, correct, now) {
    const base = prev || { streak: 0, attempts: 0, wrong: 0, lastSeen: 0 };
    return {
      streak:   correct ? base.streak + 1 : 0,
      attempts: base.attempts + 1,
      wrong:    base.wrong + (correct ? 0 : 1),
      lastSeen: now,
    };
  }

  function isMastered(prog) {
    return !!prog && prog.streak >= MASTERY_STREAK;
  }

  // Today's batch. If `rng` is provided, returns a random sample of `size`
  // unmastered entries (use a seeded rng for daily stability). Without `rng`,
  // returns the first `size` unmastered entries in source order.
  function todaysBatch(entries, progress, size, rng) {
    const unmastered = entries.filter(e => !isMastered(progress[e.n]));
    if (rng) {
      return shuffle(unmastered, rng).slice(0, size);
    }
    return unmastered.slice(0, size);
  }

  function pickNext(entries, progress, sessionWrong, batch, rng) {
    let pool;
    if (batch == null) {
      pool = entries;
    } else {
      const allowed = new Set(batch);
      pool = entries.filter(e => allowed.has(e.n));
    }
    if (pool.length === 0) return null;

    // Priority 1: any unseen pool entry, picked randomly.
    const unseen = pool.filter(e => !progress[e.n]);
    if (unseen.length > 0) {
      return shuffle(unseen, rng)[0].n;
    }

    const poolSet = new Set(pool.map(e => e.n));
    for (const n of sessionWrong) {
      if (poolSet.has(n)) return n;
    }

    const unmastered = pool
      .filter(e => {
        const p = progress[e.n];
        return p && !isMastered(p);
      })
      .sort((a, b) => {
        const la = progress[a.n].lastSeen;
        const lb = progress[b.n].lastSeen;
        if (la !== lb) return la - lb;
        return a.n - b.n;
      });
    if (unmastered.length > 0) return unmastered[0].n;

    const mastered = pool.filter(e => isMastered(progress[e.n]));
    if (mastered.length === 0) return null;
    const idx = Math.floor(rng() * mastered.length);
    return mastered[idx].n;
  }

  function shuffle(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i >= 1; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  // Mulberry32 PRNG seeded from a string. Same seed → same sequence.
  // Use for daily-stable batch composition: pass a date string like "2026-04-24".
  function seededRng(seedStr) {
    let h = 1779033703 ^ String(seedStr).length;
    for (let i = 0; i < String(seedStr).length; i++) {
      h = Math.imul(h ^ String(seedStr).charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    MASTERY_STREAK,
    normalizeAttempt,
    isCorrect,
    updateProgress,
    isMastered,
    todaysBatch,
    pickNext,
    shuffle,
    seededRng,
  };
}));
