/**
 * App Controller — Theme, i18n, export, UI binding.
 */

let _history = null, _floor = null, _expResults = null, _currentMode = 'sim';

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
   Read parameters
   ================================================================ */
function readSimParams() {
  const v = id => { const el = document.getElementById(id); return el ? +el.value : 0; };
  const c = id => { const el = document.getElementById(id); return el ? el.checked : false; };
  return {
    n: v('p-n'), T: v('p-T'), expectedDiv: v('p-div'), alpha: v('p-alpha') / 100,
    initialCash: v('p-cash'), initialShares: v('p-shares'), expNoise: 0.05,
    inexpBias: v('p-bias') / 100, inexpNoise: v('p-noise') / 100,
    inexpAnchor: v('p-anchor') / 100, momentum: v('p-momentum') / 100,
    rlPct: v('p-rl'), rnPct: v('p-rn'),
    communication: c('p-comm-on'), clMean: v('p-cl'), cdMean: v('p-cd'), seed: v('p-seed'),
  };
}

/* ================================================================
   Run single market
   ================================================================ */
function runSingleMarket() {
  const btn = document.getElementById('btn-run');
  btn.disabled = true; btn.textContent = t('btn.running');
  setTimeout(() => {
    const params = readSimParams();
    const result = runMarket(params);
    assignDisplayNames(result.agents);
    _history = {
      prices: result.prices, fvs: result.fvs, volumes: result.volumes, spreads: result.spreads,
      rounds: result.rounds, agents: result.agents, trueValue: result.fvs[0],
      bubble: result.bubble, infoAggregation: result.bubble.haesselR2, params, _raw: result,
    };
    renderSimResults(_history);
    btn.disabled = false; btn.textContent = t('btn.run');
  }, 30);
}

function renderSimResults(h) {
  document.getElementById('summary-row').style.display = 'flex';
  document.getElementById('export-row').style.display = 'flex';
  const b = h.bubble;
  document.getElementById('sc-r2').textContent = b.haesselR2.toFixed(3);
  document.getElementById('sc-napd').textContent = b.napd.toFixed(3);
  document.getElementById('sc-amp').textContent = b.amplitude.toFixed(3);
  const exp = h.agents.filter(a => a.expType === 'experienced');
  const inexp = h.agents.filter(a => a.expType === 'inexperienced');
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(0);
  const ae = exp.length ? avg(exp.map(a => a.totalPnL)) : 0;
  const ai = inexp.length ? avg(inexp.map(a => a.totalPnL)) : 0;
  document.getElementById('sc-pnl-exp').textContent = fmt(ae);
  document.getElementById('sc-pnl-exp').style.color = ae >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('sc-pnl-inexp').textContent = fmt(ai);
  document.getElementById('sc-pnl-inexp').style.color = ai >= 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('sim-charts').style.display = 'grid';
  document.getElementById('exp-charts').style.display = 'none';
  document.getElementById('exp-table-wrap').style.display = 'none';
  renderAllCharts(h);
  renderLog(h);
  document.getElementById('log-card').style.display = 'block';
  if (document.querySelector('.view-btn[data-view="game"].active')) initGame(h);
}

/* ================================================================
   Log
   ================================================================ */
function renderLog(h) {
  const log = document.getElementById('log'); log.innerHTML = '';
  for (let r = 0; r < h.rounds.length; r++) {
    const rd = h.rounds[r];
    const det = document.createElement('details'); det.className = 'log-round';
    if (r === 0) det.open = true;
    const sum = document.createElement('summary');
    const fvStr = rd.fv != null ? ` | FV=$${rd.fv.toFixed(1)}` : '';
    const prStr = rd.vwap != null ? ` | P=$${rd.vwap.toFixed(1)}` : '';
    sum.textContent = `${t('log.period')} ${r + 1}: ${rd.volume} ${t('log.trades')}${fvStr}${prStr}`;
    det.appendChild(sum);
    for (const trade of rd.trades) {
      const d = document.createElement('div'); d.className = 'log-entry';
      const buyer = h.agents[trade.buyerId], seller = h.agents[trade.sellerId];
      d.innerHTML = `<strong>${buyer.displayName}</strong> <span class="log-tag log-tag-buy">${t('log.buy')}</span> ` +
        `${t('log.from')} <strong>${seller.displayName}</strong> <span class="log-tag log-tag-sell">${t('log.sell')}</span> @ $${trade.price.toFixed(1)}`;
      det.appendChild(d);
    }
    if (!rd.trades.length) {
      const d = document.createElement('div'); d.className = 'log-entry';
      d.textContent = t('log.noTrades'); det.appendChild(d);
    }
    log.appendChild(det);
  }
}

