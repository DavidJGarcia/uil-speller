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
      },
    };
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
      input.value = '';
      input.className = '';
      input.disabled = false;
      input.placeholder = 'Type what you hear…';
      input.focus();
      feedback.hidden = true;
      feedback.className = 'feedback';
      feedback.textContent = '';

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
  const flash = {
    idx: 0,
    pool: [],

    enter() {
      this.pool = state.settings.useFullPool ? WORDS : todaysBatchEntries();
      if (this.pool.length === 0) this.pool = WORDS; // fallback when batch empty
      if (this.idx >= this.pool.length) this.idx = 0;
      this.render();
    },

    render() {
      const w = this.pool[this.idx];
      document.getElementById('flash-meta').textContent =
        `${this.idx + 1} / ${this.pool.length}  ·  #${w.n}`;
      document.getElementById('flash-word').textContent = w.display;
      const hintEl = document.getElementById('flash-hint');
      const bits = [];
      if (w.hint) bits.push(`hint: ${w.hint}`);
      if (w.accepted.length > 1) bits.push(`either: ${w.accepted.join(' / ')}`);
      if (w.caseSensitive && w.accepted.every(a => /^[A-Z]/.test(a))) {
        bits.push('capital required');
      }
      hintEl.textContent = bits.join('  ·  ');
    },

    prev() { this.idx = (this.idx - 1 + this.pool.length) % this.pool.length; this.render(); this.speak(); },
    next() { this.idx = (this.idx + 1) % this.pool.length; this.render(); this.speak(); },

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

      const candidates = pool === 'unmastered'
        ? WORDS.filter(w => !S.isMastered(state.progress[w.n]))
        : WORDS.slice();

      if (candidates.length < main + tie) {
        alert(`Not enough ${pool === 'unmastered' ? 'unmastered' : ''} words for a ${main + tie}-word test. Reduce counts or switch pool.`);
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
    document.getElementById('practice-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); practice.submit(); }
    });

    // Flashcards
    document.getElementById('flash-prev').addEventListener('click',  () => flash.prev());
    document.getElementById('flash-next').addEventListener('click',  () => flash.next());
    document.getElementById('flash-speak').addEventListener('click', () => flash.speak());

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
