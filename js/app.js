/**
 * App Controller — Theme, i18n, export, UI binding.
 */

let _history = null, _floor = null, _expResults = null;

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
    try {
      const params = readSimParams();
      const result = runMarket(params);
      assignDisplayNames(result.agents);
      _history = {
        prices: result.prices, fvs: result.fvs, volumes: result.volumes, spreads: result.spreads,
        rounds: result.rounds, agents: result.agents, trueValue: result.fvs[0],
        bubble: result.bubble, infoAggregation: result.bubble.haesselR2, params, _raw: result,
      };
      renderSimResults(_history);
    } catch (e) {
      console.error('Simulation error:', e);
    } finally {
      btn.disabled = false; btn.textContent = t('btn.run');
    }
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
    T: v('p-T'), expectedDiv: v('p-div'), initialCash: v('p-cash'), initialShares: v('p-shares'),
    expNoise: 0.05, inexpAnchor: v('p-anchor') / 100, momentum: v('p-momentum') / 100, communication: false,
    alphaSteps: v('exp-steps'), replications: v('exp-reps'), bubbleThreshold: v('exp-threshold') / 100, seed: v('p-seed'),
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
   AI Agent mode
   ================================================================ */
function switchMode(mode) {
  document.querySelectorAll('.paradigm-btn').forEach(b => b.classList.toggle('active', b.dataset.v === mode));
  const aiPanel = document.getElementById('p-ai');
  const mathPanels = document.querySelectorAll('.math-only');
  const btnRunAI = document.getElementById('btn-run-ai');
  const aiProgress = document.getElementById('ai-progress');
  if (mode === 'ai') {
    aiPanel.style.display = '';
    aiPanel.classList.remove('collapsed');
    mathPanels.forEach(p => p.style.display = 'none');
    btnRunAI.style.display = '';
    aiProgress.style.display = '';
    document.body.classList.add('mode-ai');
    if (typeof initGroupModels === 'function') initGroupModels();
  } else {
    aiPanel.style.display = 'none';
    mathPanels.forEach(p => p.style.display = '');
    btnRunAI.style.display = 'none';
    aiProgress.style.display = 'none';
    document.body.classList.remove('mode-ai');
  }
}

async function runAIMarket() {
  if (typeof runAITradingExperiment !== 'function') return;
  const btn = document.getElementById('btn-run-ai');
  const progress = document.getElementById('ai-progress');
  btn.disabled = true;
  progress.textContent = 'Initializing...';
  try {
    const result = await runAITradingExperiment((step, total, msg) => {
      progress.textContent = `[${step}/${total}] ${msg}`;
    });
    assignDisplayNames(result.agents);
    _history = {
      prices: result.prices, fvs: result.fvs, volumes: result.volumes, spreads: result.spreads,
      rounds: result.rounds, agents: result.agents, trueValue: result.fvs[0],
      bubble: result.bubble, infoAggregation: result.bubble.haesselR2,
      params: result.params, _raw: result, aiLog: result.aiLog,
    };
    renderSimResults(_history);
    if (result.aiLog) renderAILog(result.aiLog, result.agents);
    progress.textContent = 'Done.';
  } catch (e) {
    progress.textContent = 'Error: ' + e.message;
    console.error('AI experiment error:', e);
  } finally {
    btn.disabled = false;
  }
}

function renderAILog(aiLog, agents) {
  const log = document.getElementById('log');
  if (!aiLog || !aiLog.length) return;
  for (const e of aiLog) {
    const d = document.createElement('div');
    d.className = 'log-entry';
    if (e.type === 'orchestrator') {
      d.innerHTML = `<strong>ORCH</strong> Period ${e.period} — ${e.status}${e.error ? ': ' + e.error : ''}`;
    } else if (e.type === 'agent') {
      const a = agents[e.id];
      const name = a ? a.displayName : `Agent ${e.id}`;
      const tag = e.error ? '<span class="log-tag log-tag-sell">FALLBACK</span>' : '<span class="log-tag log-tag-buy">AI</span>';
      d.innerHTML = `${name} ${tag} <strong>${e.provider}/${e.model}</strong> belief=$${(e.belief || 0).toFixed(1)}`;
    }
    log.appendChild(d);
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

  // Nav tabs (Experiment / Architecture / Glossary) — syncs desktop + mobile sets
  document.querySelectorAll('.nav-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab.dataset.tab));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    const target = document.getElementById('tab-' + tab.dataset.tab);
    if (target) target.classList.add('active');
    document.getElementById('nav-menu').classList.remove('open');
  }));

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

  // Draw.io link
  (function setupDrawio() {
    const btn = document.getElementById('btn-drawio');
    if (btn) {
      const base = window.location.href.replace(/\/[^/]*$/, '/');
      btn.href = 'https://app.diagrams.net/#U' + encodeURIComponent(base + 'architecture.drawio');
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
    const vid = inp.id.startsWith('exp-') ? 'v-' + inp.id : 'v-' + inp.id.slice(2);
    const ve = document.getElementById(vid);
    if (!ve) return;
    const upd = () => {
      if (['p-alpha','p-bias','p-noise','p-anchor','p-momentum','p-rl','p-rn','p-ra'].includes(inp.id))
        ve.textContent = inp.value + '%';
      else if (inp.id === 'exp-threshold')
        ve.textContent = (+inp.value / 100).toFixed(2);
      else if (['p-cl','p-cd'].includes(inp.id))
        ve.textContent = parseFloat(inp.value).toFixed(1);
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

  // Auto-run simulation on load
  setTimeout(() => runSingleMarket(), 200);
});
