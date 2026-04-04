/**
 * App Controller — Binds UI to engine, charts, and game.
 * Supports two modes: single market simulation and alpha* experiment.
 */

let _history = null;
let _floor = null;
let _expResults = null;
let _currentMode = 'sim'; // 'sim' or 'exp'

/* ---- Read single-market params ---- */
function readSimParams() {
  const v = id => { const el = document.getElementById(id); return el ? +el.value : 0; };
  const c = id => { const el = document.getElementById(id); return el ? el.checked : false; };
  return {
    n:            v('p-n'),
    T:            v('p-T'),
    expectedDiv:  v('p-div'),
    alpha:        v('p-alpha') / 100,
    initialCash:  v('p-cash'),
    initialShares:v('p-shares'),
    expNoise:     0.05,
    inexpBias:    v('p-bias') / 100,
    inexpNoise:   v('p-noise') / 100,
    inexpAnchor:  v('p-anchor') / 100,
    momentum:     v('p-momentum') / 100,
    rlPct:        v('p-rl'),
    rnPct:        v('p-rn'),
    communication:c('p-comm'),
    clMean:       v('p-cl'),
    cdMean:       v('p-cd'),
    seed:         v('p-seed'),
  };
}

/* ---- Run single market ---- */
function runSingleMarket() {
  const btn = document.getElementById('btn-run');
  btn.disabled = true;
  btn.textContent = 'Running...';

  setTimeout(() => {
    const params = readSimParams();
    const result = runMarket(params);

    // Map to chart-compatible format
    _history = {
      prices: result.prices,
      fvs: result.fvs,
      volumes: result.volumes,
      spreads: result.spreads,
      rounds: result.rounds,
      agents: result.agents,
      trueValue: result.fvs[0],
      bubble: result.bubble,
      infoAggregation: result.bubble.haesselR2,
      params,
      _raw: result,
    };

    renderSimResults(_history);
    btn.disabled = false;
    btn.textContent = 'Run Market';
  }, 30);
}

/* ---- Render single-market results ---- */
function renderSimResults(history) {
  const sr = document.getElementById('summary-row');
  sr.style.display = 'flex';
  const b = history.bubble;
  document.getElementById('sc-r2').textContent = b.haesselR2.toFixed(3);
  document.getElementById('sc-napd').textContent = b.napd.toFixed(3);
  document.getElementById('sc-amp').textContent = b.amplitude.toFixed(3);

  const exp = history.agents.filter(a => a.expType === 'experienced');
  const inexp = history.agents.filter(a => a.expType === 'inexperienced');
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(0);
  const avgExp = exp.length ? avg(exp.map(a => a.totalPnL)) : 0;
  const avgInexp = inexp.length ? avg(inexp.map(a => a.totalPnL)) : 0;
  document.getElementById('sc-pnl-exp').textContent = fmt(avgExp);
  document.getElementById('sc-pnl-exp').style.color = avgExp >= 0 ? '#34C759' : '#FF3B30';
  document.getElementById('sc-pnl-inexp').textContent = fmt(avgInexp);
  document.getElementById('sc-pnl-inexp').style.color = avgInexp >= 0 ? '#34C759' : '#FF3B30';

  document.getElementById('sim-charts').style.display = 'grid';
  document.getElementById('exp-charts').style.display = 'none';
  document.getElementById('exp-table-wrap').style.display = 'none';

  renderAllCharts(history);
  renderLog(history);
  document.getElementById('log-card').style.display = 'block';

  if (document.querySelector('.view-btn[data-view="game"].active')) initGame(history);
}

