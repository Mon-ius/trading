/**
 * Chart rendering — Plotly visualizations
 * Six charts for the unified DLM + Lopez-Lira experiment.
 */

const CHART_COLORS = {
  blue: '#007AFF', green: '#34C759', red: '#FF3B30',
  orange: '#FF9500', purple: '#AF52DE', teal: '#5AC8FA',
  gray: '#8E8E93',
  price: '#007AFF', fv: '#34C759',
  experienced: '#2563eb', inexperienced: '#dc2626',
};
const RC = { risk_loving: '#dc2626', risk_neutral: '#d97706', risk_averse: '#2563eb' };

const PC = { responsive: true, displayModeBar: false };

function _baseLayout() {
  const dark = typeof _isDark === 'function' && _isDark();
  const fg = dark ? '#8b949e' : '#6b7080';
  const grid = dark ? '#1e242e' : '#eef0f3';
  const zero = dark ? '#3d4450' : '#c0c4cc';
  const narrow = window.innerWidth < 600;
  return {
    font: { family: "-apple-system, 'SF Pro Text', 'Inter', sans-serif", size: narrow ? 10 : 11, color: fg },
    margin: { t: 8, r: narrow ? 10 : 50, b: 40, l: narrow ? 40 : 58 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: dark ? '#0d1117' : '#fafbfc',
    xaxis: { gridcolor: grid, zerolinecolor: zero },
    yaxis: { gridcolor: grid, zerolinecolor: zero },
    autosize: true,
  };
}

function _layout(overrides) {
  const L = _baseLayout();
  const out = { ...L, ...overrides };
  if (overrides.xaxis) out.xaxis = { ...L.xaxis, ...overrides.xaxis };
  if (overrides.yaxis) out.yaxis = { ...L.yaxis, ...overrides.yaxis };
  if (overrides.yaxis2) out.margin = { ...out.margin, r: Math.max(out.margin.r, 40) };
  return out;
}

/* ================================================================
   Fig 1 — Price vs declining Fundamental Value (DLM 2005)
   ================================================================ */
function renderPriceChart(id, lab) {
  const session = lab.session;
  const periods = session.prices.map((_, i) => i + 1);
  const fvs = session.fvs;
  Plotly.newPlot(id, [
    { x: periods, y: fvs, type: 'scatter', mode: 'lines', name: 'Fundamental',
      line: { color: CHART_COLORS.fv, width: 2.5, dash: 'dash' } },
    { x: periods, y: session.prices, type: 'scatter', mode: 'lines+markers', name: 'Market Price',
      line: { color: CHART_COLORS.price, width: 2.5 }, marker: { size: 5 } },
  ], _layout({
    xaxis: { title: 'Period' },
    yaxis: { title: 'Price / FV' },
    legend: { x: 0, y: 1.15, orientation: 'h' },
    annotations: [{
      x: 1, y: 1.08, xref: 'paper', yref: 'paper', showarrow: false,
      text: `Haessel-R\u00b2=${session.bubbleMetrics.haesselR2.toFixed(2)} | NAPD=${session.bubbleMetrics.napd.toFixed(2)} | Amp=${session.bubbleMetrics.amplitude.toFixed(2)}`,
      font: { size: 10, color: '#8b949e' },
    }],
  }), PC);
}

/* ================================================================
   Fig 2 — Trading Volume per period
   ================================================================ */
function renderVolumeChart(id, lab) {
  const session = lab.session;
  const periods = session.volumes.map((_, i) => i + 1);
  const maxVol = Math.max(1, ...session.volumes);
  Plotly.newPlot(id, [
    { x: periods, y: session.volumes, type: 'bar', name: 'Trades',
      marker: { color: 'rgba(0,122,255,0.75)' } },
  ], _layout({
    xaxis: { title: 'Period' },
    yaxis: { title: 'Trades', range: [0, maxVol * 1.15], dtick: maxVol > 10 ? undefined : 1 },
    showlegend: false,
  }), PC);
}

/* ================================================================
   Fig 3 — Price deviation from FV (per-period bubble)
   ================================================================ */
function renderBubbleChart(id, lab) {
  const session = lab.session;
  const periods = session.prices.map((_, i) => i + 1);
  const devs = session.prices.map((p, i) => {
    const fv = session.fvs[i];
    return fv > 0 ? ((p - fv) / fv) * 100 : 0;
  });
  Plotly.newPlot(id, [
    { x: periods, y: devs, type: 'bar',
      marker: { color: devs.map(d => d > 0 ? 'rgba(255,59,48,0.6)' : 'rgba(52,199,89,0.6)') } },
    { x: [1, periods.length], y: [0, 0], type: 'scatter', mode: 'lines',
      line: { color: 'rgba(0,0,0,0.3)', width: 1, dash: 'dash' }, showlegend: false },
  ], _layout({
    xaxis: { title: 'Period' },
    yaxis: { title: 'Deviation from FV (%)' },
    showlegend: false,
  }), PC);
}

/* ================================================================
   Fig 4 — Belief trajectories (sampled agents)
   ================================================================ */
function renderBeliefChart(id, lab) {
  const session = lab.session;
  const rounds = session.rounds;
  if (!rounds || rounds.length === 0) {
    Plotly.newPlot(id, [], _layout({ xaxis: { title: 'Period' }, yaxis: { title: 'Belief' } }), PC);
    return;
  }
  const n = rounds[0].orders ? rounds[0].orders.length : 0;
  const sample = Math.min(8, n);
  const step = Math.max(1, Math.floor(n / sample));
  const periods = rounds.map((_, i) => i + 1);

  const traces = [];
  const initialAgents = lab.initialSnapshot;
  for (let aid = 0; aid < n && traces.length < sample; aid += step) {
    const agent = initialAgents[aid];
    const isExp = agent && agent.expType === 'experienced';
    const beliefs = rounds.map(r => {
      const ord = r.orders ? r.orders.find(o => o.agentId === aid) : null;
      return ord ? ord.belief : null;
    });
    traces.push({
      x: periods, y: beliefs, type: 'scatter', mode: 'lines',
      name: `${agent.displayName} (${isExp ? 'Exp' : 'Inexp'})`,
      line: { color: isExp ? CHART_COLORS.experienced : CHART_COLORS.inexperienced,
        width: 1.5, dash: isExp ? 'solid' : 'dot' },
      opacity: 0.75,
    });
  }
  traces.push({
    x: periods, y: session.fvs, type: 'scatter', mode: 'lines',
    name: 'FV', line: { color: CHART_COLORS.fv, width: 2.5, dash: 'dash' },
  });

  Plotly.newPlot(id, traces, _layout({
    xaxis: { title: 'Period' },
    yaxis: { title: 'Belief / FV' },
    legend: { x: 1.02, y: 1, font: { size: 9 } },
  }), PC);
}

/* ================================================================
   Fig 5 — P&L by risk type
   ================================================================ */
function renderPnLChart(id, lab) {
  const agents = lab.session.agents;
  const types = ['risk_loving', 'risk_neutral', 'risk_averse'];
  const labels = [t('rt.rl'), t('rt.rn'), t('rt.ra')];

  const expPnl = types.map(rt => {
    const as = agents.filter(a => a.riskType === rt && a.expType === 'experienced');
    return as.length ? avg(as.map(a => a.totalPnL)) : 0;
  });
  const inexpPnl = types.map(rt => {
    const as = agents.filter(a => a.riskType === rt && a.expType === 'inexperienced');
    return as.length ? avg(as.map(a => a.totalPnL)) : 0;
  });

  Plotly.newPlot(id, [
    { x: labels, y: expPnl, type: 'bar', name: t('info.experienced'),
      marker: { color: CHART_COLORS.experienced, opacity: 0.8 } },
    { x: labels, y: inexpPnl, type: 'bar', name: t('info.inexperienced'),
      marker: { color: CHART_COLORS.inexperienced, opacity: 0.8 } },
  ], _layout({
    xaxis: { title: '' },
    yaxis: { title: 'Avg P&L' },
    barmode: 'group', legend: { x: 0, y: 1.15, orientation: 'h' },
  }), PC);
}

/* ================================================================
   Fig 6 — Experience effect across replays
   ================================================================ */
function renderExperienceChart(id, lab) {
  const sessions = lab.sessionResults || [];
  if (sessions.length <= 1) {
    // Single session — show its own bubble metrics as bars
    const bm = lab.session.bubbleMetrics;
    const metrics = ['Haessel-R\u00b2', 'NAPD', 'Amplitude', 'Turnover'];
    Plotly.newPlot(id, [{
      x: metrics, y: [bm.haesselR2, bm.napd, bm.amplitude, bm.turnover],
      type: 'bar', marker: { color: CHART_COLORS.blue, opacity: 0.8 },
    }], _layout({
      xaxis: { title: 'Bubble Metric (single session)' },
      yaxis: { title: 'Value' },
      showlegend: false,
      annotations: [{
        x: 0.5, y: 1.08, xref: 'paper', yref: 'paper', showarrow: false,
        text: 'Increase Experience Sessions to see DLM (2005) experience effect',
        font: { size: 10, color: '#8b949e' },
      }],
    }), PC);
    return;
  }

  const labels = sessions.map(s => `Sess ${s.session}`);
  const r2 = sessions.map(s => s.bubbleMetrics.haesselR2);
  const napd = sessions.map(s => s.bubbleMetrics.napd);
  const amp = sessions.map(s => s.bubbleMetrics.amplitude);

  Plotly.newPlot(id, [
    { x: labels, y: r2, type: 'scatter', mode: 'lines+markers', name: 'Haessel-R\u00b2',
      line: { color: CHART_COLORS.green, width: 2.5 }, marker: { size: 8 } },
    { x: labels, y: napd, type: 'scatter', mode: 'lines+markers', name: 'NAPD',
      line: { color: CHART_COLORS.red, width: 2.5 }, marker: { size: 8 }, yaxis: 'y2' },
    { x: labels, y: amp, type: 'scatter', mode: 'lines+markers', name: 'Amplitude',
      line: { color: CHART_COLORS.orange, width: 2.5 }, marker: { size: 8 }, yaxis: 'y2' },
  ], _layout({
    xaxis: { title: 'Session (experience \u2192)' },
    yaxis: { title: 'Haessel-R\u00b2', range: [0, 1.1] },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'NAPD / Amp' },
    legend: { x: 0, y: 1.15, orientation: 'h' },
  }), PC);
}

/* ================================================================
   Render all six charts
   ================================================================ */
function renderAllCharts(lab) {
  renderPriceChart('chart-price', lab);
  renderVolumeChart('chart-volume', lab);
  renderBubbleChart('chart-bubble', lab);
  renderBeliefChart('chart-beliefs', lab);
  renderPnLChart('chart-pnl', lab);
  renderExperienceChart('chart-experience', lab);
}
