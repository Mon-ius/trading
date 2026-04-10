/**
 * App Controller — Theme, i18n, export, UI binding.
 * Unified DLM (2005, AER) + Lopez-Lira (2025) experiment.
 */

let _result = null, _floor = null;

/* ================================================================
   Slide navigation
   ================================================================ */
let _curSlide = 1;
function _slideCount() { return document.querySelectorAll('#slides-viewport .slide').length; }
function slideNav(dir) {
  const total = _slideCount();
  const next = Math.max(1, Math.min(total, _curSlide + dir));
  if (next === _curSlide) return;
  _curSlide = next;
  document.querySelectorAll('#slides-viewport .slide').forEach(s => s.classList.remove('active'));
  const el = document.querySelector(`#slides-viewport .slide[data-slide="${_curSlide}"]`);
  if (el) el.classList.add('active');
  document.getElementById('slide-cur').textContent = _curSlide;
  document.getElementById('slide-prev').disabled = _curSlide <= 1;
  document.getElementById('slide-next').disabled = _curSlide >= total;
}
function toggleSlideFullscreen() {
  document.getElementById('slides-viewport').classList.toggle('fullscreen');
}
function toggleReadingMode() {
  document.getElementById('slides-viewport').classList.toggle('reading-mode');
}
function exportSlidesPDF() {
  const vp = document.getElementById('slides-viewport');
  const wasReading = vp.classList.contains('reading-mode');
  if (!wasReading) vp.classList.add('reading-mode');
  setTimeout(() => {
    window.print();
    if (!wasReading) vp.classList.remove('reading-mode');
  }, 400);
}
(function initSlides() {
  const total = document.querySelectorAll('#slides-viewport .slide').length;
  const totEl = document.getElementById('slide-tot');
  if (totEl) totEl.textContent = total;
  const prevBtn = document.getElementById('slide-prev');
  if (prevBtn) prevBtn.disabled = true;
  document.addEventListener('keydown', e => {
    const slidesTab = document.getElementById('tab-slides');
    if (!slidesTab || !slidesTab.classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); slideNav(1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); slideNav(-1); }
    if (e.key === 'Escape') {
      const vp = document.getElementById('slides-viewport');
      if (vp && vp.classList.contains('fullscreen')) { vp.classList.remove('fullscreen'); e.preventDefault(); }
    }
    if (e.key === 'f' || e.key === 'F') { toggleSlideFullscreen(); e.preventDefault(); }
  });
})();

/* ================================================================
   Theme management
   ================================================================ */
const THEME_KEY = 'trading-theme';
function getEffectiveTheme() {
  const p = localStorage.getItem(THEME_KEY) || 'auto';
  if (p === 'auto') return window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  return p;
}
function applyTheme() { document.documentElement.setAttribute('data-theme', localStorage.getItem(THEME_KEY) || 'auto'); }
function _isDark() { return getEffectiveTheme() === 'dark'; }

/* ================================================================
   Read experiment parameters
   ================================================================ */
function readSimParams() {
  const v = id => { const el = document.getElementById(id); return el ? +el.value : 0; };
  return {
    n: v('p-n'),
    T: v('sim-T'),
    expectedDiv: v('sim-edv') / 10,
    initialCash: v('sim-cash'),
    initialShares: v('sim-shares'),
    endowVar: v('sim-endow'),
    seed: v('p-seed'),
    alpha: v('sim-alpha') / 100,
    experienceRounds: v('sim-exp'),
    inexpBias: v('sim-bias') / 100,
    inexpAnchor: v('sim-anchor') / 100,
    inexpNoise: v('sim-noise') / 100,
    momentum: v('sim-mom') / 100,
    expNoise: 0.05,
    rlPct: v('p-rl'),
    rnPct: v('p-rn'),
  };
}

/* ================================================================
   Run experiment
   ================================================================ */
function runSimExperiment() {
  const btn = document.getElementById('btn-run');
  btn.disabled = true; btn.textContent = t('btn.running');
  setTimeout(() => {
    try {
      const params = readSimParams();
      _result = runExperiment(params);
      renderResults(_result);
    } catch (e) {
      console.error('Experiment error:', e);
    } finally {
      btn.disabled = false; btn.textContent = t('btn.run');
    }
  }, 30);
}