/* ================================================================
   Experiment
   ================================================================ */
function readExpConfig() {
  const v = id => { const el = document.getElementById(id); return el ? +el.value : 0; };
  const c = id => { const el = document.getElementById(id); return el ? el.checked : false; };
  const nValues = document.getElementById('exp-n').value.split(',').map(s => parseInt(s.trim())).filter(n => n > 1);
  const riskConfigs = [];
  if (c('exp-r1')) riskConfigs.push({ rl: 33, rn: 34 });
  if (c('exp-r2')) riskConfigs.push({ rl: 60, rn: 20 });
  if (c('exp-r3')) riskConfigs.push({ rl: 10, rn: 20 });
  if (!riskConfigs.length) riskConfigs.push({ rl: 33, rn: 34 });
  const knowledgeConfigs = [];
  if (c('exp-k1')) knowledgeConfigs.push({ bias: 0.15, noise: 0.15, anchor: 0.3, label: t('know.mild') });
  if (c('exp-k2')) knowledgeConfigs.push({ bias: 0.30, noise: 0.25, anchor: 0.4, label: t('know.moderate') });
  if (c('exp-k3')) knowledgeConfigs.push({ bias: 0.50, noise: 0.40, anchor: 0.6, label: t('know.severe') });
  if (!knowledgeConfigs.length) knowledgeConfigs.push({ bias: 0.30, noise: 0.25, anchor: 0.4, label: t('know.moderate') });
  return { nValues, riskConfigs, knowledgeConfigs, baseParams: {
    T: v('exp-T'), expectedDiv: v('exp-div'), initialCash: 1000, initialShares: 5,
    expNoise: 0.05, inexpAnchor: 0.4, momentum: 0.2, communication: false,
    alphaSteps: v('exp-steps'), replications: v('exp-reps'), bubbleThreshold: v('exp-threshold') / 100, seed: v('exp-seed'),
  }};
}

function runExperimentUI() {
  const btn = document.getElementById('btn-experiment');
  const progress = document.getElementById('exp-progress');
  const fill = document.getElementById('exp-fill');
  const pct = document.getElementById('exp-pct');
  btn.disabled = true; progress.style.display = 'flex';
  const config = readExpConfig();
  _expResults = [];
  const queue = [];
  for (const n of config.nValues) for (const risk of config.riskConfigs) for (const know of config.knowledgeConfigs) queue.push({ n, risk, know });
  let done = 0;
  function processNext() {
    if (done >= queue.length) { renderExpResults(_expResults); btn.disabled = false; progress.style.display = 'none'; return; }
    const { n, risk, know } = queue[done];
    const params = { ...config.baseParams, n, rlPct: risk.rl, rnPct: risk.rn, inexpBias: know.bias, inexpNoise: know.noise, inexpAnchor: know.anchor };
    const sweep = runAlphaSweep(params);
    _expResults.push({ n, risk, knowledge: know, alphaStar: sweep.alphaStar, sweep: sweep.results, threshold: sweep.threshold });
    done++;
    fill.style.width = (done / queue.length * 100) + '%';
    pct.textContent = Math.round(done / queue.length * 100) + '%';
    setTimeout(processNext, 5);
  }
  setTimeout(processNext, 30);
}

