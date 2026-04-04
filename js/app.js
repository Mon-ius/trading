/**
 * App Controller — Binds UI to engine, charts, and game.
 */

let _history = null;
let _floor = null;

/* ---- Read parameters from sidebar ---- */
function readParams() {
  const v = id => {
    const el = document.getElementById(id);
    return el ? (el.type === 'checkbox' ? el.checked : +el.value) : 0;
  };
  const informed = v('p-informed');
  const partial = v('p-partial');
  return {
    n:            v('p-n'),
    trueValue:    v('p-true-value'),
    rounds:       v('p-rounds'),
    seed:         v('p-seed'),
    informedPct:  informed,
    partialPct:   partial,
    uninformedPct: Math.max(0, 100 - informed - partial),
    rlPct:        v('p-rl'),
    rnPct:        v('p-rn'),
    raPct:        Math.max(0, 100 - v('p-rl') - v('p-rn')),
    communication: v('p-comm'),
    clMean:       v('p-cl'),
    cdMean:       v('p-cd'),
    optimismBias: v('p-bias'),
    momentum:     v('p-momentum'),
    priceInfoWeight: 0.0005,
  };
}

/* ---- Run simulation ---- */
function runSim() {
  const btn = document.getElementById('btn-run');
  btn.disabled = true;
  btn.textContent = t('btn.running');

  setTimeout(() => {
    const params = readParams();
    _history = runSimulation(params);
    renderResults(_history);
    btn.disabled = false;
    btn.textContent = t('btn.run');
  }, 30);
}

/* ---- Render results ---- */
function renderResults(history) {
  // Summary cards
  const sr = document.getElementById('summary-row');
  sr.style.display = 'flex';
  document.getElementById('sc-efficiency').textContent =
    (history.infoAggregation * 100).toFixed(1) + '%';
  document.getElementById('sc-bubble').textContent =
    (history.bubble.maxBubble * 100).toFixed(1) + '%';
  const totalTrades = history.rounds.reduce((s, r) => s + r.volume, 0);
  document.getElementById('sc-trades').textContent = totalTrades;

  const infAgents = history.agents.filter(a => a.infoType === 'informed');
  const uniAgents = history.agents.filter(a => a.infoType === 'uninformed');
  const avgInf = infAgents.length ? infAgents.reduce((s, a) => s + a.totalPnL, 0) / infAgents.length : 0;
  const avgUni = uniAgents.length ? uniAgents.reduce((s, a) => s + a.totalPnL, 0) / uniAgents.length : 0;
  const fmt = v => (v >= 0 ? '+' : '') + v.toFixed(1);
  document.getElementById('sc-pnl-inf').textContent = fmt(avgInf);
  document.getElementById('sc-pnl-inf').style.color = avgInf >= 0 ? '#34C759' : '#FF3B30';
  document.getElementById('sc-pnl-uni').textContent = fmt(avgUni);
  document.getElementById('sc-pnl-uni').style.color = avgUni >= 0 ? '#34C759' : '#FF3B30';

  // Charts
  renderAllCharts(history);

  // Log
  renderLog(history);

  // Show log card
  document.getElementById('log-card').style.display = 'block';

  // If game view is active, init game
  if (document.querySelector('.view-btn[data-view="game"].active')) {
    initGame(history);
  }
}

/* ---- Log rendering ---- */
function renderLog(history) {
  const log = document.getElementById('log');
  log.innerHTML = '';

  for (let r = 0; r < history.rounds.length; r++) {
    const rd = history.rounds[r];
    const details = document.createElement('details');
    details.className = 'log-round';
    if (r === 0) details.open = true;

    const summary = document.createElement('summary');
    const priceStr = rd.vwap != null ? ` | $${rd.vwap.toFixed(2)}` : '';
    summary.textContent = `${t('log.round')} ${r + 1}: ${rd.volume} trades${priceStr}`;
    details.appendChild(summary);

    // Communication messages
    if (rd.messages && rd.messages.length > 0) {
      const commDiv = document.createElement('div');
      commDiv.className = 'log-entry';
      const lies = rd.messages.filter(m => m.isLie).length;
      commDiv.innerHTML = `<strong>${t('log.comm')}:</strong> ${rd.messages.length} messages, ${lies} lies`;
      details.appendChild(commDiv);
    }

    // Trades
    for (const trade of rd.trades) {
      const div = document.createElement('div');
      div.className = 'log-entry';
      const buyer = history.agents[trade.buyerId];
      const seller = history.agents[trade.sellerId];
      div.innerHTML = `<strong>${buyer.name}</strong> <span class="log-tag log-tag-buy">BUY</span> ` +
        `from <strong>${seller.name}</strong> <span class="log-tag log-tag-sell">SELL</span> ` +
        `@ $${trade.price.toFixed(2)}`;
      details.appendChild(div);
    }

    if (rd.trades.length === 0) {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.textContent = t('log.noTrades');
      details.appendChild(div);
    }

    log.appendChild(details);
  }

  // Summary entry
  const sumDiv = document.createElement('div');
  sumDiv.className = 'log-entry';
  sumDiv.style.fontWeight = '700';
  sumDiv.style.borderTop = '2px solid #007AFF';
  sumDiv.style.paddingTop = '6px';
  sumDiv.style.marginTop = '4px';
  const totalTrades = history.rounds.reduce((s, r) => s + r.volume, 0);
  sumDiv.innerHTML = `${t('log.summary')}: ${t('log.efficiency')} ${(history.infoAggregation * 100).toFixed(1)}% | ` +
    `${t('log.bubble')} ${(history.bubble.maxBubble * 100).toFixed(1)}% | ` +
    `${t('log.totalTrades')} ${totalTrades}`;
  log.appendChild(sumDiv);
}