function renderResults(result) {
  document.getElementById('log-card').style.display = 'block';

  // Summary cards
  const bm = result.session.bubbleMetrics;
  const cards = {
    'sc-r2':    { val: bm.haesselR2.toFixed(3),         color: bm.haesselR2 > 0.5 ? 'var(--green)' : 'var(--red)' },
    'sc-napd':  { val: bm.napd.toFixed(3),              color: bm.napd < 0.15 ? 'var(--green)' : 'var(--red)' },
    'sc-amp':   { val: bm.amplitude.toFixed(2),         color: bm.amplitude < 0.5 ? 'var(--green)' : 'var(--amber)' },
    'sc-turn':  { val: bm.turnover.toFixed(2),          color: 'var(--accent)' },
    'sc-trades':{ val: result.session.totalTrades,      color: 'var(--accent)' },
    'sc-sess':  { val: (result.sessionResults || []).length, color: 'var(--accent)' },
  };
  for (const [id, c] of Object.entries(cards)) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = c.val;
      el.style.color = c.color;
    }
  }

  renderAllCharts(result);
  renderLog(result);

  // Build floor history from result
  const history = resultToHistory(result);
  if (document.querySelector('.view-btn[data-view="game"].active')) initGame(history);
}

/* ================================================================
   Convert experiment result to TradingFloor history
   ================================================================ */
function resultToHistory(result) {
  const session = result.session;
  return {
    agents: result.initialSnapshot,
    prices: session.prices,
    fvs: session.fvs,
    volumes: session.volumes,
    spreads: session.spreads,
    rounds: session.rounds.map((r, i) => ({
      period: i, fv: session.fvs[i], div: r.dividend || 0,
      trades: r.trades || [], vwap: r.vwap, volume: r.volume || 0,
      bestBid: r.bestBid, bestAsk: r.bestAsk,
    })),
    bubble: session.bubbleMetrics,
  };
}

/* ================================================================
   Export — JSON & CSV
   ================================================================ */
