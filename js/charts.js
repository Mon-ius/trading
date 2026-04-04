/**
 * Chart rendering — Plotly-based visualizations
 * Includes both single-market charts and experiment result charts.
 */

const CHART_COLORS = {
  blue: '#007AFF', green: '#34C759', red: '#FF3B30',
  orange: '#FF9500', purple: '#AF52DE', teal: '#5AC8FA',
  gray: '#8E8E93',
  price: '#007AFF', fv: '#34C759', bid: '#34C759', ask: '#FF3B30',
  informed: '#007AFF', partial: '#FF9500', uninformed: '#FF3B30',
  experienced: '#007AFF', inexperienced: '#FF3B30',
};

function _chartLayout() {
  const dark = typeof _isDark === 'function' && _isDark();
  return {
    font: { family: "-apple-system, 'SF Pro Text', 'Inter', sans-serif", size: 11,
      color: dark ? '#8b949e' : '#6b7080' },
    margin: { t: 8, r: 50, b: 44, l: 58 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: dark ? '#0d1117' : '#fafbfc',
    xaxis: { gridcolor: dark ? '#1e242e' : '#eef0f3', zerolinecolor: dark ? '#3d4450' : '#c0c4cc' },
    yaxis: { gridcolor: dark ? '#1e242e' : '#eef0f3', zerolinecolor: dark ? '#3d4450' : '#c0c4cc' },
    autosize: true,
  };
}
const CHART_LAYOUT = _chartLayout();
const PC = { responsive: true, displayModeBar: false };

/* ================================================================
   Single Market Charts
   ================================================================ */

/** Price vs Fundamental Value (Figure 1 from Dufwenberg et al.) */
function renderPriceChart(id, history) {
  const periods = history.prices.map((_, i) => i + 1);
  const fvs = history.fvs || periods.map(() => history.trueValue);
  const traces = [
    { x: periods, y: fvs, type: 'scatter', mode: 'lines', name: 'Fundamental',
      line: { color: CHART_COLORS.fv, width: 2.5, dash: 'dash' } },
    { x: periods, y: history.prices, type: 'scatter', mode: 'lines+markers', name: 'Market Price',
      line: { color: CHART_COLORS.price, width: 2.5 }, marker: { size: 4 } },
    { x: periods, y: history.volumes, type: 'bar', name: 'Volume', yaxis: 'y2',
      marker: { color: 'rgba(0,122,255,0.12)' } },
  ];
  const L = _chartLayout();
  Plotly.newPlot(id, traces, {
    ...L,
    xaxis: { ...L.xaxis, title: 'Period' },
    yaxis: { ...L.yaxis, title: 'Price / FV' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'Volume',
      range: [0, Math.max(1, ...history.volumes) * 4] },
    legend: { x: 0, y: 1.15, orientation: 'h' }, showlegend: true,
  }, PC);
}

/** Bid-Ask Spread */
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
  ], (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: 'Period' },
    yaxis: { ...L.yaxis, title: 'Price' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'Spread' },
    legend: { x: 0, y: 1.15, orientation: 'h' },
  }; })(), PC);
}

/** P&L Distribution by experience type */
function renderPnLChart(id, agents) {
  const exp = agents.filter(a => (a.expType || a.infoType) === 'experienced' || a.infoType === 'informed');
  const inexp = agents.filter(a => (a.expType || a.infoType) === 'inexperienced' || a.infoType === 'uninformed');
  const traces = [];
  if (exp.length) traces.push({ x: exp.map(a => a.totalPnL), type: 'histogram', name: 'Experienced',
    marker: { color: CHART_COLORS.experienced }, opacity: 0.7, nbinsx: 12 });
  if (inexp.length) traces.push({ x: inexp.map(a => a.totalPnL), type: 'histogram', name: 'Inexperienced',
    marker: { color: CHART_COLORS.inexperienced }, opacity: 0.7, nbinsx: 12 });
  Plotly.newPlot(id, traces, (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: 'P&L' },
    yaxis: { ...L.yaxis, title: 'Count' },
    barmode: 'overlay', legend: { x: 0, y: 1.15, orientation: 'h' },
  }; })(), PC);
}

/** Bubble Deviation — bar chart of (price - FV)/FV per period */
function renderBubbleChart(id, history) {
  const periods = history.prices.map((_, i) => i + 1);
  const fvs = history.fvs || periods.map(() => history.trueValue);
  const devs = history.prices.map((p, i) => fvs[i] > 0 ? ((p - fvs[i]) / fvs[i]) * 100 : 0);
  Plotly.newPlot(id, [
    { x: periods, y: devs, type: 'bar',
      marker: { color: devs.map(d => d > 0 ? 'rgba(255,59,48,0.6)' : 'rgba(52,199,89,0.6)') } },
    { x: [1, periods.length], y: [0, 0], type: 'scatter', mode: 'lines',
      line: { color: 'rgba(0,0,0,0.3)', width: 1, dash: 'dash' }, showlegend: false },
  ], (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: 'Period' },
    yaxis: { ...L.yaxis, title: 'Deviation from FV (%)' },
    showlegend: false,
  }; })(), PC);
}

