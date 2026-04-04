/**
 * Chart rendering — Plotly-based visualizations
 * Single-market charts (6) + experiment result charts (4).
 */

const CHART_COLORS = {
  blue: '#007AFF', green: '#34C759', red: '#FF3B30',
  orange: '#FF9500', purple: '#AF52DE', teal: '#5AC8FA',
  gray: '#8E8E93',
  price: '#007AFF', fv: '#34C759', bid: '#34C759', ask: '#FF3B30',
  experienced: '#007AFF', inexperienced: '#FF3B30',
};

const PC = { responsive: true, displayModeBar: false };

function _baseLayout() {
  const dark = typeof _isDark === 'function' && _isDark();
  const fg = dark ? '#8b949e' : '#6b7080';
  const grid = dark ? '#1e242e' : '#eef0f3';
  const zero = dark ? '#3d4450' : '#c0c4cc';
  return {
    font: { family: "-apple-system, 'SF Pro Text', 'Inter', sans-serif", size: 11, color: fg },
    margin: { t: 8, r: 50, b: 44, l: 58 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: dark ? '#0d1117' : '#fafbfc',
    xaxis: { gridcolor: grid, zerolinecolor: zero },
    yaxis: { gridcolor: grid, zerolinecolor: zero },
    autosize: true,
  };
}

/* Helper: build layout by merging overrides onto base */
function _layout(overrides) {
  const L = _baseLayout();
  const out = { ...L, ...overrides };
  if (overrides.xaxis) out.xaxis = { ...L.xaxis, ...overrides.xaxis };
  if (overrides.yaxis) out.yaxis = { ...L.yaxis, ...overrides.yaxis };
  return out;
}

/* ================================================================
   Single Market Charts
   ================================================================ */

/** Fig 1 — Price vs Fundamental Value */
function renderPriceChart(id, history) {
  const periods = history.prices.map((_, i) => i + 1);
  const fvs = history.fvs || periods.map(() => history.trueValue);
  Plotly.newPlot(id, [
    { x: periods, y: fvs, type: 'scatter', mode: 'lines', name: 'Fundamental',
      line: { color: CHART_COLORS.fv, width: 2.5, dash: 'dash' } },
    { x: periods, y: history.prices, type: 'scatter', mode: 'lines+markers', name: 'Market Price',
      line: { color: CHART_COLORS.price, width: 2.5 }, marker: { size: 4 } },
    { x: periods, y: history.volumes, type: 'bar', name: 'Volume', yaxis: 'y2',
      marker: { color: 'rgba(0,122,255,0.12)' } },
  ], _layout({
    xaxis: { title: 'Period' },
    yaxis: { title: 'Price / FV' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'Volume',
      range: [0, Math.max(1, ...history.volumes) * 4] },
    legend: { x: 0, y: 1.15, orientation: 'h' }, showlegend: true,
  }), PC);
}

/** Fig 2 — Bid-Ask Spread */
function renderSpreadChart(id, history) {
  const periods = history.rounds.map((_, i) => i + 1);
  Plotly.newPlot(id, [
    { x: periods, y: history.rounds.map(r => r.bestBid), type: 'scatter', mode: 'lines',
      name: 'Best Bid', line: { color: CHART_COLORS.bid, width: 1.5 } },
    { x: periods, y: history.rounds.map(r => r.bestAsk), type: 'scatter', mode: 'lines',
      name: 'Best Ask', fill: 'tonexty', line: { color: CHART_COLORS.ask, width: 1.5 },
      fillcolor: 'rgba(255,59,48,0.06)' },
    { x: periods, y: history.spreads, type: 'scatter', mode: 'lines',
      name: 'Spread', line: { color: CHART_COLORS.purple, width: 1, dash: 'dot' }, yaxis: 'y2' },
  ], _layout({
    xaxis: { title: 'Period' },
    yaxis: { title: 'Price' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'Spread' },
    legend: { x: 0, y: 1.15, orientation: 'h' },
  }), PC);
}

/** Fig 3 — P&L Distribution by experience type */
function renderPnLChart(id, agents) {
  const exp = agents.filter(a => (a.expType || a.infoType) === 'experienced' || a.infoType === 'informed');
  const inexp = agents.filter(a => (a.expType || a.infoType) === 'inexperienced' || a.infoType === 'uninformed');
  const traces = [];
  if (exp.length) traces.push({ x: exp.map(a => a.totalPnL), type: 'histogram', name: 'Experienced',
    marker: { color: CHART_COLORS.experienced }, opacity: 0.7, nbinsx: 12 });
  if (inexp.length) traces.push({ x: inexp.map(a => a.totalPnL), type: 'histogram', name: 'Inexperienced',
    marker: { color: CHART_COLORS.inexperienced }, opacity: 0.7, nbinsx: 12 });
  Plotly.newPlot(id, traces, _layout({
    xaxis: { title: 'P&L' },
    yaxis: { title: 'Count' },
    barmode: 'overlay', legend: { x: 0, y: 1.15, orientation: 'h' },
  }), PC);
}

/** Fig 4 — Bubble Deviation bar chart */
function renderBubbleChart(id, history) {
  const periods = history.prices.map((_, i) => i + 1);
  const fvs = history.fvs || periods.map(() => history.trueValue);
  const devs = history.prices.map((p, i) => fvs[i] > 0 ? ((p - fvs[i]) / fvs[i]) * 100 : 0);
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

/** Fig 5 — Belief trajectories */
function renderBeliefChart(id, history) {
  const agents = history.agents;
  const nSample = Math.min(10, agents.length);
  const step = Math.max(1, Math.floor(agents.length / nSample));
  const fvs = history.fvs || [];
  const periods = history.prices.map((_, j) => j + 1);

  const traces = [];
  for (let i = 0; i < agents.length && traces.length < nSample; i += step) {
    const a = agents[i];
    const isExp = (a.expType || a.infoType) === 'experienced' || a.infoType === 'informed';
    traces.push({
      x: periods, y: history.prices,
      type: 'scatter', mode: 'lines',
      name: `${a.name} (${isExp ? 'Exp' : 'Inexp'})`,
      line: { color: isExp ? CHART_COLORS.experienced : CHART_COLORS.inexperienced,
        width: 1, dash: isExp ? 'solid' : 'dot' },
      opacity: 0.6,
    });
  }
  if (fvs.length) {
    traces.push({ x: fvs.map((_, i) => i + 1), y: fvs, type: 'scatter', mode: 'lines',
      name: 'Fundamental', line: { color: CHART_COLORS.fv, width: 2.5, dash: 'dash' } });
  }
  Plotly.newPlot(id, traces, _layout({
    xaxis: { title: 'Period' },
    yaxis: { title: 'Belief / FV' },
    legend: { x: 1.02, y: 1, font: { size: 9 } },
  }), PC);
}

/** Fig 6 — Trading Volume */
function renderVolumeChart(id, history) {
  const periods = history.volumes.map((_, i) => i + 1);
  const maxVol = Math.max(1, ...history.volumes);
  const lies = history.rounds.map(r => r.messages ? r.messages.filter(m => m.isLie).length : 0);
  const hasComm = lies.some(l => l > 0);

  const traces = [
    { x: periods, y: history.volumes, type: 'bar', name: 'Volume',
      marker: { color: 'rgba(0,122,255,0.75)' } },
  ];

  const layout = _layout({
    xaxis: { title: 'Period' },
    yaxis: { title: 'Trades', range: [0, maxVol * 1.15], dtick: maxVol > 10 ? undefined : 1 },
    legend: { x: 0, y: 1.15, orientation: 'h' },
  });

  if (hasComm) {
    traces.push({
      x: periods, y: lies, type: 'scatter', mode: 'lines+markers', name: 'Lies',
      line: { color: CHART_COLORS.red, width: 2 }, marker: { size: 4 }, yaxis: 'y2',
    });
    layout.yaxis2 = { overlaying: 'y', side: 'right', showgrid: false, title: 'Lies' };
  }

  Plotly.newPlot(id, traces, layout, PC);
}

function renderAllCharts(history) {
  renderPriceChart('chart-price', history);
  renderSpreadChart('chart-spread', history);
  renderPnLChart('chart-pnl', history.agents);
  renderBubbleChart('chart-bubble', history);
  renderBeliefChart('chart-beliefs', history);
  renderVolumeChart('chart-volume', history);
}

/* ================================================================
   Experiment Charts — alpha* results
   ================================================================ */

/** Alpha sweep curve: NAPD vs alpha for single config */
function renderAlphaSweep(id, sweep, alphaStar, threshold) {
  const alphas = sweep.map(r => r.alpha * 100);
  Plotly.newPlot(id, [
    { x: alphas, y: sweep.map(r => r.napd), type: 'scatter', mode: 'lines+markers',
      name: 'NAPD', line: { color: CHART_COLORS.blue, width: 2.5 }, marker: { size: 5 } },
    { x: alphas, y: sweep.map(r => r.amplitude), type: 'scatter', mode: 'lines+markers',
      name: 'Amplitude', line: { color: CHART_COLORS.orange, width: 2 }, marker: { size: 4 } },
    { x: alphas, y: sweep.map(r => r.haesselR2), type: 'scatter', mode: 'lines+markers',
      name: 'Haessel-R\u00b2', line: { color: CHART_COLORS.green, width: 2 }, marker: { size: 4 }, yaxis: 'y2' },
    { x: [0, 100], y: [threshold, threshold], type: 'scatter', mode: 'lines',
      name: 'Threshold', line: { color: 'rgba(0,0,0,0.3)', width: 1, dash: 'dash' }, showlegend: false },
    { x: [alphaStar * 100, alphaStar * 100], y: [0, Math.max(...sweep.map(r => r.napd)) * 1.1],
      type: 'scatter', mode: 'lines',
      name: `\u03b1* = ${(alphaStar * 100).toFixed(0)}%`,
      line: { color: CHART_COLORS.red, width: 2, dash: 'dashdot' } },
  ], _layout({
    xaxis: { title: '\u03b1 \u2014 Experienced Fraction (%)' },
    yaxis: { title: 'NAPD / Amplitude' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'Haessel-R\u00b2', range: [0, 1.1] },
    legend: { x: 0, y: 1.18, orientation: 'h' },
  }), PC);
}

/** Alpha* vs N — main result chart */
function renderAlphaVsN(id, experimentResults) {
  const groups = {};
  for (const r of experimentResults) {
    const key = `RL${r.risk.rl}/RN${r.risk.rn} | bias=${r.knowledge.bias}`;
    if (!groups[key]) groups[key] = { ns: [], alphas: [], label: key };
    groups[key].ns.push(r.n);
    groups[key].alphas.push(r.alphaStar * 100);
  }
  const colors = [CHART_COLORS.blue, CHART_COLORS.red, CHART_COLORS.green,
    CHART_COLORS.orange, CHART_COLORS.purple, CHART_COLORS.teal, CHART_COLORS.gray];
  const traces = Object.values(groups).map((g, i) => ({
    x: g.ns, y: g.alphas, type: 'scatter', mode: 'lines+markers',
    name: g.label, line: { color: colors[i % colors.length], width: 2 }, marker: { size: 6 },
  }));
  Plotly.newPlot(id, traces, _layout({
    xaxis: { title: 'Number of Agents (n)', type: 'log' },
    yaxis: { title: '\u03b1* \u2014 Critical Experienced Fraction (%)', range: [0, 105] },
    legend: { x: 1.02, y: 1, font: { size: 9 } },
  }), PC);
}

/** Alpha* heatmap — risk x knowledge */
function renderAlphaHeatmap(id, experimentResults, fixedN) {
  const filtered = fixedN ? experimentResults.filter(r => r.n === fixedN) : experimentResults;
  if (!filtered.length) return;

  const riskLabels = [...new Set(filtered.map(r => `RL${r.risk.rl}/RN${r.risk.rn}/RA${100-r.risk.rl-r.risk.rn}`))];
  const knowLabels = [...new Set(filtered.map(r => `bias=${r.knowledge.bias}`))];

  const z = [];
  for (const kl of knowLabels) {
    const row = [];
    for (const rl of riskLabels) {
      const match = filtered.find(r =>
        `RL${r.risk.rl}/RN${r.risk.rn}/RA${100-r.risk.rl-r.risk.rn}` === rl &&
        `bias=${r.knowledge.bias}` === kl
      );
      row.push(match ? match.alphaStar * 100 : null);
    }
    z.push(row);
  }

  Plotly.newPlot(id, [{
    z, x: riskLabels, y: knowLabels,
    type: 'heatmap',
    colorscale: [[0, '#34C759'], [0.33, '#FFD60A'], [0.66, '#FF9500'], [1, '#FF3B30']],
    colorbar: { title: '\u03b1* (%)', len: 0.8 },
    text: z.map(row => row.map(v => v != null ? v.toFixed(0) + '%' : '')),
    texttemplate: '%{text}',
    hovertemplate: '%{x}<br>%{y}<br>\u03b1* = %{z:.1f}%<extra></extra>',
  }], _layout({
    xaxis: { title: 'Risk Composition' },
    yaxis: { title: 'Knowledge Level' },
  }), PC);
}

/** Alpha* vs risk composition (grouped bar) */
function renderAlphaVsRisk(id, experimentResults, fixedN) {
  const filtered = fixedN ? experimentResults.filter(r => r.n === fixedN) : experimentResults;
  const knowGroups = {};
  for (const r of filtered) {
    const kl = `bias=${r.knowledge.bias}`;
    if (!knowGroups[kl]) knowGroups[kl] = [];
    knowGroups[kl].push(r);
  }
  const colors = [CHART_COLORS.blue, CHART_COLORS.orange, CHART_COLORS.red, CHART_COLORS.purple];
  const traces = Object.entries(knowGroups).map(([label, data], i) => ({
    x: data.map(r => `RL${r.risk.rl}/RN${r.risk.rn}`),
    y: data.map(r => r.alphaStar * 100),
    type: 'bar', name: label,
    marker: { color: colors[i % colors.length], opacity: 0.8 },
  }));
  Plotly.newPlot(id, traces, _layout({
    xaxis: { title: 'Risk Composition' },
    yaxis: { title: '\u03b1* (%)', range: [0, 105] },
    barmode: 'group', legend: { x: 0, y: 1.15, orientation: 'h' },
  }), PC);
}