function exportJSON() {
  if (!_result) return;
  const blob = new Blob([JSON.stringify(_result, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'experiment_data.json'; a.click(); URL.revokeObjectURL(a.href);
}

function exportCSV() {
  if (!_result) return;
  const lines = [];
  // Agents header
  lines.push('# AGENTS');
  lines.push('id,name,expType,riskType,gamma,initialCash,initialShares');
  for (const a of _result.initialSnapshot) {
    lines.push(`${a.id},${a.displayName},${a.expType},${a.riskType},${a.gamma.toFixed(4)},${a.cash},${a.shares}`);
  }
  // Sessions
  lines.push('');
  lines.push('# SESSIONS');
  lines.push('session,experience,period,fv,price,volume,dividend');
  for (const sess of _result.sessionResults) {
    sess.rounds.forEach((r, i) => {
      lines.push(`${sess.session},${sess.experience},${i + 1},${sess.fvs[i].toFixed(2)},${r.vwap != null ? r.vwap.toFixed(2) : ''},${r.volume || 0},${(r.dividend || 0).toFixed(2)}`);
    });
  }
  // Bubble metrics
  lines.push('');
  lines.push('# BUBBLE METRICS');
  lines.push('session,experience,haesselR2,mse,napd,amplitude,turnover');
  for (const sess of _result.sessionResults) {
    const bm = sess.bubbleMetrics;
    lines.push(`${sess.session},${sess.experience},${bm.haesselR2.toFixed(4)},${bm.mse.toFixed(4)},${bm.napd.toFixed(4)},${bm.amplitude.toFixed(4)},${bm.turnover.toFixed(4)}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'experiment_data.csv'; a.click(); URL.revokeObjectURL(a.href);
}

/* ================================================================
   Game
   ================================================================ */
function initGame(h) {
  if (_floor) _floor.stop();
  _floor = new TradingFloor(document.getElementById('game-canvas'), h);
  _floor.start();
}

/* ================================================================
   Log
   ================================================================ */
function renderLog(result) {
  const log = document.getElementById('log-body');
  log.innerHTML = '';

  // Header
  const head = document.createElement('div');
  head.className = 'log-entry';
  head.style.cssText = 'font-weight:700;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:6px';
  const fv0 = result.fv0;
  head.innerHTML = `T=${result.T} periods | E[d]=${result.expectedDiv.toFixed(2)} | FV(0)=${fv0.toFixed(1)} | n=${result.initialSnapshot.length} agents`;
  log.appendChild(head);

  // Initial roster
  const initDet = document.createElement('details');
  initDet.className = 'log-round'; initDet.open = false;
  const initSum = document.createElement('summary');
  const nExp = result.initialSnapshot.filter(a => a.expType === 'experienced').length;
  initSum.textContent = `Initial Roster: ${result.initialSnapshot.length} agents (${nExp} experienced, ${result.initialSnapshot.length - nExp} inexperienced)`;
  initDet.appendChild(initSum);
  for (const a of result.initialSnapshot) {
    const d = document.createElement('div'); d.className = 'log-entry';
    const rColor = a.riskType === 'risk_loving' ? 'var(--red)' : a.riskType === 'risk_neutral' ? 'var(--amber)' : 'var(--blue)';
    const rLabel = a.riskType === 'risk_loving' ? t('rt.rl') : a.riskType === 'risk_neutral' ? t('rt.rn') : t('rt.ra');
    const eLabel = a.expType === 'experienced' ? t('info.experienced') : t('info.inexperienced');
    d.innerHTML = `<strong>${a.displayName}</strong> <span style="color:${rColor}">${rLabel}</span> | ${eLabel} | \u03b3=${a.gamma.toFixed(4)} | cash=$${a.cash} | shares=${a.shares}`;
    initDet.appendChild(d);
  }
  log.appendChild(initDet);

  // Each session
  for (const sess of result.sessionResults) {
    const det = document.createElement('details');
    det.className = 'log-round';
    det.open = sess.session === 1;
    const sum = document.createElement('summary');
    const bm = sess.bubbleMetrics;
    sum.textContent = `Session ${sess.session} (exp=${sess.experience}): R\u00b2=${bm.haesselR2.toFixed(2)} | NAPD=${bm.napd.toFixed(2)} | Amp=${bm.amplitude.toFixed(2)} | trades=${sess.totalTrades}`;
    det.appendChild(sum);

    for (const r of sess.rounds) {
      const d = document.createElement('div'); d.className = 'log-entry';
      const prStr = r.vwap != null ? `P=$${r.vwap.toFixed(1)}` : 'no trades';
      d.textContent = `Period ${r.period + 1}: FV=${r.fv.toFixed(1)} | ${r.volume} trades | ${prStr} | div=${r.dividend.toFixed(1)}`;
      det.appendChild(d);
    }

    // Per-agent P&L summary
    for (const a of sess.agents) {
      const d = document.createElement('div'); d.className = 'log-entry';
      const eLabel = a.expType === 'experienced' ? 'Exp' : 'Inexp';
      d.innerHTML = `<strong>${a.displayName}</strong> ${eLabel} | shares=${a.shares} | P&L=${a.totalPnL >= 0 ? '+' : ''}${a.totalPnL.toFixed(0)} | div=${a.dividendsReceived.toFixed(0)}`;
      det.appendChild(d);
    }
    log.appendChild(det);
  }
}

/* ================================================================
   i18n update
   ================================================================ */
function fullI18N() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.innerHTML = t(el.dataset.i18n); });
}

/* ================================================================
   Panel toggle
   ================================================================ */
function togglePanel(id) { document.getElementById(id).classList.toggle('collapsed'); }

/* ================================================================
   Setup — all event bindings
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const next = getEffectiveTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next); applyTheme();
    if (_result) renderAllCharts(_result);
  });
  window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => {
    applyTheme(); if (_result) renderAllCharts(_result);
  });

  // Language
  document.getElementById('lang-select').addEventListener('change', function () {
    setLang(this.value); fullI18N();
    if (_result) renderResults(_result);
  });

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab.dataset.tab));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    const target = document.getElementById('tab-' + tab.dataset.tab);
    if (target) target.classList.add('active');
    document.getElementById('nav-menu').classList.remove('open');
    const isExp = tab.dataset.tab === 'experiment';
    document.getElementById('sidebar').style.display = isExp ? '' : 'none';
    document.getElementById('sidebar-toggle').style.display = isExp ? '' : 'none';
    if (!isExp) {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-backdrop').classList.remove('visible');
    }
  }));

  // Sidebar
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('visible'); }
  function openSidebar() { sidebar.classList.add('open'); backdrop.classList.add('visible'); }
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  backdrop.addEventListener('click', closeSidebar);

  // Hamburger
  const hamburger = document.getElementById('nav-hamburger');
  const navMenu = document.getElementById('nav-menu');
  hamburger.addEventListener('click', e => { e.stopPropagation(); navMenu.classList.toggle('open'); });
  document.addEventListener('click', e => { if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) navMenu.classList.remove('open'); });
  navMenu.addEventListener('click', e => { if (e.target.closest('.mobile-toggle, .theme-btn')) navMenu.classList.remove('open'); });
  const ls = document.getElementById('lang-select');
  if (ls) ls.addEventListener('change', () => navMenu.classList.remove('open'));

  // Draw.io link
  (function setupDrawio() {
    const btn = document.getElementById('btn-drawio');
    if (btn) btn.href = 'https://app.diagrams.net/#HMon-ius%2Ftrading%2Fmaster%2Farchitecture.svg';
  })();

  // View toggle
  document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('chart-view').style.display = view === 'chart' ? 'block' : 'none';
    document.getElementById('game-view').style.display = view === 'game' ? 'block' : 'none';
    if (view === 'game' && _result && !_floor) initGame(resultToHistory(_result));
    if (view === 'chart' && _floor) { _floor.stop(); _floor = null; }
  }));

  // Range displays — auto-sync
  document.querySelectorAll('.sidebar input[type=range]').forEach(inp => {
    const vid = inp.id.startsWith('sim-') ? 'v-' + inp.id : 'v-' + inp.id.slice(2);
    const ve = document.getElementById(vid);
    if (!ve) return;
    const upd = () => {
      if (['p-rl', 'p-rn', 'p-ra'].includes(inp.id)) {
        ve.textContent = inp.value + '%';
      } else if (['sim-endow', 'sim-alpha', 'sim-bias', 'sim-anchor', 'sim-noise', 'sim-mom'].includes(inp.id)) {
        ve.textContent = inp.value + '%';
      } else if (inp.id === 'sim-edv') {
        ve.textContent = (inp.value / 10).toFixed(1);
      } else {
        ve.textContent = inp.value;
      }
    };
    inp.addEventListener('input', upd);
    upd();
  });

  // Risk composition — linked sliders + comp-bar
  function updateCompBar() {
    const rl = +document.getElementById('p-rl').value;
    const rn = +document.getElementById('p-rn').value;
    const ra = +document.getElementById('p-ra').value;
    const bar = document.getElementById('comp-bar');
    if (bar) {
      bar.children[0].style.flex = rl || 0.001;
      bar.children[1].style.flex = rn || 0.001;
      bar.children[2].style.flex = ra || 0.001;
      bar.children[0].querySelector('span').textContent = rl + '%';
      bar.children[1].querySelector('span').textContent = rn + '%';
      bar.children[2].querySelector('span').textContent = ra + '%';
    }
    document.getElementById('v-rl').textContent = rl + '%';
    document.getElementById('v-rn').textContent = rn + '%';
    document.getElementById('v-ra').textContent = ra + '%';
  }
  function constrainRisk(changedId) {
    const ids = ['p-rl', 'p-rn', 'p-ra'];
    const els = ids.map(id => document.getElementById(id));
    const ci = ids.indexOf(changedId);
    const cv = +els[ci].value;
    const oi = ids.map((_, i) => i).filter(i => i !== ci);
    const others = oi.map(i => +els[i].value);
    const otherSum = others[0] + others[1];
    const remaining = 100 - cv;
    if (otherSum > 0) {
      const r0 = Math.round(others[0] / otherSum * remaining);
      els[oi[0]].value = r0;
      els[oi[1]].value = remaining - r0;
    } else {
      const half = Math.round(remaining / 2);
      els[oi[0]].value = half;
      els[oi[1]].value = remaining - half;
    }
    updateCompBar();
  }
  ['p-rl', 'p-rn', 'p-ra'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => constrainRisk(id));
  });
  updateCompBar();

  // Game controls
  document.getElementById('btn-play').addEventListener('click', () => {
    if (_floor && _floor.paused) _floor.togglePause();
    else if (_result) initGame(resultToHistory(_result));
  });
  document.getElementById('btn-pause').addEventListener('click', () => { if (_floor) _floor.togglePause(); });
  document.getElementById('btn-follow').addEventListener('click', function () {
    if (_floor) { _floor._camFollow = !_floor._camFollow; this.classList.toggle('active', _floor._camFollow); }
  });
  document.getElementById('game-speed').addEventListener('input', function () {
    document.getElementById('speed-val').textContent = (+this.value).toFixed(1) + 'x';
    if (_floor) _floor.speed = +this.value;
  });
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    if (_floor) {
      const z = Math.min(4, _floor._camZoom * 1.2);
      _floor._camZoom = z;
      if (_floor._camTarget) _floor._camTarget.zoom = z;
      document.getElementById('zoom-val').textContent = Math.round(z * 100) + '%';
    }
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    if (_floor) {
      const z = Math.max(0.3, _floor._camZoom / 1.2);
      _floor._camZoom = z;
      if (_floor._camTarget) _floor._camTarget.zoom = z;
      document.getElementById('zoom-val').textContent = Math.round(z * 100) + '%';
    }
  });

  // AI provider → sync endpoint placeholder
  const provSel = document.getElementById('ai-provider');
  const epInput = document.getElementById('ai-endpoint');
  function syncEndpoint() {
    const p = typeof PROVIDERS !== 'undefined' && PROVIDERS[provSel.value];
    epInput.placeholder = p && p.defaultEndpoint ? p.defaultEndpoint : 'Endpoint (optional)';
  }
  if (provSel) {
    provSel.addEventListener('change', syncEndpoint);
    syncEndpoint();
  }

  // Run button
  document.getElementById('btn-run').addEventListener('click', runSimExperiment);

  fullI18N();

  // Auto-run on load
  setTimeout(() => runSimExperiment(), 200);
});