/* ---- Game init ---- */
function initGame(history) {
  if (_floor) _floor.stop();
  const canvas = document.getElementById('game-canvas');
  _floor = new TradingFloor(canvas, history);
  _floor.start();
}

/* ---- Game log bridge ---- */
window._gameLog = function (type, title, detail) {
  const log = document.getElementById('log');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'log-entry';
  if (type === 'phase') {
    div.style.fontWeight = '700';
    div.style.borderTop = '2px solid #007AFF';
    div.style.paddingTop = '4px';
    div.style.marginTop = '4px';
    div.innerHTML = `<strong>${title}</strong> <span style="font-weight:400;color:#6e6e73">${detail || ''}</span>`;
  } else if (type === 'summary') {
    div.style.fontWeight = '700';
    div.innerHTML = `<strong>${title}</strong>: ${detail}`;
  } else {
    div.innerHTML = title;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
};

/* ---- i18n update ---- */
function updateI18N() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById('app-title').textContent = t('app.title');
  document.getElementById('app-subtitle').textContent = t('app.subtitle');
}

/* ---- Tri-slider logic (info & risk groups) ---- */
function setupTriSliders() {
  const groups = {};
  document.querySelectorAll('.tri-slider').forEach(input => {
    const g = input.dataset.group;
    if (!groups[g]) groups[g] = [];
    groups[g].push(input);
  });

  Object.entries(groups).forEach(([group, sliders]) => {
    const computedId = group === 'info' ? 'v-uninformed' : 'v-ra';
    sliders.forEach(slider => {
      slider.addEventListener('input', () => {
        const vals = sliders.map(s => +s.value);
        const total = vals.reduce((a, b) => a + b, 0);
        if (total > 100) {
          const other = sliders.find(s => s !== slider);
          other.value = Math.max(0, +other.value - (total - 100));
        }
        // Update displays
        sliders.forEach(s => {
          const valEl = document.getElementById('v-' + s.id.replace('p-', ''));
          if (valEl) valEl.textContent = s.value + '%';
        });
        const remaining = Math.max(0, 100 - sliders.reduce((a, s) => a + (+s.value), 0));
        document.getElementById(computedId).textContent = remaining + '%';
      });
    });
  });
}

/* ---- Range value displays ---- */
function setupRangeDisplays() {
  const ranges = [
    ['p-cl', 'v-cl'], ['p-cd', 'v-cd'],
    ['p-bias', 'v-bias'], ['p-momentum', 'v-momentum'],
  ];
  ranges.forEach(([inputId, valId]) => {
    const input = document.getElementById(inputId);
    const val = document.getElementById(valId);
    if (input && val) {
      input.addEventListener('input', () => { val.textContent = input.value; });
    }
  });
}

/* ---- View toggle ---- */
function setupViewToggle() {
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      document.getElementById('chart-view').style.display = view === 'chart' ? 'block' : 'none';
      document.getElementById('game-view').style.display = view === 'game' ? 'block' : 'none';

      if (view === 'game' && _history && !_floor) {
        initGame(_history);
      }
      if (view === 'chart' && _floor) {
        _floor.stop();
        _floor = null;
      }
    });
  });
}

/* ---- Game controls ---- */
function setupGameControls() {
  document.getElementById('btn-play').addEventListener('click', () => {
    if (_floor && _floor.paused) _floor.togglePause();
    else if (_history && !_floor) initGame(_history);
  });
  document.getElementById('btn-pause').addEventListener('click', () => {
    if (_floor) _floor.togglePause();
  });
  document.getElementById('btn-follow').addEventListener('click', function () {
    if (!_floor) return;
    _floor._camFollow = !_floor._camFollow;
    this.classList.toggle('active', _floor._camFollow);
  });
  document.getElementById('game-speed').addEventListener('input', function () {
    const v = +this.value;
    document.getElementById('speed-val').textContent = v.toFixed(1) + 'x';
    if (_floor) _floor.speed = v;
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

/* ---- Language switch ---- */
function setupLangSwitch() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setLang(btn.dataset.lang);
      updateI18N();
      // Re-render if data exists
      if (_history) {
        renderAllCharts(_history);
        renderLog(_history);
      }
    });
  });
}

/* ---- Sidebar toggle (mobile) ---- */
function setupSidebar() {
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  setupTriSliders();
  setupRangeDisplays();
  setupViewToggle();
  setupGameControls();
  setupLangSwitch();
  setupSidebar();

  document.getElementById('btn-run').addEventListener('click', runSim);

  updateI18N();
});
