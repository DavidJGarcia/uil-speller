// UI glue for the speller. Assumes window.WORDS, window.Speller are loaded.
(function () {
  'use strict';

  const S = window.Speller;
  const WORDS = window.WORDS;
  if (!S || !Array.isArray(WORDS) || WORDS.length === 0) {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:sans-serif">Failed to load word list or core script. ' +
      'Make sure <code>words.js</code> and <code>core.js</code> are next to <code>index.html</code>.</p>';
    return;
  }
  const BY_N = new Map(WORDS.map(w => [w.n, w]));

  // -------- Persistence --------
  const STORAGE_KEY = 'uil-speller:v1';

  function loadState() {
    const d = defaultState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return d;
      const parsed = JSON.parse(raw);
      // Deep-merge settings so that newer default keys survive load of older state.
      return {
        progress: (parsed && typeof parsed.progress === 'object' && parsed.progress) ? parsed.progress : {},
        settings: Object.assign({}, d.settings, parsed && parsed.settings || {}),
      };
    } catch (e) {
      console.warn('Load failed, resetting', e);
      return d;
    }
  }

  function defaultState() {
    return {
      progress: {},         // n -> { streak, attempts, wrong, lastSeen }
      settings: {
        batchSize: 20,
        ttsRate: 0.9,
        voiceURI: null,     // stored voice URI
        useFullPool: false, // if true, Practice draws from all 800
        flashRange: { enabled: false, from: 1,  to: 30  },
        testRange:  { enabled: false, from: 1,  to: 80  },
      },
    };
  }

  // Clamp a range to the valid 1..800 window and ensure from <= to.
  function normRange(r) {
    const from = Math.max(1, Math.min(800, parseInt(r.from, 10) || 1));
    const to   = Math.max(1, Math.min(800, parseInt(r.to,   10) || 1));
    return { enabled: !!r.enabled, from: Math.min(from, to), to: Math.max(from, to) };
  }

  function entriesInRange(r) {
    const n = normRange(r);
    return WORDS.filter(w => w.n >= n.from && w.n <= n.to);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Save failed', e);
    }
  }

  const state = loadState();

  // -------- TTS --------
  const tts = {
    voices: [],
    chosen: null,

    refresh() {
      this.voices = window.speechSynthesis.getVoices() || [];
      // Prefer an English voice matching the stored URI, else any en-*, else first.
      const uri = state.settings.voiceURI;
      this.chosen =
        (uri && this.voices.find(v => v.voiceURI === uri)) ||
        this.voices.find(v => /^en(-|_|$)/i.test(v.lang)) ||
        this.voices[0] ||
        null;
      this.populateSelect();
    },

    populateSelect() {
      const sel = document.getElementById('tts-voice');
      if (!sel) return;
      sel.innerHTML = '';
      for (const v of this.voices) {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})`;
        if (this.chosen && v.voiceURI === this.chosen.voiceURI) opt.selected = true;
        sel.appendChild(opt);
      }
    },

    speak(text) {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.chosen) u.voice = this.chosen;
      u.rate = state.settings.ttsRate;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
    },
  };

  // -------- Definition lookup --------
  // Uses the Free Dictionary API (dictionaryapi.dev). Each word fetches once,
  // then is cached in localStorage forever. Failures degrade gracefully.
  const DEFS_KEY = 'uil-speller:defs:v1';

  const defs = {
    cache: null,

    loadCache() {
      if (this.cache) return this.cache;
      try {
        this.cache = JSON.parse(localStorage.getItem(DEFS_KEY) || '{}') || {};
      } catch {
        this.cache = {};
      }
      return this.cache;
    },

    saveCache() {
      try { localStorage.setItem(DEFS_KEY, JSON.stringify(this.cache || {})); } catch {}
    },

    // Returns one of:
    //   { def, pos, example }   — found
    //   { notFound: true }      — API said 404
    //   { error: '...' }        — network / parse error (not cached)
    async lookup(word) {
      this.loadCache();
      const key = word.toLowerCase();
      if (this.cache[key]) return this.cache[key];

      const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word);
      try {
        const res = await fetch(url);
        if (res.status === 404) {
          const miss = { notFound: true };
          this.cache[key] = miss;
          this.saveCache();
          return miss;
        }
        if (!res.ok) return { error: 'lookup failed (' + res.status + ')' };
        const data = await res.json();
        const entry = Array.isArray(data) ? data[0] : null;
        if (!entry || !entry.meanings || !entry.meanings.length) {
          const miss = { notFound: true };
          this.cache[key] = miss;
          this.saveCache();
          return miss;
        }
        // Take the top 2 definitions across the first 2 parts of speech.
        const out = { defs: [] };
        for (const m of entry.meanings.slice(0, 2)) {
          const d = m.definitions && m.definitions[0];
          if (d) out.defs.push({ pos: m.partOfSpeech || '', def: d.definition || '', example: d.example || '' });
        }
        this.cache[key] = out;
        this.saveCache();
        return out;
      } catch (e) {
        return { error: 'no internet?' };
      }
    },

    // Format a lookup result as plain HTML. Caller chooses where to insert it.
    formatHtml(result) {
      if (!result) return '';
      if (result.notFound) return '<em>No definition found.</em>';
      if (result.error) return '<em>Couldn\'t fetch (' + escapeHtml(result.error) + ').</em>';
      const defs = result.defs || [];
      if (!defs.length) return '<em>No definition found.</em>';
      return defs.map(d => {
        const pos = d.pos ? '<span class="def-pos">' + escapeHtml(d.pos) + '</span> ' : '';
        const ex = d.example ? '<div class="def-example">"' + escapeHtml(d.example) + '"</div>' : '';
        return '<div>' + pos + escapeHtml(d.def) + ex + '</div>';
      }).join('');
    },
  };

  // -------- Progress / HUD --------
  function masteryCount() {
    let c = 0;
    for (const w of WORDS) if (S.isMastered(state.progress[w.n])) c++;
    return c;
  }

  // Today's batch is a random sample of unmastered words, but stable for a
  // calendar day — the seed is the local date string. New batch tomorrow,
  // same batch all day no matter how many times the kid reloads.
  function todaySeed() {
    const d = new Date();
    return `uil-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function todaysBatchEntries() {
    return S.todaysBatch(WORDS, state.progress, state.settings.batchSize, S.seededRng(todaySeed()));
  }

  function currentBatch() {
    if (state.settings.useFullPool) return null;
    return todaysBatchEntries().map(e => e.n);
  }

  function updateHud() {
    const m = masteryCount();
    document.getElementById('mastery-count').innerHTML =
      `<strong>${m}</strong> / 800 mastered`;

    const bEl = document.getElementById('batch-count');
    if (state.settings.useFullPool) {
      bEl.innerHTML = `<strong>full list</strong>`;
    } else {
      bEl.innerHTML = `today: <strong>${todaysBatchEntries().length}</strong> to go`;
    }
  }

  // -------- Tabs --------
  let currentMode = null;
  function setMode(mode) {
    // Tear down anything time-sensitive in the previous mode.
    if (currentMode === 'test' && testMode.active) testMode.quit();
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    for (const tab of document.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    }
    document.getElementById('panel-practice').classList.toggle('hidden', mode !== 'practice');
    document.getElementById('panel-flash').classList.toggle('hidden',    mode !== 'flash');
    document.getElementById('panel-test').classList.toggle('hidden',     mode !== 'test');
    currentMode = mode;
    if (mode === 'practice') practice.enter();
    if (mode === 'flash')    flash.enter();
    if (mode === 'test')     testMode.enter();
  }

  // -------- Practice --------
  const practice = {
    current: null,
    sessionWrong: [],          // entry numbers answered wrong this session, FIFO
    checked: false,            // has the current attempt been checked
    wasWrong: false,           // for retype flow

    enter() {
      if (!this.current) this.next();
      document.getElementById('practice-input').focus();
    },

    next() {
      const batch = currentBatch();
      const n = S.pickNext(WORDS, state.progress, this.sessionWrong, batch, Math.random);
      if (n == null) {
        this.renderEmpty();
        return;
      }
      this.current = BY_N.get(n);
      this.checked = false;
      this.wasWrong = false;
      this.render();
      this.speak();
    },

    render() {
      const input = document.getElementById('practice-input');
      const feedback = document.getElementById('practice-feedback');
      const hintEl = document.getElementById('practice-hint');
      const defEl = document.getElementById('practice-definition');
      input.value = '';
      input.className = '';
      input.disabled = false;
      input.placeholder = 'Type what you hear…';
      input.focus();
      feedback.hidden = true;
      feedback.className = 'feedback';
      feedback.textContent = '';
      // Hide any leftover definition from the previous word.
      defEl.hidden = true;
      defEl.innerHTML = '';
      defEl.classList.remove('loading');

      const bits = [];
      if (this.current.hint) bits.push(`hint: ${this.current.hint}`);
      if (this.current.accepted.length > 1) bits.push('either spelling is OK');
      if (this.current.caseSensitive && this.current.accepted.every(a => /^[A-Z]/.test(a))) {
        bits.push('needs a capital letter');
      }
      if (bits.length) {
        hintEl.hidden = false;
        hintEl.textContent = bits.join(' · ');
      } else {
        hintEl.hidden = true;
        hintEl.textContent = '';
      }
    },

    renderEmpty() {
      // Keep the panel structure intact — overwrite only the feedback + input area.
      this.current = null;
      const input = document.getElementById('practice-input');
      const feedback = document.getElementById('practice-feedback');
      const hintEl = document.getElementById('practice-hint');
      input.value = '';
      input.disabled = true;
      input.placeholder = 'No words to practice — adjust batch or add more.';
      hintEl.hidden = true;
      feedback.hidden = false;
      feedback.className = 'feedback correct';
      feedback.innerHTML = '🎉 Every word in your batch is mastered! ' +
        'Increase the batch size in Settings or turn on "full pool" to keep going.';
    },

    speak() {
      if (this.current) tts.speak(this.current.accepted[0]);
    },

    async showDefinition() {
      if (!this.current) return;
      const word = this.current.accepted[0];
      const defEl = document.getElementById('practice-definition');
      // Pin which word this lookup is for, so a slow response that arrives
      // after the kid advances doesn't paint a stale definition.
      const forWord = word;
      defEl.hidden = false;
      defEl.classList.add('loading');
      defEl.innerHTML = 'Looking up…';
      const result = await defs.lookup(word);
      if (!this.current || this.current.accepted[0] !== forWord) return;
      defEl.classList.remove('loading');
      defEl.innerHTML = defs.formatHtml(result);
    },

    submit() {
      if (!this.current) return;
      const input = document.getElementById('practice-input');
      const feedback = document.getElementById('practice-feedback');
      const attempt = input.value;

      if (this.checked) {
        // Advance button after a check
        this.next();
        return;
      }

      const correct = S.isCorrect(attempt, this.current);
      const entry = this.current;

      if (this.wasWrong) {
        // Retype mode: advance only on a correct retype. Doesn't re-score.
        // Skip button still lets the kid move on without typing it.
        if (correct) {
          this.next();
        } else {
          input.classList.add('wrong');
          setTimeout(() => input.classList.remove('wrong'), 400);
        }
        return;
      }

      state.progress[entry.n] = S.updateProgress(state.progress[entry.n], correct, Date.now());
      saveState();
      updateHud();

      if (correct) {
        this.sessionWrong = this.sessionWrong.filter(n => n !== entry.n);
        input.classList.add('correct');
        input.disabled = true;
        feedback.hidden = false;
        feedback.className = 'feedback correct';
        const masteredNow = S.isMastered(state.progress[entry.n]);
        const celebrate = masteredNow ? ' <span style="font-size:1.3rem">🏆 mastered!</span>' : '';
        feedback.innerHTML =
          `Correct! <span class="answer">${escapeHtml(entry.display)}</span>` + celebrate +
          `<div style="font-size:0.9rem;margin-top:6px;color:var(--ink-soft)">Press <kbd>Enter</kbd> for the next word.</div>`;
        if (masteredNow) feedback.classList.add('celebrate');
        this.checked = true;
      } else {
        if (!this.sessionWrong.includes(entry.n)) this.sessionWrong.push(entry.n);
        input.classList.add('wrong');
        feedback.hidden = false;
        feedback.className = 'feedback wrong';
        const altNote = entry.accepted.length > 1 ? ' (either spelling is OK)' : '';
        feedback.innerHTML =
          `Not quite — the answer is <span class="answer">${escapeHtml(entry.display)}</span>${altNote}. Type it again to move on.`;
        this.wasWrong = true;
        input.value = '';
        input.classList.remove('wrong');
        input.focus();
      }
    },

    skip() {
      this.next();
    },
  };

  // -------- Flashcards --------
  // Three-state cycle:
  //   study  — word + definition visible. Kid taps "I'm ready" to advance.
  //   recall — word hidden, definition stays as the cue. Kid types and Checks.
  //   result — actual word revealed, ✓ or ✗ shown. Kid taps "Next card".
  const flash = {
    idx: 0,
    pool: [],
    state: 'study',     // 'study' | 'recall' | 'result'
    lastResult: null,   // 'correct' | 'wrong' | null

    enter() {
      const fr = state.settings.flashRange;
      if (fr && fr.enabled) {
        this.pool = entriesInRange(fr);
      } else if (state.settings.useFullPool) {
        this.pool = WORDS;
      } else {
        this.pool = todaysBatchEntries();
      }
      if (this.pool.length === 0) this.pool = WORDS;
      if (this.idx >= this.pool.length) this.idx = 0;
      this.state = 'study';
      this.lastResult = null;
      this.render();
    },

    setCard(idx) {
      this.idx = idx;
      this.state = 'study';
      this.lastResult = null;
      this.render();
    },

    ready() {
      this.state = 'recall';
      this.render();
      const input = document.getElementById('flash-input');
      input.value = '';
      input.focus();
    },

    check() {
      const w = this.pool[this.idx];
      const input = document.getElementById('flash-input');
      const correct = S.isCorrect(input.value, w);
      // Flashcards are a study mode — attempts here don't update mastery.
      // Practice is the canonical place to earn streaks.
      this.lastResult = correct ? 'correct' : 'wrong';
      this.state = 'result';
      this.render();
    },

    cont() {
      this.setCard((this.idx + 1) % this.pool.length);
    },

    render() {
      const w = this.pool[this.idx];
      const wordEl     = document.getElementById('flash-word');
      const wordHidden = document.getElementById('flash-word-hidden');
      const hintEl     = document.getElementById('flash-hint');
      const inputEl    = document.getElementById('flash-input');
      const resultEl   = document.getElementById('flash-result');
      const readyBtn   = document.getElementById('flash-ready');
      const checkBtn   = document.getElementById('flash-check');
      const contBtn    = document.getElementById('flash-cont');

      document.getElementById('flash-meta').textContent =
        `${this.idx + 1} / ${this.pool.length}  ·  #${w.n}`;
      wordEl.textContent = w.display;

      const bits = [];
      if (w.hint) bits.push(`hint: ${w.hint}`);
      if (w.accepted.length > 1) bits.push(`either: ${w.accepted.join(' / ')}`);
      if (w.caseSensitive && w.accepted.every(a => /^[A-Z]/.test(a))) {
        bits.push('capital required');
      }
      hintEl.textContent = bits.join('  ·  ');

      // Visibility per state.
      const isStudy  = this.state === 'study';
      const isRecall = this.state === 'recall';
      const isResult = this.state === 'result';

      wordEl.hidden     = isRecall;             // hide word during recall
      wordHidden.hidden = !isRecall;
      inputEl.hidden    = !isRecall;
      resultEl.hidden   = !isResult;
      readyBtn.hidden   = !isStudy;
      checkBtn.hidden   = !isRecall;
      contBtn.hidden    = !isResult;

      if (isResult) {
        if (this.lastResult === 'correct') {
          resultEl.className = 'feedback flash-result correct';
          resultEl.innerHTML = `Correct! <span class="answer">${escapeHtml(w.display)}</span>`;
        } else {
          resultEl.className = 'feedback flash-result wrong';
          const altNote = w.accepted.length > 1 ? ' (either spelling is OK)' : '';
          const yours = inputEl.value ? ` (you typed <em>${escapeHtml(inputEl.value)}</em>)` : '';
          resultEl.innerHTML = `Not quite — the answer is <span class="answer">${escapeHtml(w.display)}</span>${altNote}${yours}.`;
        }
      }

      this.loadDefinition(w);
    },

    async loadDefinition(w) {
      const defEl = document.getElementById('flash-definition');
      const forWord = w.accepted[0];
      defEl.classList.add('loading');
      defEl.innerHTML = 'Looking up…';
      const result = await defs.lookup(forWord);
      const cur = this.pool[this.idx];
      if (!cur || cur.accepted[0] !== forWord) return;
      defEl.classList.remove('loading');
      defEl.innerHTML = defs.formatHtml(result);
    },

    prev() { this.setCard((this.idx - 1 + this.pool.length) % this.pool.length); this.speak(); },
    next() { this.setCard((this.idx + 1) % this.pool.length); this.speak(); },

    speak() {
      const w = this.pool[this.idx];
      if (w) tts.speak(w.accepted[0]);
    },
  };

  // -------- Test Simulator --------
  const testMode = {
    active: false,
    queue: [],      // entry objects in order
    cursor: 0,
    answers: [],    // { entry, attempt, correct }
    tickTimer: null,

    enter() {
      // Reset to setup view on entry.
      document.getElementById('test-setup').hidden = false;
      document.getElementById('test-run').hidden = true;
      document.getElementById('test-results').hidden = true;
    },

    start() {
      const main = parseInt(document.getElementById('test-main').value, 10) || 80;
      const tie  = parseInt(document.getElementById('test-tie').value, 10) || 0;
      const pool = document.getElementById('test-pool').value;
      const tr   = state.settings.testRange;

      let candidates = WORDS.slice();
      if (tr && tr.enabled) {
        candidates = entriesInRange(tr);
      }
      if (pool === 'unmastered') {
        candidates = candidates.filter(w => !S.isMastered(state.progress[w.n]));
      }

      if (candidates.length < main + tie) {
        const where = tr && tr.enabled ? ` in words ${tr.from}-${tr.to}` : '';
        const which = pool === 'unmastered' ? 'unmastered ' : '';
        alert(`Not enough ${which}words${where} for a ${main + tie}-word test. Reduce counts, widen the range, or switch pool.`);
        return;
      }

      const shuffled = S.shuffle(candidates, Math.random);
      this.queue = shuffled.slice(0, main + tie);
      this.mainCount = main;
      this.tieCount = tie;
      this.cursor = 0;
      this.answers = [];
      this.active = true;

      document.getElementById('test-setup').hidden = true;
      document.getElementById('test-run').hidden = false;
      document.getElementById('test-results').hidden = true;

      this.showCurrent();
    },

    showCurrent() {
      if (this.cursor >= this.queue.length) return this.finish();
      const w = this.queue[this.cursor];
      const isTie = this.cursor >= this.mainCount;
      const phase = isTie
        ? `Tiebreaker ${this.cursor - this.mainCount + 1} of ${this.tieCount}`
        : `Word ${this.cursor + 1} of ${this.mainCount}`;
      document.getElementById('test-status').textContent = phase;
      document.getElementById('test-word-number').textContent = `#${this.cursor + 1}`;
      const input = document.getElementById('test-input');
      input.value = '';
      input.disabled = false;
      input.focus();
      tts.speak(w.accepted[0]);
      this.scheduleAutoAdvance();
    },

    scheduleAutoAdvance() {
      if (this.tickTimer) clearTimeout(this.tickTimer);
      const wpm = parseInt(document.getElementById('test-wpm').value, 10) || 5;
      const ms = Math.max(3000, Math.round(60000 / wpm));
      this.tickTimer = setTimeout(() => this.advance(), ms);
    },

    advance() {
      if (!this.active) return;
      const w = this.queue[this.cursor];
      const attempt = document.getElementById('test-input').value;
      const correct = S.isCorrect(attempt, w);
      this.answers.push({ entry: w, attempt, correct });
      this.cursor++;
      if (this.cursor >= this.queue.length) return this.finish();
      this.showCurrent();
    },

    quit() {
      this.active = false;
      if (this.tickTimer) { clearTimeout(this.tickTimer); this.tickTimer = null; }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      this.queue = [];
      this.cursor = 0;
      this.answers = [];
      this.enter();
    },

    finish() {
      this.active = false;
      if (this.tickTimer) clearTimeout(this.tickTimer);
      document.getElementById('test-run').hidden = true;

      const resultsEl = document.getElementById('test-results');
      resultsEl.hidden = false;

      const main = this.answers.slice(0, this.mainCount);
      const tie  = this.answers.slice(this.mainCount);
      const mainCorrect = main.filter(a => a.correct).length;
      const tieCorrect  = tie.filter(a => a.correct).length;
      const pct = main.length ? Math.round(100 * mainCorrect / main.length) : 0;
      const tone = pct >= 90 ? 'good' : pct >= 70 ? 'mid' : 'bad';

      let html = `<h2>Test results</h2>
        <div class="score ${tone}">${mainCorrect} / ${main.length} &nbsp; (${pct}%)</div>`;
      if (tie.length) html += `<div class="meta">Tiebreaker: ${tieCorrect} / ${tie.length}</div>`;
      html += '<h3>Per word</h3><ol>';
      for (const a of this.answers) {
        const cls = a.correct ? 'correct' : 'wrong';
        const mark = a.correct ? '✓' : '✗';
        const shownAttempt = a.attempt ? ` — your answer: <em>${escapeHtml(a.attempt)}</em>` : ' — (no answer)';
        html += `<li class="${cls}">${mark} ${escapeHtml(a.entry.display)}${a.correct ? '' : shownAttempt}</li>`;
      }
      html += '</ol>';
      html += `<div class="row"><button class="big-btn ghost" id="test-redo">New test</button></div>`;
      resultsEl.innerHTML = html;
      document.getElementById('test-redo').addEventListener('click', () => this.enter());
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Generic wiring for the "Pick a range" UI used in both Flashcards and Test.
  // The caller supplies element IDs and getters/setters so the same code works
  // for both (each mode persists its own range to settings).
  function wireRange(spec) {
    const en   = document.getElementById(spec.keyEnabled);
    const from = document.getElementById(spec.keyFrom);
    const to   = document.getElementById(spec.keyTo);
    const wrap = document.getElementById(spec.keyFields);
    const ct   = document.getElementById(spec.keyCount);

    function paint() {
      const r = normRange(spec.get());
      en.checked = r.enabled;
      from.value = r.from;
      to.value   = r.to;
      wrap.hidden = !r.enabled;
      ct.textContent = r.enabled ? `(${entriesInRange(r).length} words)` : '';
    }

    function commit() {
      spec.set(normRange({ enabled: en.checked, from: from.value, to: to.value }));
      paint();
    }

    en.addEventListener('change', commit);
    from.addEventListener('change', commit);
    to.addEventListener('change',   commit);
    paint();
  }

  // -------- Wire up events --------
  function init() {
    // Tabs
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => setMode(tab.dataset.mode));
    }

    // Practice
    document.getElementById('practice-speak').addEventListener('click', () => practice.speak());
    document.getElementById('practice-submit').addEventListener('click', () => practice.submit());
    document.getElementById('practice-skip').addEventListener('click', () => practice.skip());
    document.getElementById('practice-define').addEventListener('click', () => practice.showDefinition());
    document.getElementById('practice-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); practice.submit(); }
    });

    // Flashcards
    document.getElementById('flash-prev').addEventListener('click',  () => flash.prev());
    document.getElementById('flash-next').addEventListener('click',  () => flash.next());
    document.getElementById('flash-speak').addEventListener('click', () => flash.speak());
    document.getElementById('flash-ready').addEventListener('click', () => flash.ready());
    document.getElementById('flash-check').addEventListener('click', () => flash.check());
    document.getElementById('flash-cont').addEventListener('click',  () => flash.cont());
    document.getElementById('flash-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); flash.check(); }
    });

    // Flashcard range controls
    wireRange({
      keyEnabled: 'flash-range-enabled',
      keyFrom:    'flash-range-from',
      keyTo:      'flash-range-to',
      keyFields:  'flash-range-fields',
      keyCount:   'flash-range-count',
      get: () => state.settings.flashRange,
      set: r => { state.settings.flashRange = r; saveState(); flash.idx = 0; flash.enter(); },
    });
    // Test range controls
    wireRange({
      keyEnabled: 'test-range-enabled',
      keyFrom:    'test-range-from',
      keyTo:      'test-range-to',
      keyFields:  'test-range-fields',
      keyCount:   'test-range-count',
      get: () => state.settings.testRange,
      set: r => { state.settings.testRange = r; saveState(); },
    });

    // Test
    document.getElementById('test-start').addEventListener('click', () => testMode.start());
    document.getElementById('test-replay').addEventListener('click', () => {
      const w = testMode.queue[testMode.cursor];
      if (!w) return;
      tts.speak(w.accepted[0]);
      // Reset the auto-advance clock — the replay should reset how long the kid has to answer.
      testMode.scheduleAutoAdvance();
    });
    document.getElementById('test-next').addEventListener('click',  () => testMode.advance());
    document.getElementById('test-quit').addEventListener('click',  () => testMode.quit());
    document.getElementById('test-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); testMode.advance(); }
    });

    // Settings
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsPanel = document.getElementById('settings');
    settingsToggle.addEventListener('click', () => settingsPanel.classList.toggle('open'));

    const batchInput = document.getElementById('batch-size');
    batchInput.value = state.settings.batchSize;
    batchInput.addEventListener('change', () => {
      const v = Math.max(5, Math.min(100, parseInt(batchInput.value, 10) || 20));
      state.settings.batchSize = v;
      batchInput.value = v;
      saveState();
      updateHud();
    });

    const rateInput = document.getElementById('tts-rate');
    const rateDisplay = document.getElementById('tts-rate-display');
    rateInput.value = state.settings.ttsRate;
    rateDisplay.textContent = state.settings.ttsRate.toFixed(2);
    rateInput.addEventListener('input', () => {
      state.settings.ttsRate = parseFloat(rateInput.value);
      rateDisplay.textContent = state.settings.ttsRate.toFixed(2);
      saveState();
    });

    const voiceSelect = document.getElementById('tts-voice');
    voiceSelect.addEventListener('change', () => {
      state.settings.voiceURI = voiceSelect.value;
      tts.chosen = tts.voices.find(v => v.voiceURI === voiceSelect.value) || tts.chosen;
      saveState();
    });

    const useFull = document.getElementById('use-full-pool');
    useFull.checked = !!state.settings.useFullPool;
    useFull.addEventListener('change', () => {
      state.settings.useFullPool = useFull.checked;
      saveState();
      updateHud();
    });

    document.getElementById('reset-progress').addEventListener('click', () => {
      if (!confirm('Reset all progress? This clears every word\'s mastery and streaks.')) return;
      state.progress = {};
      practice.sessionWrong = [];
      practice.current = null;
      saveState();
      updateHud();
      setMode('practice');
    });

    // TTS voices load asynchronously on some browsers.
    tts.refresh();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => tts.refresh();
    }

    updateHud();
    setMode('practice');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