/* ---- Log rendering ---- */
function renderLog(history) {
  const log = document.getElementById('log');
  log.innerHTML = '';
  for (let r = 0; r < history.rounds.length; r++) {
    const rd = history.rounds[r];
    const det = document.createElement('details');
    det.className = 'log-round';
    if (r === 0) det.open = true;
    const sum = document.createElement('summary');
    const fvStr = rd.fv != null ? ` | FV=$${rd.fv.toFixed(1)}` : '';
    const prStr = rd.vwap != null ? ` | P=$${rd.vwap.toFixed(1)}` : '';
    sum.textContent = `Period ${r + 1}: ${rd.volume} trades${fvStr}${prStr}`;
    det.appendChild(sum);
    if (rd.messages && rd.messages.length > 0) {
      const d = document.createElement('div'); d.className = 'log-entry';
      d.innerHTML = `<strong>Comm:</strong> ${rd.messages.length} msgs, ${rd.messages.filter(m=>m.isLie).length} lies`;
      det.appendChild(d);
    }
    for (const trade of rd.trades) {
      const d = document.createElement('div'); d.className = 'log-entry';
      const buyer = history.agents[trade.buyerId];
      const seller = history.agents[trade.sellerId];
      d.innerHTML = `<strong>${buyer.name}</strong> <span class="log-tag log-tag-buy">BUY</span> `+
        `from <strong>${seller.name}</strong> <span class="log-tag log-tag-sell">SELL</span> `+
        `@ $${trade.price.toFixed(1)}`;
      det.appendChild(d);
    }
    if (!rd.trades.length) {
      const d = document.createElement('div'); d.className = 'log-entry';
      d.textContent = 'No trades'; det.appendChild(d);
    }
    log.appendChild(det);
  }
  // Summary
  const sd = document.createElement('div'); sd.className = 'log-entry';
  sd.style.cssText = 'font-weight:700;border-top:2px solid #007AFF;padding-top:6px;margin-top:4px';
  const b = history.bubble;
  sd.innerHTML = `Summary: Haessel-R\u00b2=${b.haesselR2.toFixed(3)} | NAPD=${b.napd.toFixed(3)} | Amp=${b.amplitude.toFixed(3)}`;
  log.appendChild(sd);
}

/* ================================================================
   Experiment mode
   ================================================================ */

function readExpConfig() {
  const v = id => { const el = document.getElementById(id); return el ? +el.value : 0; };
  const c = id => { const el = document.getElementById(id); return el ? el.checked : false; };

  const nValues = document.getElementById('exp-n').value.split(',').map(s => parseInt(s.trim())).filter(n => n > 1);

  const riskConfigs = [];
  if (c('exp-r1')) riskConfigs.push({ rl: 33, rn: 34, label: 'Balanced' });
  if (c('exp-r2')) riskConfigs.push({ rl: 60, rn: 20, label: 'Risk-Loving' });
  if (c('exp-r3')) riskConfigs.push({ rl: 10, rn: 20, label: 'Risk-Averse' });
  if (!riskConfigs.length) riskConfigs.push({ rl: 33, rn: 34, label: 'Balanced' });

  const knowledgeConfigs = [];
  if (c('exp-k1')) knowledgeConfigs.push({ bias: 0.15, noise: 0.15, anchor: 0.3, label: 'Mild' });
  if (c('exp-k2')) knowledgeConfigs.push({ bias: 0.30, noise: 0.25, anchor: 0.4, label: 'Moderate' });
  if (c('exp-k3')) knowledgeConfigs.push({ bias: 0.50, noise: 0.40, anchor: 0.6, label: 'Severe' });
  if (!knowledgeConfigs.length) knowledgeConfigs.push({ bias: 0.30, noise: 0.25, anchor: 0.4, label: 'Moderate' });

  return {
    nValues,
    riskConfigs,
    knowledgeConfigs,
    baseParams: {
      T: v('exp-T'),
      expectedDiv: v('exp-div'),
      initialCash: 1000,
      initialShares: 5,
      expNoise: 0.05,
      inexpAnchor: 0.4,
      momentum: 0.2,
      communication: false,
      alphaSteps: v('exp-steps'),
      replications: v('exp-reps'),
      bubbleThreshold: v('exp-threshold') / 100,
      seed: v('exp-seed'),
    },
  };
}

