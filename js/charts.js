/**
 * Chart rendering — Plotly-based visualizations
 */

const CHART_COLORS = {
  blue: '#007AFF',
  green: '#34C759',
  red: '#FF3B30',
  orange: '#FF9500',
  purple: '#AF52DE',
  teal: '#5AC8FA',
  gray: '#8E8E93',
  trueValue: '#34C759',
  price: '#007AFF',
  bid: '#34C759',
  ask: '#FF3B30',
  informed: '#007AFF',
  partial: '#FF9500',
  uninformed: '#FF3B30',
};

const CHART_LAYOUT = {
  font: { family: "-apple-system, 'SF Pro Text', 'Inter', sans-serif", size: 11 },
  margin: { t: 36, r: 20, b: 40, l: 50 },
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  xaxis: { gridcolor: 'rgba(0,0,0,0.06)', zerolinecolor: 'rgba(0,0,0,0.1)' },
  yaxis: { gridcolor: 'rgba(0,0,0,0.06)', zerolinecolor: 'rgba(0,0,0,0.1)' },
};

function plotlyConfig() {
  return { responsive: true, displayModeBar: false };
}

/* ---- Price Discovery Chart ---- */
function renderPriceChart(containerId, history) {
  const rounds = history.prices.map((_, i) => i + 1);

  const traces = [
    {
      x: rounds, y: history.prices,
      type: 'scatter', mode: 'lines+markers',
      name: 'Market Price',
      line: { color: CHART_COLORS.price, width: 2.5 },
      marker: { size: 4 },
    },
    {
      x: [1, rounds.length], y: [history.trueValue, history.trueValue],
      type: 'scatter', mode: 'lines',
      name: 'True Value',
      line: { color: CHART_COLORS.trueValue, width: 2, dash: 'dash' },
    },
  ];

  // Volume as bar chart on secondary y-axis
  traces.push({
    x: rounds, y: history.volumes,
    type: 'bar', name: 'Volume',
    marker: { color: 'rgba(0,122,255,0.15)' },
    yaxis: 'y2',
  });

  const layout = {
    ...CHART_LAYOUT,
    title: { text: t('chart.price'), font: { size: 13, weight: 600 } },
    xaxis: { ...CHART_LAYOUT.xaxis, title: t('log.round') },
    yaxis: { ...CHART_LAYOUT.yaxis, title: 'Price' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'Volume', range: [0, Math.max(...history.volumes) * 4] },
    legend: { x: 0, y: 1.12, orientation: 'h' },
    showlegend: true,
  };

  Plotly.newPlot(containerId, traces, layout, plotlyConfig());
}

/* ---- Bid-Ask Spread Chart ---- */
function renderSpreadChart(containerId, history) {
  const rounds = history.rounds.map((_, i) => i + 1);
  const bids = history.rounds.map(r => r.bestBid);
  const asks = history.rounds.map(r => r.bestAsk);

  const traces = [
    {
      x: rounds, y: bids,
      type: 'scatter', mode: 'lines',
      name: 'Best Bid', fill: 'none',
      line: { color: CHART_COLORS.bid, width: 1.5 },
    },
    {
      x: rounds, y: asks,
      type: 'scatter', mode: 'lines',
      name: 'Best Ask', fill: 'tonexty',
      line: { color: CHART_COLORS.ask, width: 1.5 },
      fillcolor: 'rgba(255,59,48,0.08)',
    },
    {
      x: rounds, y: history.spreads,
      type: 'scatter', mode: 'lines',
      name: 'Spread',
      line: { color: CHART_COLORS.purple, width: 1, dash: 'dot' },
      yaxis: 'y2',
    },
  ];

  const layout = {
    ...CHART_LAYOUT,
    title: { text: t('chart.orderbook'), font: { size: 13, weight: 600 } },
    xaxis: { ...CHART_LAYOUT.xaxis, title: t('log.round') },
    yaxis: { ...CHART_LAYOUT.yaxis, title: 'Price' },
    yaxis2: { overlaying: 'y', side: 'right', showgrid: false, title: 'Spread' },
    legend: { x: 0, y: 1.12, orientation: 'h' },
  };

  Plotly.newPlot(containerId, traces, layout, plotlyConfig());
}

/* ---- P&L Distribution Chart ---- */
function renderPnLChart(containerId, agents) {
  const groups = { informed: [], partial: [], uninformed: [] };
  for (const a of agents) groups[a.infoType].push(a.totalPnL);

  const traces = Object.entries(groups).filter(([, v]) => v.length > 0).map(([type, pnls]) => ({
    x: pnls,
    type: 'histogram',
    name: t('info.' + type),
    marker: { color: CHART_COLORS[type] },
    opacity: 0.7,
    nbinsx: 15,
  }));

  const layout = {
    ...CHART_LAYOUT,
    title: { text: t('chart.pnl'), font: { size: 13, weight: 600 } },
    xaxis: { ...CHART_LAYOUT.xaxis, title: 'P&L' },
    yaxis: { ...CHART_LAYOUT.yaxis, title: 'Count' },
    barmode: 'overlay',
    legend: { x: 0, y: 1.12, orientation: 'h' },
  };

  Plotly.newPlot(containerId, traces, layout, plotlyConfig());
}

