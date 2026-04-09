/**
 * App Controller — Theme, i18n, export, UI binding.
 */

let _history = null, _floor = null, _labResult = null;

/* Slide navigation */
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
  const vp = document.getElementById('slides-viewport');
  vp.classList.toggle('fullscreen');
}
function toggleReadingMode() {
  const vp = document.getElementById('slides-viewport');
  vp.classList.toggle('reading-mode');
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
   Agent numbered names: "1.Ada", "2.Ben"
   ================================================================ */
function assignDisplayNames(agents) {
  agents.forEach(a => { a.displayName = `${a.id + 1}.${a.name}`; });
}

/* ================================================================
   Read experiment parameters (unified)
   ================================================================ */
function readLabParams() {
  const v = id => { const el = document.getElementById(id); return el ? +el.value : 0; };
  const c = id => { const el = document.getElementById(id); return el ? el.checked : false; };
  const divLowEl = document.getElementById('lab-divLow');
  const divHighEl = document.getElementById('lab-divHigh');
  return {
    n: v('p-n'),
    baseValue: v('lab-baseVal'),
    valSpread: v('lab-valSpread'),
    rlPct: v('p-rl'),
    rnPct: v('p-rn'),
    cashMean: v('lab-cash'),
    sharesMean: v('lab-shares'),
    endowVar: v('lab-endowVar') / 100,
    labRounds: v('lab-rounds'),
    // Henning (2025): dividends & interest
    divLow: divLowEl ? +divLowEl.value : 0.4,
    divHigh: divHighEl ? +divHighEl.value : 1.0,
    interestRate: v('lab-interest') / 100,
    // Dufwenberg (2005): experience sessions
    experienceRounds: v('lab-expRounds'),
    // Sobel (2020): communication toggle
    commEnabled: c('lab-comm-on'),
    deceptStrength: v('lab-decept') / 100,
    credulity: v('lab-credul') / 100,
    seed: v('p-seed'),
  };
}

function runExperiment() {
  const btn = document.getElementById('btn-run');
  btn.disabled = true; btn.textContent = 'Running...';
  setTimeout(() => {
    try {
      const params = readLabParams();
      _labResult = runLabExperiment(params);
      renderLabResults(_labResult);
    } catch (e) {
      console.error('Experiment error:', e);
    } finally {
      btn.disabled = false; btn.textContent = 'Run Experiment';
    }
  }, 30);
}

function renderLabResults(lab) {
  // Show results
  document.getElementById('lab-log-card').style.display = 'block';

  // Summary cards
  const eff1 = lab.phase1.allocation.efficiency;
  const eff2 = lab.phase2.allocation.efficiency;
  document.getElementById('sc-lab-eff1').textContent = (eff1 * 100).toFixed(1) + '%';
  document.getElementById('sc-lab-eff1').style.color = eff1 > 0.5 ? 'var(--green)' : 'var(--red)';
  document.getElementById('sc-lab-eff2').textContent = (eff2 * 100).toFixed(1) + '%';
  document.getElementById('sc-lab-eff2').style.color = eff2 > 0.5 ? 'var(--green)' : 'var(--red)';

  // Bubble metrics (Henning/Dufwenberg)
  const bm = lab.phase1.bubbleMetrics;
  document.getElementById('sc-lab-r2').textContent = bm.haesselR2.toFixed(3);
  document.getElementById('sc-lab-r2').style.color = bm.haesselR2 > 0.5 ? 'var(--green)' : 'var(--red)';

  // Hypothesis classification (Henning)
  const hypEl = document.getElementById('sc-lab-hyp');
  const hypLabels = { R: 'Rational', H: 'Human', E: 'Erratic' };
  const hypColors = { R: 'var(--green)', H: 'var(--amber)', E: 'var(--red)' };
  hypEl.textContent = bm.hypothesis + ' (' + hypLabels[bm.hypothesis] + ')';
  hypEl.style.color = hypColors[bm.hypothesis];

  // Sobel deception stats
  const dec = lab.deception;
  const liesEl = document.getElementById('sc-lab-lies');
  if (lab.commEnabled && dec.totalMessages > 0) {
    liesEl.innerHTML = `${dec.totalLies}/${dec.totalMessages}<br><span style="font-size:0.7em">${dec.totalDeceptions} deceptive | ${dec.totalDamaging} damaging</span>`;
  } else {
    liesEl.textContent = 'Comm OFF';
    liesEl.style.color = 'var(--fg-2)';
  }

  // Coase theorem agent
  const top = lab.highestPsiAgent;
  document.getElementById('sc-lab-top').innerHTML =
    `${top.name}<br><span style="font-size:0.75em">&psi;=${top.psi.toFixed(0)} | ${top.sharePercent.toFixed(0)}% shares</span>`;

  // Charts
  renderAllLabCharts(lab);

  // Build game-compatible history from lab result for Trading Floor
  _history = labResultToHistory(lab);

  // Init game if game view active
  if (document.querySelector('.view-btn[data-view="game"].active')) initGame(_history);

  // Log
  renderLabLog(lab);
}

/* ================================================================
   Convert lab result to TradingFloor-compatible history
   ================================================================ */
function labResultToHistory(lab) {
  const phase = lab.phase2 || lab.phase1;
  return {
    agents: lab.initialSnapshot,
    prices: phase.prices,
    fvs: phase.fvs,
    volumes: phase.volumes,
    spreads: phase.rounds.map(r => (r.bestAsk || 0) - (r.bestBid || 0)),
    rounds: phase.rounds.map((r, i) => ({
      period: i, fv: phase.fvs[i], div: r.dividend || 0,
      trades: r.trades || [], vwap: r.vwap, volume: r.volume || 0,
      bestBid: r.bestBid, bestAsk: r.bestAsk, messages: r.messages,
    })),
    bubble: phase.bubbleMetrics,
    _raw: { agents: lab.initialSnapshot, rounds: phase.rounds, prices: phase.prices, fvs: phase.fvs, volumes: phase.volumes },
  };
}

/* ================================================================
   Export — JSON & CSV
   ================================================================ */
function exportJSON() {
  if (!_labResult) return;
  const blob = new Blob([JSON.stringify(_labResult, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'experiment_data.json'; a.click(); URL.revokeObjectURL(a.href);
}

function exportCSV() {
  if (!_labResult) return;
  const agents = _labResult.initialSnapshot;
  const header = 'id,name,riskType,gamma,psi,cash,shares,totalPnL';
  const rows = agents.map(a =>
    `${a.id},${a.displayName},${a.riskType},${a.gamma.toFixed(4)},${a.psi.toFixed(1)},${a.cash.toFixed(0)},${a.shares},${(a.totalPnL||0).toFixed(2)}`);
  const pHeader = '\nphase,round,fv,price,volume';
  const pRows = [];
  for (const [label, phase] of [['P1', _labResult.phase1], ['P2', _labResult.phase2]]) {
    phase.rounds.forEach((r, i) => {
      pRows.push(`${label},${i+1},${phase.fvs[i].toFixed(2)},${r.vwap != null ? r.vwap.toFixed(2) : ''},${r.volume || 0}`);
    });
  }
  const blob = new Blob([[header, ...rows, pHeader, ...pRows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'experiment_data.csv'; a.click(); URL.revokeObjectURL(a.href);
}

/* ================================================================
   Game
   ================================================================ */
function initGame(h) {
  if (_floor) _floor.stop();
  _floor = new TradingFloor(document.getElementById('game-canvas'), h._raw || h);
  _floor.start();
}

function renderLabLog(lab) {
  const log = document.getElementById('lab-log');
  log.innerHTML = '';

  // FV info
  const fvDiv = document.createElement('div');
  fvDiv.className = 'log-entry';
  fvDiv.style.cssText = 'font-weight:700;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:6px';
  fvDiv.innerHTML = `FV = E[div]/r = ${((lab.params.divLow+lab.params.divHigh)/2).toFixed(2)}/${lab.params.interestRate.toFixed(2)} = ${lab.fundamentalValue.toFixed(1)} | Comm: ${lab.commEnabled ? 'ON (Sobel)' : 'OFF'}`;
  log.appendChild(fvDiv);

  // Initial state
  const initDet = document.createElement('details');
  initDet.className = 'log-round'; initDet.open = true;
  const initSum = document.createElement('summary');
  initSum.textContent = `Initial State: ${lab.initialSnapshot.length} agents | Efficiency: ${(lab.initialAlloc.efficiency * 100).toFixed(1)}%`;
  initDet.appendChild(initSum);
  for (const a of lab.initialSnapshot) {
    const d = document.createElement('div'); d.className = 'log-entry';
    const rColor = a.riskType === 'risk_loving' ? 'var(--red)' : a.riskType === 'risk_neutral' ? 'var(--amber)' : 'var(--blue)';
    d.innerHTML = `<strong>${a.displayName}</strong> <span style="color:${rColor}">${a.riskType.replace('_','-')}</span> | &psi;=${a.psi.toFixed(1)} | &gamma;=${a.gamma.toFixed(4)} | cash=$${a.cash} | shares=${a.shares}`;
    initDet.appendChild(d);
  }
  log.appendChild(initDet);

  // Phase 1
  _appendPhaseLog(log, 'Phase 1 (Silent Trading)', lab.phase1, lab.initialSnapshot);

  // Phase 2
  const p2Label = lab.commEnabled ? 'Phase 2 (Sobel Communication)' : 'Phase 2 (Silent Control)';
  _appendPhaseLog(log, p2Label, lab.phase2, lab.phase1.agents);

  // Sobel deception summary (only if comm enabled)
  if (lab.commEnabled) {
    const decDet = document.createElement('details');
    decDet.className = 'log-round';
    const decSum = document.createElement('summary');
    const dec = lab.deception;
    decSum.textContent = `Sobel Summary: ${dec.totalLies} lies | ${dec.totalDeceptions} deceptions | ${dec.totalDamaging} damaging | ${dec.inflations} inflate / ${dec.deflations} deflate`;
    decDet.appendChild(decSum);

    // Sobel definitions legend
    const legend = document.createElement('div'); legend.className = 'log-entry';
    legend.style.cssText = 'font-size:0.85em;color:var(--fg-2);margin-bottom:6px';
    legend.innerHTML = '<em>Sobel (2020 JPE): Lying = false report (Def 1). Deception = inducing inferior beliefs (Def 4). Damage = welfare-reducing (Sec V).</em>';
    decDet.appendChild(legend);

    for (const rt of ['risk_loving', 'risk_neutral', 'risk_averse']) {
      const d = document.createElement('div'); d.className = 'log-entry';
      const rd = dec.byRiskType[rt];
      d.textContent = `${rt.replace('_','-')}: ${rd.lies} lies / ${rd.deceptions} deceptive / ${rd.damaging} damaging (of ${rd.total})`;
      decDet.appendChild(d);
    }
    log.appendChild(decDet);
  }

  // Bubble metrics summary
  const bmDet = document.createElement('details');
  bmDet.className = 'log-round';
  const bmSum = document.createElement('summary');
  const bm1 = lab.phase1.bubbleMetrics;
  const bm2 = lab.phase2.bubbleMetrics;
  bmSum.textContent = `Bubble Metrics: P1 ${bm1.hypothesis} (R\u00b2=${bm1.haesselR2.toFixed(2)}) | P2 ${bm2.hypothesis} (R\u00b2=${bm2.haesselR2.toFixed(2)})`;
  bmDet.appendChild(bmSum);
  for (const [label, bm] of [['Phase 1', bm1], ['Phase 2', bm2]]) {
    const d = document.createElement('div'); d.className = 'log-entry';
    d.textContent = `${label}: Haessel-R\u00b2=${bm.haesselR2.toFixed(3)} | MSE=${bm.mse.toFixed(2)} | NAPD=${bm.napd.toFixed(3)} | Amplitude=${bm.amplitude.toFixed(3)} | Turnover=${bm.turnover.toFixed(2)} | ${bm.hypothesis}`;
    bmDet.appendChild(d);
  }
  log.appendChild(bmDet);

  // Experience sessions (Dufwenberg)
  if (lab.sessionResults && lab.sessionResults.length > 0) {
    const expDet = document.createElement('details');
    expDet.className = 'log-round';
    const expSum = document.createElement('summary');
    expSum.textContent = `Experience Sessions (Dufwenberg 2005): ${lab.sessionResults.length} additional sessions`;
    expDet.appendChild(expSum);
    for (const sess of lab.sessionResults) {
      const d = document.createElement('div'); d.className = 'log-entry';
      const sbm = sess.bubbleMetrics;
      d.textContent = `Session ${sess.session} (exp=${sess.experience}): R\u00b2=${sbm.haesselR2.toFixed(3)} | NAPD=${sbm.napd.toFixed(3)} | Eff=${(sess.allocation.efficiency*100).toFixed(1)}% | ${sbm.hypothesis}`;
      expDet.appendChild(d);
    }
    log.appendChild(expDet);
  }

  // Final verdict
  const verdict = document.createElement('div');
  verdict.className = 'log-entry';
  verdict.style.cssText = 'font-weight:700;border-top:2px solid var(--accent);padding-top:8px;margin-top:8px;font-size:1.05em';
  const top = lab.highestPsiAgent;
  const coaseHolds = top.sharePercent > 100 / lab.initialSnapshot.length * 1.5;
  verdict.innerHTML = coaseHolds
    ? `Coase Theorem Supported: ${top.name} (&psi;=${top.psi.toFixed(0)}) holds ${top.sharePercent.toFixed(0)}% of all shares`
    : `Coase Theorem Challenged: ${top.name} (&psi;=${top.psi.toFixed(0)}) holds only ${top.sharePercent.toFixed(0)}% of shares`;
  verdict.style.color = coaseHolds ? 'var(--green)' : 'var(--red)';
  log.appendChild(verdict);
}

function _appendPhaseLog(container, title, phase, prevAgents) {
  const det = document.createElement('details');
  det.className = 'log-round';
  const sum = document.createElement('summary');
  const eff = phase.allocation.efficiency;
  const corr = phase.allocation.correlation;
  sum.textContent = `${title}: Efficiency=${(eff*100).toFixed(1)}% | Corr(psi,shares)=${corr.toFixed(3)} | ${phase.rounds.length} rounds`;
  det.appendChild(sum);
  for (const r of phase.rounds) {
    const d = document.createElement('div'); d.className = 'log-entry';
    const prStr = r.vwap != null ? `P=$${r.vwap.toFixed(1)}` : 'no trades';
    const liesStr = r.messages ? ` | ${r.messages.filter(m=>m.isLie).length} lies` : '';
    d.textContent = `Round ${r.round+1}: ${r.volume} trades | ${prStr}${liesStr}`;
    det.appendChild(d);
  }
  // Agent summary
  for (const a of phase.agents) {
    const prev = prevAgents.find(p => p.id === a.id);
    const shareDelta = prev ? a.shares - prev.shares : 0;
    const d = document.createElement('div'); d.className = 'log-entry';
    d.innerHTML = `<strong>${a.displayName}</strong> &psi;=${a.psi.toFixed(1)} | shares=${a.shares} (${shareDelta >= 0 ? '+' : ''}${shareDelta}) | P&L=${a.totalPnL >= 0 ? '+' : ''}${a.totalPnL.toFixed(0)}`;
    det.appendChild(d);
  }
  container.appendChild(det);
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
    if (_labResult) renderAllLabCharts(_labResult);
  });
  window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => {
    applyTheme(); if (_labResult) renderAllLabCharts(_labResult);
  });

  // Language
  document.getElementById('lang-select').addEventListener('change', function() {
    setLang(this.value); fullI18N();
    if (_labResult) renderLabResults(_labResult);
  });

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab.dataset.tab));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    const target = document.getElementById('tab-' + tab.dataset.tab);
    if (target) target.classList.add('active');
    document.getElementById('nav-menu').classList.remove('open');
    // Hide sidebar & toggle on non-experiment tabs
    const isExp = tab.dataset.tab === 'experiment';
    document.getElementById('sidebar').style.display = isExp ? '' : 'none';
    document.getElementById('sidebar-toggle').style.display = isExp ? '' : 'none';
    if (!isExp) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-backdrop').classList.remove('visible'); }
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
    if (btn) {
      btn.href = 'https://app.diagrams.net/#HMon-ius%2Ftrading%2Fmaster%2Farchitecture.svg';
    }
  })();

  // View toggle
  document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); const view = btn.dataset.view;
    document.getElementById('chart-view').style.display = view === 'chart' ? 'block' : 'none';
    document.getElementById('game-view').style.display = view === 'game' ? 'block' : 'none';
    if (view === 'game' && _history && !_floor) initGame(_history);
    if (view === 'chart' && _floor) { _floor.stop(); _floor = null; }
  }));

  // Range displays — auto-sync all sliders
  document.querySelectorAll('.sidebar input[type=range]').forEach(inp => {
    const vid = inp.id.startsWith('exp-') ? 'v-' + inp.id
      : inp.id.startsWith('lab-') ? 'v-' + inp.id
      : 'v-' + inp.id.slice(2);
    const ve = document.getElementById(vid);
    if (!ve) return;
    const upd = () => {
      if (['p-rl','p-rn','p-ra'].includes(inp.id))
        ve.textContent = inp.value + '%';
      else if (['lab-endowVar','lab-decept','lab-credul','lab-interest'].includes(inp.id))
        ve.textContent = inp.value + '%';
      else
        ve.textContent = inp.value;
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
  document.getElementById('btn-play').addEventListener('click', () => { if (_floor && _floor.paused) _floor.togglePause(); else if (_history) initGame(_history); else if (_labResult) { _history = labResultToHistory(_labResult); initGame(_history); } });
  document.getElementById('btn-pause').addEventListener('click', () => { if (_floor) _floor.togglePause(); });
  document.getElementById('btn-follow').addEventListener('click', function() { if (_floor) { _floor._camFollow = !_floor._camFollow; this.classList.toggle('active', _floor._camFollow); }});
  document.getElementById('game-speed').addEventListener('input', function() { document.getElementById('speed-val').textContent = (+this.value).toFixed(1) + 'x'; if (_floor) _floor.speed = +this.value; });
  document.getElementById('btn-zoom-in').addEventListener('click', () => { if (_floor) { _floor._camZoom = Math.min(4, _floor._camZoom * 1.2); document.getElementById('zoom-val').textContent = Math.round(_floor._camZoom * 100) + '%'; }});
  document.getElementById('btn-zoom-out').addEventListener('click', () => { if (_floor) { _floor._camZoom = Math.max(0.3, _floor._camZoom / 1.2); document.getElementById('zoom-val').textContent = Math.round(_floor._camZoom * 100) + '%'; }});

  // Run button
  document.getElementById('btn-run').addEventListener('click', runExperiment);

  fullI18N();

  // Auto-run experiment on load
  setTimeout(() => runExperiment(), 200);
});