function runExperimentUI() {
  const btn = document.getElementById('btn-experiment');
  const progress = document.getElementById('exp-progress');
  const fill = document.getElementById('exp-fill');
  const pct = document.getElementById('exp-pct');

  btn.disabled = true;
  progress.style.display = 'flex';

  const config = readExpConfig();
  const total = config.nValues.length * config.riskConfigs.length * config.knowledgeConfigs.length;
  let done = 0;

  // Run async with progress updates
  _expResults = [];
  const queue = [];
  for (const n of config.nValues) {
    for (const risk of config.riskConfigs) {
      for (const know of config.knowledgeConfigs) {
        queue.push({ n, risk, know });
      }
    }
  }

  function processNext() {
    if (done >= queue.length) {
      renderExpResults(_expResults);
      btn.disabled = false;
      progress.style.display = 'none';
      return;
    }
    const { n, risk, know } = queue[done];
    const params = {
      ...config.baseParams,
      n,
      rlPct: risk.rl, rnPct: risk.rn,
      inexpBias: know.bias, inexpNoise: know.noise,
      inexpAnchor: know.anchor != null ? know.anchor : config.baseParams.inexpAnchor,
    };
    const sweep = runAlphaSweep(params);
    _expResults.push({
      n, risk, knowledge: know,
      alphaStar: sweep.alphaStar,
      sweep: sweep.results,
      threshold: sweep.threshold,
    });
    done++;
    const p = done / queue.length;
    fill.style.width = (p * 100) + '%';
    pct.textContent = Math.round(p * 100) + '%';
    setTimeout(processNext, 5);
  }

  setTimeout(processNext, 30);
}