/* ---- Bubble Deviation Chart ---- */
function renderBubbleChart(containerId, history) {
  const rounds = history.prices.map((_, i) => i + 1);
  const devs = history.prices.map(p => ((p - history.trueValue) / history.trueValue) * 100);

  const colors = devs.map(d => d > 0 ? 'rgba(255,59,48,0.6)' : 'rgba(52,199,89,0.6)');

  const traces = [
    {
      x: rounds, y: devs,
      type: 'bar',
      marker: { color: colors },
      name: 'Deviation %',
    },
    {
      x: [1, rounds.length], y: [0, 0],
      type: 'scatter', mode: 'lines',
      line: { color: 'rgba(0,0,0,0.3)', width: 1, dash: 'dash' },
      showlegend: false,
    },
  ];

  const layout = {
    ...CHART_LAYOUT,
    title: { text: t('chart.bubble'), font: { size: 13, weight: 600 } },
    xaxis: { ...CHART_LAYOUT.xaxis, title: t('log.round') },
    yaxis: { ...CHART_LAYOUT.yaxis, title: 'Deviation (%)' },
    showlegend: false,
  };

  Plotly.newPlot(containerId, traces, layout, plotlyConfig());
}

/* ---- Belief Convergence Chart ---- */
function renderBeliefChart(containerId, history) {
  // Sample a few agents to show belief trajectory
  const agents = history.agents;
  const nSample = Math.min(12, agents.length);
  const step = Math.max(1, Math.floor(agents.length / nSample));
  const sampled = [];
  for (let i = 0; i < agents.length && sampled.length < nSample; i += step) {
    sampled.push(agents[i]);
  }

  const traces = sampled.map(a => ({
    x: [0, ...history.prices.map((_, i) => i + 1)],
    y: [a.signal, ...history.prices], // Approximate — use signal as starting belief
    type: 'scatter', mode: 'lines',
    name: `${a.name} (${t('info.' + a.infoType)})`,
    line: {
      color: CHART_COLORS[a.infoType],
      width: 1.2,
      dash: a.infoType === 'uninformed' ? 'dot' : 'solid',
    },
    opacity: 0.7,
  }));

  // True value line
  traces.push({
    x: [0, history.prices.length],
    y: [history.trueValue, history.trueValue],
    type: 'scatter', mode: 'lines',
    name: 'True Value',
    line: { color: CHART_COLORS.trueValue, width: 2.5, dash: 'dash' },
  });

  const layout = {
    ...CHART_LAYOUT,
    title: { text: t('chart.beliefs'), font: { size: 13, weight: 600 } },
    xaxis: { ...CHART_LAYOUT.xaxis, title: t('log.round') },
    yaxis: { ...CHART_LAYOUT.yaxis, title: 'Belief / Price' },
    legend: { x: 1.02, y: 1, font: { size: 9 } },
  };

  Plotly.newPlot(containerId, traces, layout, plotlyConfig());
}

/* ---- Volume Chart ---- */
function renderVolumeChart(containerId, history) {
  const rounds = history.volumes.map((_, i) => i + 1);

  // Count lies per round
  const lies = history.rounds.map(r => r.messages ? r.messages.filter(m => m.isLie).length : 0);
  const hasComm = lies.some(l => l > 0);

  const traces = [
    {
      x: rounds, y: history.volumes,
      type: 'bar', name: t('chart.volume'),
      marker: { color: CHART_COLORS.blue, opacity: 0.7 },
    },
  ];

  if (hasComm) {
    traces.push({
      x: rounds, y: lies,
      type: 'scatter', mode: 'lines+markers',
      name: 'Lies per Round',
      line: { color: CHART_COLORS.red, width: 2 },
      marker: { size: 5 },
      yaxis: 'y2',
    });
  }

  const layout = {
    ...CHART_LAYOUT,
    title: { text: t('chart.volume'), font: { size: 13, weight: 600 } },
    xaxis: { ...CHART_LAYOUT.xaxis, title: t('log.round') },
    yaxis: { ...CHART_LAYOUT.yaxis, title: 'Trades' },
    yaxis2: hasComm ? { overlaying: 'y', side: 'right', showgrid: false, title: 'Lies' } : undefined,
    legend: { x: 0, y: 1.12, orientation: 'h' },
  };

  Plotly.newPlot(containerId, traces, layout, plotlyConfig());
}

/* ---- Render all charts ---- */
function renderAllCharts(history) {
  renderPriceChart('chart-price', history);
  renderSpreadChart('chart-spread', history);
  renderPnLChart('chart-pnl', history.agents);
  renderBubbleChart('chart-bubble', history);
  renderBeliefChart('chart-beliefs', history);
  renderVolumeChart('chart-volume', history);
}