/** Belief trajectories — experienced vs inexperienced */
function renderBeliefChart(id, history) {
  const agents = history.agents;
  const nSample = Math.min(10, agents.length);
  const step = Math.max(1, Math.floor(agents.length / nSample));
  const fvs = history.fvs || [];

  const traces = [];
  for (let i = 0; i < agents.length && traces.length < nSample; i += step) {
    const a = agents[i];
    const isExp = (a.expType || a.infoType) === 'experienced' || a.infoType === 'informed';
    traces.push({
      x: history.prices.map((_, j) => j + 1),
      y: history.prices, // approximate
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
  Plotly.newPlot(id, traces, (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: 'Period' },
    yaxis: { ...L.yaxis, title: 'Belief / FV' },
    legend: { x: 1.02, y: 1, font: { size: 9 } },
  }; })(), PC);
}

/** Volume + lies per round */
function renderVolumeChart(id, history) {
  const periods = history.volumes.map((_, i) => i + 1);
  const lies = history.rounds.map(r => r.messages ? r.messages.filter(m => m.isLie).length : 0);
  const hasComm = lies.some(l => l > 0);
  const traces = [
    { x: periods, y: history.volumes, type: 'bar', name: t('chart.volume'),
      marker: { color: 'rgba(0,122,255,0.75)' } },
  ];
  if (hasComm) traces.push({
    x: periods, y: lies, type: 'scatter', mode: 'lines+markers', name: 'Lies',
    line: { color: CHART_COLORS.red, width: 2 }, marker: { size: 4 }, yaxis: 'y2',
  });
  Plotly.newPlot(id, traces, (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: 'Period' },
    yaxis: { ...L.yaxis, title: 'Trades' },
    yaxis2: hasComm ? { overlaying: 'y', side: 'right', showgrid: false, title: 'Lies' } : undefined,
    legend: { x: 0, y: 1.15, orientation: 'h' },
  }; })(), PC);
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
    // Threshold line
    { x: [0, 100], y: [threshold, threshold], type: 'scatter', mode: 'lines',
      name: 'Threshold', line: { color: 'rgba(0,0,0,0.3)', width: 1, dash: 'dash' }, showlegend: false },
    // Alpha* vertical line
    { x: [alphaStar * 100, alphaStar * 100], y: [0, Math.max(...sweep.map(r => r.napd)) * 1.1],
      type: 'scatter', mode: 'lines',
      name: `\u03b1* = ${(alphaStar * 100).toFixed(0)}%`,
      line: { color: CHART_COLORS.red, width: 2, dash: 'dashdot' } },
  ], (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: '\u03b1 — Experienced Fraction (%)' },
    yaxis: { ...L.yaxis, title: 'NAPD / Amplitude' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'Haessel-R\u00b2', range: [0, 1.1] },
    legend: { x: 0, y: 1.18, orientation: 'h' },
  }; })(), PC);
}

/** Alpha* vs N — main result chart */
function renderAlphaVsN(id, experimentResults) {
  // Group by (risk, knowledge) config
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
  Plotly.newPlot(id, traces, (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: 'Number of Agents (n)', type: 'log' },
    yaxis: { ...L.yaxis, title: '\u03b1* — Critical Experienced Fraction (%)', range: [0, 105] },
    legend: { x: 1.02, y: 1, font: { size: 9 } },
  }; })(), PC);
}

/** Alpha* heatmap — risk × knowledge */
function renderAlphaHeatmap(id, experimentResults, fixedN) {
  // Filter to specific n
  const filtered = fixedN ? experimentResults.filter(r => r.n === fixedN) : experimentResults;
  if (!filtered.length) return;

  // Extract unique risk and knowledge configs
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
  }], (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: 'Risk Composition' },
    yaxis: { ...L.yaxis, title: 'Knowledge Level' },
  }; })(), PC);
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
  Plotly.newPlot(id, traces, (() => { const L = _chartLayout(); return {
    ...L,
    xaxis: { ...L.xaxis, title: 'Risk Composition' },
    yaxis: { ...L.yaxis, title: '\u03b1* (%)', range: [0, 105] },
    barmode: 'group', legend: { x: 0, y: 1.15, orientation: 'h' },
  }; })(), PC);
}