/* ---- Render experiment results ---- */
function renderExpResults(results) {
  document.getElementById('summary-row').style.display = 'none';
  document.getElementById('sim-charts').style.display = 'none';
  document.getElementById('exp-charts').style.display = 'grid';
  document.getElementById('exp-table-wrap').style.display = 'block';
  document.getElementById('log-card').style.display = 'none';

  // Show first alpha sweep in detail
  const first = results[0];
  renderAlphaSweep('chart-alpha-sweep', first.sweep, first.alphaStar, first.threshold);

  // Alpha* vs N
  renderAlphaVsN('chart-alpha-n', results);

  // Heatmap for first n value
  const firstN = results[0].n;
  renderAlphaHeatmap('chart-alpha-heatmap', results, firstN);

  // Alpha* vs risk
  renderAlphaVsRisk('chart-alpha-risk', results, firstN);

  // Results table
  const tbody = document.querySelector('#exp-table tbody');
  tbody.innerHTML = '';
  for (const r of results) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.n}</td>` +
      `<td>RL${r.risk.rl}/RN${r.risk.rn}/RA${100-r.risk.rl-r.risk.rn}</td>` +
      `<td>${r.knowledge.label || `bias=${r.knowledge.bias}`}</td>` +
      `<td style="font-weight:700;color:${r.alphaStar < 0.5 ? '#34C759' : '#FF3B30'}">${(r.alphaStar * 100).toFixed(0)}%</td>`;
    tbody.appendChild(tr);
  }
}

/* ---- Game init ---- */
function initGame(history) {
  if (_floor) _floor.stop();
  const canvas = document.getElementById('game-canvas');
  _floor = new TradingFloor(canvas, history._raw || history);
  _floor.start();
}

window._gameLog = function(type, title, detail) {
  const log = document.getElementById('log');
  if (!log) return;
  const d = document.createElement('div'); d.className = 'log-entry';
  if (type === 'phase') {
    d.style.cssText = 'font-weight:700;border-top:2px solid #007AFF;padding-top:4px;margin-top:4px';
    d.innerHTML = `<strong>${title}</strong> <span style="font-weight:400;color:#6e6e73">${detail||''}</span>`;
  } else if (type === 'summary') {
    d.style.fontWeight = '700';
    d.innerHTML = `<strong>${title}</strong>: ${detail}`;
  } else { d.innerHTML = title; }
  log.appendChild(d); log.scrollTop = log.scrollHeight;
};

/* ---- UI Setup ---- */
function setupRanges() {
  [['p-alpha','v-alpha','%'],['p-bias','v-bias','%'],['p-noise','v-noise','%'],
   ['p-anchor','v-anchor','%'],['p-momentum','v-momentum','%'],
   ['p-cl','v-cl',''],['p-cd','v-cd',''],['exp-threshold','v-threshold','']].forEach(([iid, vid, suffix]) => {
    const inp = document.getElementById(iid), val = document.getElementById(vid);
    if (!inp || !val) return;
    inp.addEventListener('input', () => {
      val.textContent = (iid === 'exp-threshold' ? (+inp.value / 100).toFixed(2) : inp.value) + suffix;
    });
  });
}

function setupTriSliders() {
  const sliders = document.querySelectorAll('.tri-slider[data-group="risk"]');
  sliders.forEach(s => {
    s.addEventListener('input', () => {
      const vals = Array.from(sliders).map(el => +el.value);
      const total = vals.reduce((a,b) => a+b, 0);
      if (total > 100) {
        const other = Array.from(sliders).find(el => el !== s);
        other.value = Math.max(0, +other.value - (total - 100));
      }
      sliders.forEach(el => {
        const vid = 'v-' + el.id.replace('p-','');
        document.getElementById(vid).textContent = el.value + '%';
      });
      document.getElementById('v-ra').textContent =
        Math.max(0, 100 - Array.from(sliders).reduce((a,el) => a + (+el.value), 0)) + '%';
    });
  });
}

function setupModeTabs() {
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _currentMode = tab.dataset.mode;
      document.getElementById('sim-params').style.display = _currentMode === 'sim' ? 'block' : 'none';
      document.getElementById('exp-params').style.display = _currentMode === 'exp' ? 'block' : 'none';
    });
  });
}

function setupViewToggle() {
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.getElementById('chart-view').style.display = view === 'chart' ? 'block' : 'none';
      document.getElementById('game-view').style.display = view === 'game' ? 'block' : 'none';
      if (view === 'game' && _history && !_floor) initGame(_history);
      if (view === 'chart' && _floor) { _floor.stop(); _floor = null; }
    });
  });
}

function setupGameControls() {
  document.getElementById('btn-play').addEventListener('click', () => {
    if (_floor && _floor.paused) _floor.togglePause();
    else if (_history && !_floor) initGame(_history);
  });
  document.getElementById('btn-pause').addEventListener('click', () => { if (_floor) _floor.togglePause(); });
  document.getElementById('btn-follow').addEventListener('click', function() {
    if (!_floor) return;
    _floor._camFollow = !_floor._camFollow;
    this.classList.toggle('active', _floor._camFollow);
  });
  document.getElementById('game-speed').addEventListener('input', function() {
    document.getElementById('speed-val').textContent = (+this.value).toFixed(1) + 'x';
    if (_floor) _floor.speed = +this.value;
  });
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    if (!_floor) return;
    _floor._camZoom = Math.min(4, _floor._camZoom * 1.2);
    document.getElementById('zoom-val').textContent = Math.round(_floor._camZoom * 100) + '%';
  });
  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    if (!_floor) return;
    _floor._camZoom = Math.max(0.3, _floor._camZoom / 1.2);
    document.getElementById('zoom-val').textContent = Math.round(_floor._camZoom * 100) + '%';
  });
}

function setupLangSwitch() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setLang(btn.dataset.lang);
      document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupRanges();
  setupTriSliders();
  setupModeTabs();
  setupViewToggle();
  setupGameControls();
  setupLangSwitch();
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
  document.getElementById('btn-run').addEventListener('click', runSingleMarket);
  document.getElementById('btn-experiment').addEventListener('click', runExperimentUI);
});