function renderExpResults(results) {
  document.getElementById('summary-row').style.display = 'none';
  document.getElementById('export-row').style.display = 'flex';
  document.getElementById('sim-charts').style.display = 'none';
  document.getElementById('exp-charts').style.display = 'grid';
  document.getElementById('exp-table-wrap').style.display = 'block';
  document.getElementById('log-card').style.display = 'none';
  const first = results[0];
  renderAlphaSweep('chart-alpha-sweep', first.sweep, first.alphaStar, first.threshold);
  renderAlphaVsN('chart-alpha-n', results);
  renderAlphaHeatmap('chart-alpha-heatmap', results, results[0].n);
  renderAlphaVsRisk('chart-alpha-risk', results, results[0].n);
  const tbody = document.querySelector('#exp-table tbody'); tbody.innerHTML = '';
  for (const r of results) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.n}</td><td>RL${r.risk.rl}/RN${r.risk.rn}/RA${100-r.risk.rl-r.risk.rn}</td>` +
      `<td>${r.knowledge.label || `bias=${r.knowledge.bias}`}</td>` +
      `<td style="font-weight:700;color:${r.alphaStar < 0.5 ? 'var(--green)' : 'var(--red)'}">${(r.alphaStar * 100).toFixed(0)}%</td>`;
    tbody.appendChild(tr);
  }
}

/* ================================================================
   Export — JSON & CSV
   ================================================================ */
function exportJSON() {
  const data = _expResults ? { type: 'experiment', results: _expResults }
    : _history ? { type: 'simulation', agents: _history.agents.map(a => ({
        id: a.id, displayName: a.displayName, name: a.name, expType: a.expType, riskType: a.riskType,
        riskAversion: a.riskAversion, totalPnL: a.totalPnL, finalWealth: a.finalWealth,
        cash: a.cash, shares: a.shares, trades: a.trades.length, dividendsReceived: a.dividendsReceived,
      })), prices: _history.prices, fvs: _history.fvs, volumes: _history.volumes,
        bubble: _history.bubble, params: _history.params,
        rounds: _history.rounds.map(r => ({ period: r.period, fv: r.fv, div: r.div, vwap: r.vwap, volume: r.volume })),
    } : null;
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = data.type === 'experiment' ? 'experiment_alpha.json' : 'market_data.json';
  a.click(); URL.revokeObjectURL(a.href);
}

function exportCSV() {
  if (_expResults) {
    const header = 'n,riskRL,riskRN,riskRA,knowledgeBias,knowledgeNoise,alphaStar';
    const rows = _expResults.map(r => `${r.n},${r.risk.rl},${r.risk.rn},${100-r.risk.rl-r.risk.rn},${r.knowledge.bias},${r.knowledge.noise},${r.alphaStar.toFixed(4)}`);
    download('experiment_alpha.csv', [header, ...rows].join('\n'));
  } else if (_history) {
    const header = 'id,displayName,expType,riskType,riskAversion,totalPnL,finalWealth,trades,dividends';
    const rows = _history.agents.map(a =>
      `${a.id},${a.displayName},${a.expType},${a.riskType},${a.riskAversion.toFixed(4)},${a.totalPnL.toFixed(2)},${(a.finalWealth||0).toFixed(2)},${a.trades.length},${(a.dividendsReceived||0).toFixed(2)}`);
    const pHeader = '\nperiod,fv,price,volume,dividend';
    const pRows = _history.rounds.map(r => `${r.period},${r.fv.toFixed(2)},${r.vwap != null ? r.vwap.toFixed(2) : ''},${r.volume},${r.div.toFixed(2)}`);
    download('market_data.csv', [header, ...rows, pHeader, ...pRows].join('\n'));
  }
}
function download(name, content) {
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

/* ================================================================
   Game
   ================================================================ */
function initGame(h) {
  if (_floor) _floor.stop();
  _floor = new TradingFloor(document.getElementById('game-canvas'), h._raw || h);
  _floor.start();
}
window._gameLog = function(type, title, detail) {
  const log = document.getElementById('log'); if (!log) return;
  const d = document.createElement('div'); d.className = 'log-entry';
  if (type === 'phase') { d.style.cssText = 'font-weight:700;border-top:2px solid var(--accent);padding-top:4px;margin-top:4px';
    d.innerHTML = `<strong>${title}</strong> <span style="font-weight:400;color:var(--fg-2)">${detail||''}</span>`; }
  else if (type === 'summary') { d.style.fontWeight = '700'; d.innerHTML = `<strong>${title}</strong>: ${detail}`; }
  else { d.innerHTML = title; }
  log.appendChild(d); log.scrollTop = log.scrollHeight;
};

/* ================================================================
   i18n update
   ================================================================ */
function fullI18N() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
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
    if (_history) renderAllCharts(_history);
  });
  window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => {
    applyTheme(); if (_history) renderAllCharts(_history);
  });

  // Language
  document.getElementById('lang-select').addEventListener('change', function() {
    setLang(this.value); fullI18N();
    if (_history) { renderAllCharts(_history); renderLog(_history); }
  });

  // Hamburger
  const hamburger = document.getElementById('nav-hamburger');
  const navMenu = document.getElementById('nav-menu');
  hamburger.addEventListener('click', e => { e.stopPropagation(); navMenu.classList.toggle('open'); });
  document.addEventListener('click', e => { if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) navMenu.classList.remove('open'); });

  // Sidebar
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  document.getElementById('sidebar-toggle').addEventListener('click', () => { sidebar.classList.toggle('open'); backdrop.classList.toggle('visible'); });
  backdrop.addEventListener('click', () => { sidebar.classList.remove('open'); backdrop.classList.remove('visible'); });

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active'); _currentMode = tab.dataset.mode;
    document.getElementById('sim-params').style.display = _currentMode === 'sim' ? 'block' : 'none';
    document.getElementById('exp-params').style.display = _currentMode === 'exp' ? 'block' : 'none';
  }));

  // View toggle
  document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); const view = btn.dataset.view;
    document.getElementById('chart-view').style.display = view === 'chart' ? 'block' : 'none';
    document.getElementById('game-view').style.display = view === 'game' ? 'block' : 'none';
    if (view === 'game' && _history && !_floor) initGame(_history);
    if (view === 'chart' && _floor) { _floor.stop(); _floor = null; }
  }));

  // Range displays
  [['p-alpha','v-alpha','%'],['p-bias','v-bias','%'],['p-noise','v-noise','%'],
   ['p-anchor','v-anchor','%'],['p-momentum','v-momentum','%'],['p-cl','v-cl',''],['p-cd','v-cd',''],
   ['exp-threshold','v-threshold','']].forEach(([iid, vid, suf]) => {
    const inp = document.getElementById(iid), val = document.getElementById(vid);
    if (inp && val) inp.addEventListener('input', () => { val.textContent = (iid === 'exp-threshold' ? (+inp.value / 100).toFixed(2) : inp.value) + suf; });
  });

  // Tri-sliders
  const sliders = document.querySelectorAll('.tri-slider[data-group="risk"]');
  sliders.forEach(s => s.addEventListener('input', () => {
    const vals = Array.from(sliders).map(el => +el.value);
    if (vals.reduce((a, b) => a + b, 0) > 100) {
      const other = Array.from(sliders).find(el => el !== s);
      other.value = Math.max(0, +other.value - (vals.reduce((a, b) => a + b, 0) - 100));
    }
    sliders.forEach(el => { document.getElementById('v-' + el.id.replace('p-', '')).textContent = el.value + '%'; });
    document.getElementById('v-ra').textContent = Math.max(0, 100 - Array.from(sliders).reduce((a, el) => a + (+el.value), 0)) + '%';
  }));

  // Game controls
  document.getElementById('btn-play').addEventListener('click', () => { if (_floor && _floor.paused) _floor.togglePause(); else if (_history) initGame(_history); });
  document.getElementById('btn-pause').addEventListener('click', () => { if (_floor) _floor.togglePause(); });
  document.getElementById('btn-follow').addEventListener('click', function() { if (_floor) { _floor._camFollow = !_floor._camFollow; this.classList.toggle('active', _floor._camFollow); }});
  document.getElementById('game-speed').addEventListener('input', function() { document.getElementById('speed-val').textContent = (+this.value).toFixed(1) + 'x'; if (_floor) _floor.speed = +this.value; });
  document.getElementById('btn-zoom-in').addEventListener('click', () => { if (_floor) { _floor._camZoom = Math.min(4, _floor._camZoom * 1.2); document.getElementById('zoom-val').textContent = Math.round(_floor._camZoom * 100) + '%'; }});
  document.getElementById('btn-zoom-out').addEventListener('click', () => { if (_floor) { _floor._camZoom = Math.max(0.3, _floor._camZoom / 1.2); document.getElementById('zoom-val').textContent = Math.round(_floor._camZoom * 100) + '%'; }});

  // Run buttons
  document.getElementById('btn-run').addEventListener('click', runSingleMarket);
  document.getElementById('btn-experiment').addEventListener('click', runExperimentUI);

  fullI18N();
});
