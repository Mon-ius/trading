/**
 * Trading Simulation — Unified Engine + Trading Floor
 * =====================================================
 * Replicates the Dufwenberg, Lindqvist & Moore (2005, AER)
 *   "Bubbles and Experience" laboratory market, using the
 *   Lopez-Lira (2025) "Can LLMs Trade?" CARA-agent CDA framework.
 *
 *   - Asset:   declining FV(t) = (T - t) × E[d], stochastic dividends {0, 2·E[d]}
 *   - Agents:  CARA utility with heterogeneous risk types γ (Lopez-Lira)
 *   - Belief:  experienced track FV(t); inexperienced anchor on FV(0) with weight 0.5^e
 *   - Trading: continuous double auction (CDA), reservation prices = belief ± γ·σ²/2
 *   - Sessions: same agents replay the market — anchor weight halves at every replay (DLM Table 2)
 *   - LLM mode: optional API agents replace stochastic CARA decisions (Lopez-Lira)
 */

/* ================================================================
   Random utilities
   ================================================================ */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function randn(g) {
  let u = 0, v = 0;
  while (!u) u = g(); while (!v) v = g();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function shuffle(arr, g) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(g() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ================================================================
   Agent names — short, neutral
   ================================================================ */
const AGENT_NAMES = [
  'Ada','Ben','Cleo','Dan','Eve','Finn','Gaia','Hugo',
  'Iris','Jack','Kate','Leo','Mia','Niko','Olga','Paul',
  'Quinn','Rosa','Sam','Tara','Uri','Vera','Wade','Xena',
  'Yuri','Zara','Axel','Beth','Cruz','Dana','Emil','Faye',
  'Glen','Hope','Ivan','Jade','Kent','Luna','Mars','Nell',
  'Otto','Pia','Rex','Sia','Troy','Uma','Vito','Wren',
  'Xia','Yael','Zev','Arlo','Bree','Cole','Dex','Elsa',
  'Fox','Gwen','Hart','Ines','Joss','Kira','Lark','Mace',
  'Nico','Opal','Pax','Rue','Seth','Tess','Ugo','Vale',
  'Wynn','Xavi','Yoko','Zion','Alma','Bram','Cass','Drew',
  'Eddy','Fern','Gray','Hana','Igor','Jane','Knox','Lily',
  'Moss','Noor','Onyx','Prim','Remy','Snow','Tate','Ulya',
  'Voss','Wilt','Xeno','Yves','Zola','Ames','Beau','Cyan',
  'Dina','Elio','Flo','Gage','Herb','Iona','Joel','Kael',
  'Lena','Myra','Nash','Odin','Page','Ren','Skye','Thea',
  'Ula','Vlad','West','Xixi','Yuna','Zeke','Ash','Bay',
];

/* ================================================================
   CARA risk-type ranges (Lopez-Lira 2025)
   U(W) = -exp(-γW)/γ.  γ < 0 risk-loving, γ > 0 risk-averse.
   ================================================================ */
const RISK_PARAMS = {
  risk_loving:  { lo: -0.008, hi:  0.002 },
  risk_neutral: { lo:  0.002, hi:  0.012 },
  risk_averse:  { lo:  0.012, hi:  0.060 },
};

function caraUtility(W, gamma) {
  if (Math.abs(gamma) < 1e-8) return W;
  return -Math.exp(-gamma * W) / gamma;
}

/* ================================================================
   Asset model — declining fundamental value (DLM 2005)
   FV(t) = (T - t) × E[d], dividends d ∈ {0, 2·E[d]} with P=0.5
   ================================================================ */
function fundamentalValue(period, T, expectedDiv) {
  return Math.max(0, (T - period) * expectedDiv);
}

function drawDividend(expectedDiv, g) {
  return g() < 0.5 ? 0 : 2 * expectedDiv;
}

/* ================================================================
   Agent creation — Lopez-Lira CARA framework, equal DLM endowments
   alpha = within-session fraction of experienced agents
   ================================================================ */
function createAgents(params, g) {
  const {
    n, T, expectedDiv, alpha,
    rlPct, rnPct,
    initialCash, initialShares,
  } = params;

  // Experience labels — DLM α-treatment within a single session
  const nExp = Math.round(n * (alpha || 0));
  const expArr = [];
  for (let i = 0; i < nExp; i++) expArr.push('experienced');
  for (let i = 0; i < n - nExp; i++) expArr.push('inexperienced');
  shuffle(expArr, g);

  // Risk types — Lopez-Lira heterogeneous CARA γ
  const nRL = Math.round(n * rlPct / 100);
  const nRN = Math.round(n * rnPct / 100);
  const riskArr = [];
  for (let i = 0; i < nRL; i++) riskArr.push('risk_loving');
  for (let i = 0; i < nRN; i++) riskArr.push('risk_neutral');
  for (let i = 0; i < n - nRL - nRN; i++) riskArr.push('risk_averse');
  shuffle(riskArr, g);

  const fv0 = fundamentalValue(0, T, expectedDiv);
  const agents = [];

  // DLM (2005) gives every trader the same endowment (C₀, S₀).
  for (let i = 0; i < n; i++) {
    const rt = riskArr[i];
    const rp = RISK_PARAMS[rt];
    const gamma = rp.lo + (rp.hi - rp.lo) * g();

    agents.push({
      id: i,
      name: AGENT_NAMES[i] || `A${i}`,
      expType: expArr[i],
      riskType: rt,
      gamma,
      riskAversion: gamma,           // alias used by ai-agent.js
      cash: initialCash,
      shares: initialShares,
      initialCash,
      initialShares,
      experience: 0,
      belief: fv0,
      trades: [],
      wealthHistory: [],
      shareHistory: [],
      dividendsReceived: 0,
      totalPnL: 0,
    });
  }
  return agents;
}

/* ================================================================
   Belief update — DLM (2005) experience channel only.
   Experienced traders track FV(t); inexperienced traders anchor on
   FV(0) with weight 0.5^e and converge on FV(t) as e grows. There
   are no behavioural knobs — every input is from the source paper.
   ================================================================ */
const BELIEF_NOISE = 0.05;  // small ε around the rational reference

function updateAgentBelief(agent, period, T, expectedDiv, _lp, _pp, _params, g) {
  const fv  = fundamentalValue(period, T, expectedDiv);
  const fv0 = fundamentalValue(0, T, expectedDiv);
  const e     = agent.experience || 0;
  const decay = Math.pow(0.5, e);
  const eps   = BELIEF_NOISE * randn(g);

  if (agent.expType === 'experienced') {
    // DLM α-treatment: FV-trackers — Lopez-Lira (2025) rational baseline
    agent.belief = Math.max(0, fv * (1 + eps));
    return;
  }

  // Inexperienced: anchor on FV(0), shed the anchor as experience grows.
  // belief = FV(0)·0.5^e + FV(t)·(1 − 0.5^e). DLM (2005) Table 2 channel.
  const anchored = fv0 * decay + fv * (1 - decay);
  agent.belief = Math.max(0, anchored * (1 + eps));
}

/* ================================================================
   CARA reservation prices (Lopez-Lira 2025)
   bid = belief - γ·σ²/2     ask = belief + γ·σ²/2
   ================================================================ */
function reservationBid(agent, sigma) {
  const rp = agent.gamma * sigma * sigma / 2;
  return Math.max(0.01, agent.belief - rp);
}
function reservationAsk(agent, sigma) {
  const rp = agent.gamma * sigma * sigma / 2;
  return Math.max(0.01, agent.belief + rp);
}

function computeOrders(agents, marketSigma) {
  const orders = [];
  for (const a of agents) {
    orders.push({
      agentId: a.id,
      bid: reservationBid(a, marketSigma),
      ask: reservationAsk(a, marketSigma),
      belief: a.belief,
      wantsBuy: a.cash >= 0.01,
      wantsSell: a.shares > 0,
    });
  }
  return orders;
}

/* ================================================================
   CDA matching engine (Lopez-Lira / DLM)
   ================================================================ */
function matchOrders(orders, agents) {
  const buys = orders
    .filter(o => o.wantsBuy && agents[o.agentId].cash > 0)
    .map(o => ({ ...o, price: o.bid }));
  const sells = orders
    .filter(o => o.wantsSell && agents[o.agentId].shares > 0)
    .map(o => ({ ...o, price: o.ask }));

  buys.sort((a, b) => b.price - a.price);
  sells.sort((a, b) => a.price - b.price);

  const trades = [];
  let bi = 0, si = 0;

  while (bi < buys.length && si < sells.length) {
    const buy = buys[bi], sell = sells[si];
    if (buy.agentId === sell.agentId) { si++; continue; }
    if (buy.price < sell.price) break;

    const buyer = agents[buy.agentId];
    const seller = agents[sell.agentId];
    const price = (buy.price + sell.price) / 2;

    if (buyer.cash < price || seller.shares < 1) {
      if (buyer.cash < price) bi++; else si++;
      continue;
    }

    buyer.cash -= price;
    buyer.shares += 1;
    seller.cash += price;
    seller.shares -= 1;

    const trade = {
      buyerId: buy.agentId, sellerId: sell.agentId,
      price, buyBid: buy.price, sellAsk: sell.price,
      buyerBelief: buy.belief, sellerBelief: sell.belief,
    };
    trades.push(trade);
    buyer.trades.push({ ...trade, side: 'buy', period: null });
    seller.trades.push({ ...trade, side: 'sell', period: null });
    bi++; si++;
  }

  const vwap = trades.length > 0
    ? trades.reduce((s, t) => s + t.price, 0) / trades.length : null;
  const bestBid = buys.length > 0 ? buys[0].price : 0;
  const bestAsk = sells.length > 0 ? sells[0].price : 0;
  return { trades, vwap, volume: trades.length, bestBid, bestAsk };
}

/* ================================================================
   Bubble metrics — DLM (2005) Table 2
   ================================================================ */
function bubbleMetrics(prices, fvs, totalShares) {
  const T = prices.length;
  if (T === 0) return { haesselR2: 1, mse: 0, napd: 0, amplitude: 0, turnover: 0 };

  // Haessel-R² = 1 - Σ(P-FV)² / Σ(FV - mean(FV))²
  const ssr = prices.reduce((s, p, i) => s + (p - fvs[i]) ** 2, 0);
  const fvMean = avg(fvs);
  const sst = fvs.reduce((s, f) => s + (f - fvMean) ** 2, 0);
  const haesselR2 = sst > 0 ? Math.max(0, 1 - ssr / sst) : (ssr < 1e-6 ? 1 : 0);

  // MSE
  const mse = ssr / T;

  // Normalized absolute price deviation: Σ|P-FV| / (T × FV(0))
  const fv0 = Math.max(1, fvs[0] || 1);
  const napd = prices.reduce((s, p, i) => s + Math.abs(p - fvs[i]), 0) / (T * fv0);

  // Amplitude: range of (P - FV) / FV(0)
  const diffs = prices.map((p, i) => p - fvs[i]);
  const amplitude = (Math.max(...diffs) - Math.min(...diffs)) / fv0;

  // Turnover: total trades / total shares outstanding
  const turnover = totalShares > 0 ? T / totalShares : 0;

  return { haesselR2, mse, napd, amplitude, turnover };
}

/* ================================================================
   Single-session market run
   ================================================================ */
function runSession(agents, params, g) {
  const { T, expectedDiv } = params;
  const fv0 = fundamentalValue(0, T, expectedDiv);
  const marketSigma = Math.max(1, fv0 * 0.15);

  const prices = [], fvs = [], volumes = [], spreads = [];
  const rounds = [];
  let lastPrice = null, prevPrice = null;

  for (let period = 0; period < T; period++) {
    const fv = fundamentalValue(period, T, expectedDiv);
    fvs.push(fv);

    // Update beliefs
    for (const a of agents) {
      updateAgentBelief(a, period, T, expectedDiv, lastPrice, prevPrice, params, g);
    }

    // Compute orders + match
    const orders = computeOrders(agents, marketSigma);
    shuffle(orders, g);
    const { trades, vwap, volume, bestBid, bestAsk } = matchOrders(orders, agents);

    // Record price (last vwap survives if no trades)
    prevPrice = lastPrice;
    if (vwap != null) lastPrice = vwap;
    prices.push(lastPrice != null ? lastPrice : fv);
    volumes.push(volume);
    spreads.push(Math.max(0, bestAsk - bestBid));

    // Mark trade periods
    for (const tr of trades) {
      const bt = agents[tr.buyerId].trades;
      bt[bt.length - 1].period = period;
      const st = agents[tr.sellerId].trades;
      st[st.length - 1].period = period;
    }

    // Dividend payment to all share-holders
    const div = drawDividend(expectedDiv, g);
    for (const a of agents) {
      const earned = div * a.shares;
      a.cash += earned;
      a.dividendsReceived += earned;
    }

    for (const a of agents) {
      a.wealthHistory.push(a.cash + a.shares * fv);
      a.shareHistory.push(a.shares);
    }

    rounds.push({
      period, fv, dividend: div, trades, vwap, volume,
      bestBid, bestAsk, orders,
    });
  }

  // Final P&L: shares are worthless after period T (FV(T)=0)
  for (const a of agents) {
    a.totalPnL = a.cash - a.initialCash;
  }

  const totalShares = agents.reduce((s, a) => s + a.initialShares, 0);
  const totalTrades = rounds.reduce((s, r) => s + r.volume, 0);
  const metrics = bubbleMetrics(prices, fvs, totalShares);
  metrics.turnover = totalShares > 0 ? totalTrades / totalShares : 0;

  return {
    prices, fvs, volumes, spreads, rounds,
    bubbleMetrics: metrics,
    totalTrades,
  };
}

/* ================================================================
   Main experiment — single market + experience replays (DLM)
   ================================================================ */
function runExperiment(params) {
  const g = mulberry32(params.seed || 42);
  const agents = createAgents(params, g);
  agents.forEach(a => { a.displayName = `${a.id + 1}.${a.name}`; });

  const initialSnapshot = agents.map(a => ({
    id: a.id, name: a.name, displayName: a.displayName,
    expType: a.expType, riskType: a.riskType, gamma: a.gamma,
    cash: a.cash, shares: a.shares, experience: a.experience,
  }));

  // Number of replays: 1 main session + experience replays
  const replays = Math.max(0, params.experienceRounds || 0);
  const sessionResults = [];

  for (let s = 0; s <= replays; s++) {
    // For replays > 0, reset positions but keep experience counter
    if (s > 0) {
      for (const a of agents) {
        a.cash = a.initialCash;
        a.shares = a.initialShares;
        a.trades = [];
        a.wealthHistory = [];
        a.shareHistory = [];
        a.dividendsReceived = 0;
        a.totalPnL = 0;
      }
    }

    const result = runSession(agents, params, g);

    const snapshot = agents.map(a => ({
      id: a.id, name: a.name, displayName: a.displayName,
      expType: a.expType, riskType: a.riskType, gamma: a.gamma,
      experience: a.experience,
      cash: a.cash, shares: a.shares,
      totalPnL: a.totalPnL,
      dividendsReceived: a.dividendsReceived,
    }));

    sessionResults.push({
      session: s + 1,
      experience: agents[0].experience,
      ...result,
      agents: snapshot,
    });

    // Increment experience for next replay
    for (const a of agents) a.experience += 1;
  }

  // Primary session is the first run (all agents at base experience)
  const session = sessionResults[0];

  return {
    initialSnapshot,
    T: params.T,
    expectedDiv: params.expectedDiv,
    fv0: fundamentalValue(0, params.T, params.expectedDiv),
    session,
    sessionResults,
    finalAgents: agents,
    params,
  };
}

/* ================================================================
   Backward-compatible aliases used by ai-agent.js
   ================================================================ */
const createMarketAgents = createAgents;

/* ================================================================
   Trading Floor — Canvas 2D Visualization
   ================================================================ */

/* ---- roundRect polyfill ---- */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rad = Array.isArray(r) ? r : [r, r, r, r];
    this.moveTo(x + rad[0], y);
    this.arcTo(x + w, y, x + w, y + h, rad[1]);
    this.arcTo(x + w, y + h, x, y + h, rad[2]);
    this.arcTo(x, y + h, x, y, rad[3]);
    this.arcTo(x, y, x + w, y, rad[0]);
    this.closePath();
  };
}

/* ---- Sprite ---- */
class Sprite {
  constructor(id, name, expType, riskType, x, y) {
    this.id = id;
    this.name = name;
    this.displayName = `${id + 1}.${name}`;
    this.expType = expType;
    this.riskType = riskType;
    this.x = x; this.y = y;
    this.tx = x; this.ty = y;
    this._gridX = x; this._gridY = y;
    this._moveDelay = 0;
    this.agent = null;
    this.active = false;
    this.pnlFlash = null;
    this.label = '';
  }

  moveTo(x, y) { this.tx = x; this.ty = y; }

  update(dt, speed) {
    if (this._moveDelay > 0) { this._moveDelay -= dt * speed; return; }
    const sp = 4 * speed;
    this.x += (this.tx - this.x) * Math.min(1, sp * dt);
    this.y += (this.ty - this.y) * Math.min(1, sp * dt);
    if (this.pnlFlash) {
      this.pnlFlash.alpha -= dt * 1.5;
      if (this.pnlFlash.alpha <= 0) this.pnlFlash = null;
    }
  }

  draw(ctx, sc, isDark) {
    const r = 12 * sc;
    const { x, y } = this;
    const fgMain = isDark ? '#e6edf3' : '#1a1d23';

    // Body — color by experience type
    const expType = this.agent ? this.agent.expType : this.expType;
    ctx.fillStyle = expType === 'experienced' ? '#2563eb' : '#dc2626';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (this.active) {
      ctx.strokeStyle = '#FFD60A';
      ctx.lineWidth = 2.5 * sc;
      ctx.beginPath();
      ctx.arc(x, y, r + 3 * sc, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Face
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - 3.5 * sc, y - 2 * sc, 1.8 * sc, 0, Math.PI * 2);
    ctx.arc(x + 3.5 * sc, y - 2 * sc, 1.8 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y + 2.5 * sc, 3.5 * sc, 0, Math.PI);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * sc;
    ctx.stroke();

    // Name pill (below body) — width depends only on the name, never on PnL
    const nameText = this.displayName;
    ctx.font = `600 ${8 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    const nameW = ctx.measureText(nameText).width;
    const pillW = nameW + 10 * sc;
    const ny = y + r + 12 * sc;

    ctx.fillStyle = isDark ? 'rgba(22,27,34,0.85)' : 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.roundRect(x - pillW / 2, ny - 8 * sc, pillW, 11 * sc, 3 * sc);
    ctx.fill();

    ctx.fillStyle = fgMain;
    ctx.fillText(nameText, x, ny);

    // PnL flash floats ABOVE the body, centered on the agent — no horizontal bleed
    if (this.pnlFlash) {
      const pf = this.pnlFlash;
      const pnlText = (pf.value >= 0 ? '+' : '') + pf.value.toFixed(0);
      const pnlColor = pf.value >= 0 ? '#34C759' : '#FF3B30';
      ctx.globalAlpha = Math.min(1, pf.alpha);
      ctx.font = `700 ${8 * sc}px monospace`;
      const pnlW = ctx.measureText(pnlText).width;
      const bw = pnlW + 8 * sc, bh = 12 * sc;
      const py = y - r - bh / 2 - 4 * sc;
      ctx.fillStyle = pf.value >= 0 ? 'rgba(52,199,89,0.18)' : 'rgba(255,59,48,0.18)';
      ctx.strokeStyle = pnlColor;
      ctx.lineWidth = 1 * sc;
      ctx.beginPath();
      ctx.roundRect(x - bw / 2, py - bh / 2, bw, bh, 3 * sc);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = pnlColor;
      ctx.textBaseline = 'middle';
      ctx.fillText(pnlText, x, py);
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }
  }
}

/* ---- Building definitions — DLM/Lopez-Lira pipeline stages ---- */
const BASE_W = 520;
const CELL_W = 60;  // unscaled per-agent cell width
const CELL_H = 68;  // unscaled per-agent cell height
const BUILDINGS = [
  { id: 'hub',    label: 'gw.hub',    w: BASE_W, h: 200, color: '#E8F5E9', darkColor: '#1a2e1a', phaseNum: '1' },
  { id: 'signal', label: 'gw.signal', w: BASE_W, h: 200, color: '#E3F2FD', darkColor: '#1a2540', phaseNum: '2' },
  { id: 'pit',    label: 'gw.pit',    w: BASE_W, h: 360, color: '#FFF3E0', darkColor: '#2d2614', _stageH: 90, phaseNum: '3' },
  { id: 'settle', label: 'gw.settle', w: BASE_W, h: 220, color: '#FFFDE7', darkColor: '#2d2a14', phaseNum: '4' },
];

class TradingFloor {
  constructor(canvas, history) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.history = history;
    this.sprites = [];
    this.running = false;
    this.paused = false;
    this.speed = 1;
    this._scale = 1;
    this._camX = 0; this._camY = 200;
    this._camZoom = 1;
    this._camTarget = null;
    this._camFollow = true;
    this._initialZoomSet = false;
    this._animFrame = null;
    this._lastTime = 0;
    this._phase = 'idle';
    this._buildingMap = {};

    this._priceHistory = [];
    this._lastPrice = null;
    this._orderBook = { bids: [], asks: [] };
    this._bubblePct = 0;
    this._roundNum = 0;

    this._initBuildings();
    this._initSprites();
    this._setupInput();
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _initBuildings() {
    const n = this.history.agents.length;
    const cols = Math.ceil(Math.sqrt(n * 1.5));
    const rows = Math.ceil(n / cols);
    const sc = Math.max(0.6, Math.min(1, 10 / Math.sqrt(n)));
    this._scale = sc;

    const uniformW = Math.max(BASE_W, cols * CELL_W * sc + 60);

    for (const b of BUILDINGS) {
      const copy = { ...b };
      copy.w = uniformW;
      if (b.id === 'hub' || b.id === 'signal' || b.id === 'settle') {
        copy.h = Math.max(b.h, rows * CELL_H * sc + 60);
      }
      if (b.id === 'pit') {
        const chartH = 70;
        copy._chartH = chartH;
        copy._stageH = Math.max(90, 70 * sc + 30);
        copy.h = Math.max(b.h, rows * CELL_H * sc + 60 + chartH + copy._stageH);
      }
      this._buildingMap[copy.id] = copy;
    }

    const GAP = 30;
    let y = 0;
    for (const id of ['hub', 'signal', 'pit', 'settle']) {
      const b = this._buildingMap[id];
      if (!b) continue;
      b.x = 0;
      b.y = y + b.h / 2;
      y += b.h + GAP;
    }
  }

  _initSprites() {
    const agents = this.history.agents;
    for (const a of agents) {
      const expType = a.expType || 'inexperienced';
      const sp = new Sprite(a.id, a.name, expType, a.riskType, 0, 0);
      sp.agent = a;
      sp.displayName = a.displayName || `${a.id + 1}.${a.name}`;
      sp.label = expType === 'experienced' ? t('info.experienced') : t('info.inexperienced');
      this.sprites.push(sp);
    }
  }

  _setupInput() {
    const cv = this.canvas;
    let dragging = false, dragSX, dragSY, dragOX, dragOY, lastPinch = 0;

    cv.addEventListener('mousedown', e => {
      dragging = true; dragSX = e.clientX; dragSY = e.clientY;
      dragOX = this._camX; dragOY = this._camY;
      cv.style.cursor = 'grabbing'; this._camFollow = false;
      this._ensureDrawing();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      this._camX = dragOX - (e.clientX - dragSX) / this._camZoom;
      this._camY = dragOY - (e.clientY - dragSY) / this._camZoom;
      this._ensureDrawing();
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; cv.style.cursor = 'grab'; } });

    cv.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        dragging = true; dragSX = e.touches[0].clientX; dragSY = e.touches[0].clientY;
        dragOX = this._camX; dragOY = this._camY; this._camFollow = false;
        this._ensureDrawing();
      } else if (e.touches.length === 2) {
        dragging = false;
        lastPinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    cv.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && dragging) {
        this._camX = dragOX - (e.touches[0].clientX - dragSX) / this._camZoom;
        this._camY = dragOY - (e.touches[0].clientY - dragSY) / this._camZoom;
        this._ensureDrawing();
      } else if (e.touches.length === 2 && lastPinch > 0) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const z = clamp(this._camZoom * (dist / lastPinch), 0.3, 5);
        this._camZoom = z;
        if (this._camTarget) this._camTarget.zoom = z;
        lastPinch = dist;
      }
    }, { passive: true });
    cv.addEventListener('touchend', () => { dragging = false; lastPinch = 0; }, { passive: true });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const z = clamp(this._camZoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.3, 5);
      this._camZoom = z;
      if (this._camTarget) this._camTarget.zoom = z;
      this._ensureDrawing();
    }, { passive: false });

    cv.style.cursor = 'grab';
  }

  _resize() {
    const cv = this.canvas;
    const w = cv.parentElement.clientWidth || 800;
    const h = Math.max(480, cv.parentElement.clientHeight || 480);
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    if (!this._initialZoomSet) {
      this._initialZoomSet = true;
      const bw = this._buildingMap.hub ? this._buildingMap.hub.w : BASE_W;
      const fitZoom = w / ((bw + 80) * this._scale);
      this._camZoom = clamp(fitZoom, 0.5, 3);
    }
  }

  /* ---- Arrangement helpers ---- */
  _arrangeIn(buildingId, list, stagger) {
    const b = this._buildingMap[buildingId];
    if (!b) return;
    const sc = this._scale;
    const headerH = 28;
    const chartH = b._chartH || 0;
    const stageH = b._stageH || 0;
    const padX = 24, padY = 16;
    const cellW = CELL_W * sc, cellH = CELL_H * sc;
    const areaTop = b.y - b.h / 2 + headerH + chartH + stageH;
    const areaW = b.w - padX * 2;
    const cols = Math.max(1, Math.floor(areaW / cellW));
    const perDelay = stagger !== false ? Math.min(0.035, 0.5 / Math.max(1, list.length)) : 0;

    list.forEach((sp, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const gx = b.x - b.w / 2 + padX + cellW / 2 + col * cellW;
      const gy = areaTop + padY + cellH / 2 + row * cellH;
      sp._gridX = gx; sp._gridY = gy;
      sp.moveTo(gx, gy);
      sp._moveDelay = perDelay * i;
    });
  }

  _stageCenter(buildingId) {
    const b = this._buildingMap[buildingId];
    const headerH = 28;
    const chartH = b._chartH || 0;
    const stageH = b._stageH || 80;
    return { x: b.x, y: b.y - b.h / 2 + headerH + chartH + stageH / 2 + 5 };
  }

  _focusBuilding(id) {
    if (!this._camFollow) return;
    const b = this._buildingMap[id];
    if (!b) return;
    const w = this.canvas.width / devicePixelRatio;
    const zoom = Math.min(1.8, w / ((b.w + 80) * this._scale));
    this._camTarget = { x: b.x, y: b.y, zoom };
  }

  _focusStage(id) {
    if (!this._camFollow) return;
    const b = this._buildingMap[id];
    if (!b) return;
    const stageY = b.y - b.h / 2 + 28 + (b._stageH || 80) / 2;
    const w = this.canvas.width / devicePixelRatio;
    const zoom = Math.min(1.8, w / ((b.w + 40) * this._scale));
    this._camTarget = { x: b.x, y: stageY - 40, zoom };
  }

  _wait(ms) {
    return new Promise(resolve => {
      const check = () => {
        if (!this.running) return resolve();
        if (this.paused) { setTimeout(check, 50); return; }
        setTimeout(resolve, Math.max(10, ms / this.speed));
      };
      check();
    });
  }

  /* ---- Drawing ---- */
  _draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const isDark = typeof _isDark === 'function' && _isDark();

    ctx.fillStyle = isDark ? '#0d1117' : '#f0f2f5';
    ctx.fillRect(0, 0, W, H);

    if (this._camTarget) {
      this._camX += (this._camTarget.x - this._camX) * 0.12;
      this._camY += (this._camTarget.y - this._camY) * 0.12;
      this._camZoom += (this._camTarget.zoom - this._camZoom) * 0.12;
    }

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(this._camZoom, this._camZoom);
    ctx.translate(-this._camX, -this._camY);

    this._drawConnections(ctx, isDark);
    this._drawBuildings(ctx, isDark);
    this._drawPriceDisplay(ctx, isDark);
    this._drawBubbleMeter(ctx, isDark);

    const sc = this._scale;
    for (const sp of this.sprites) sp.draw(ctx, sc, isDark);

    ctx.restore();
  }

  _drawConnections(ctx, isDark) {
    const flow = ['hub', 'signal', 'pit', 'settle'];
    const arrowColor = isDark ? 'rgba(37,99,235,0.5)' : 'rgba(37,99,235,0.6)';
    const textColor = isDark ? 'rgba(37,99,235,0.4)' : 'rgba(37,99,235,0.5)';
    const sc = this._scale;

    for (let i = 0; i < flow.length - 1; i++) {
      const from = this._buildingMap[flow[i]];
      const to = this._buildingMap[flow[i + 1]];
      if (!from || !to) continue;

      const x = from.x;
      const y1 = from.y + from.h / 2;
      const y2 = to.y - to.h / 2;
      const midY = (y1 + y2) / 2;

      ctx.strokeStyle = arrowColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y1 + 2);
      ctx.lineTo(x, y2 - 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const ah = 8;
      ctx.fillStyle = arrowColor;
      ctx.beginPath();
      ctx.moveTo(x, y2 - 2);
      ctx.lineTo(x - ah / 2, y2 - ah - 2);
      ctx.lineTo(x + ah / 2, y2 - ah - 2);
      ctx.closePath();
      ctx.fill();

      const labels = ['Calibrate \u03b3', 'Form Beliefs', 'Match Orders'];
      ctx.fillStyle = textColor;
      ctx.font = `600 ${8 * sc}px -apple-system, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(labels[i] || '', x + 12, midY + 3);
    }
  }

  _drawBuildings(ctx, isDark) {
    const sc = this._scale;
    for (const b of Object.values(this._buildingMap)) {
      const x = b.x - b.w / 2, y = b.y - b.h / 2;

      ctx.fillStyle = isDark ? (b.darkColor || '#1c2129') : (b.color || '#f0f0f0');
      ctx.globalAlpha = isDark ? 0.6 : 0.35;
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, b.h, 12);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, b.h, 12);
      ctx.stroke();

      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, 28, [12, 12, 0, 0]);
      ctx.fill();

      ctx.fillStyle = isDark ? '#e6edf3' : '#1a1d23';
      ctx.font = `700 ${12 * sc}px -apple-system, sans-serif`;
      ctx.textAlign = 'left';

      if (b.phaseNum) {
        const bx = x + 10, by = y + 5;
        ctx.fillStyle = isDark ? 'rgba(37,99,235,0.3)' : 'rgba(37,99,235,0.15)';
        ctx.beginPath();
        ctx.arc(bx + 8, by + 9, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = isDark ? '#93c5fd' : '#2563eb';
        ctx.font = `700 ${9 * sc}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(b.phaseNum, bx + 8, by + 12);
        ctx.textAlign = 'left';
        ctx.fillStyle = isDark ? '#e6edf3' : '#1a1d23';
        ctx.font = `700 ${12 * sc}px -apple-system, sans-serif`;
        ctx.fillText(t(b.label), bx + 22, y + 19);
      } else {
        ctx.fillText(t(b.label), x + 12, y + 19);
      }

      if (b.id === 'pit') {
        const chartH = b._chartH || 0;
        const stageH = b._stageH || 0;

        if (stageH) {
          const sy = y + 28 + chartH;
          ctx.fillStyle = isDark ? 'rgba(37,99,235,0.08)' : 'rgba(0,122,255,0.06)';
          ctx.fillRect(x + 2, sy, b.w - 4, stageH);

          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = isDark ? 'rgba(37,99,235,0.2)' : 'rgba(0,122,255,0.2)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 8, sy + stageH);
          ctx.lineTo(x + b.w - 8, sy + stageH);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = isDark ? 'rgba(37,99,235,0.3)' : 'rgba(0,122,255,0.4)';
          ctx.font = `600 ${8 * sc}px -apple-system, sans-serif`;
          ctx.textAlign = 'right';
          ctx.fillText(t('gw.stage'), x + b.w - 10, sy + 13);
          ctx.fillText(t('gw.queue'), x + b.w - 10, sy + stageH + 15);
        }
      }
    }
  }

  _drawPriceDisplay(ctx, isDark) {
    if (this._priceHistory.length === 0) return;
    const pit = this._buildingMap.pit;
    if (!pit || !pit._chartH) return;
    const sc = this._scale;
    const chartH = pit._chartH;
    const pad = 6;
    const panelW = (pit.w - pad * 3) / 2;
    const panelH = chartH - pad * 2;
    const px = pit.x - pit.w / 2 + pad;
    const baseY = pit.y - pit.h / 2 + 28 + pad;

    ctx.fillStyle = isDark ? 'rgba(22,27,34,0.9)' : 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, baseY, panelW, panelH, 6);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = isDark ? '#e6edf3' : '#1d1d1f';
    ctx.font = `700 ${9 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('PRICE', px + 6, baseY + 13);

    const prices = this._priceHistory;
    const fvs = this.history.fvs || [];
    const tv = fvs.length > 0 ? fvs[Math.min(this._roundNum, fvs.length - 1)] : 100;
    const allVals = [...prices, ...fvs];
    const minP = Math.min(...allVals) * 0.8;
    const maxP = Math.max(...allVals) * 1.2;
    const range = maxP - minP || 1;
    const cX = px + 6, cY = baseY + 18, cW = panelW - 12, cH = panelH - 26;

    if (fvs.length > 1) {
      ctx.strokeStyle = 'rgba(52,199,89,0.5)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      for (let i = 0; i < fvs.length; i++) {
        const cx = cX + (i / Math.max(1, fvs.length - 1)) * cW;
        const cy = cY + cH - ((fvs[i] - minP) / range) * cH;
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < prices.length; i++) {
      const cx = cX + (i / Math.max(1, prices.length - 1)) * cW;
      const cy = cY + cH - ((prices[i] - minP) / range) * cH;
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    const last = prices[prices.length - 1];
    ctx.fillStyle = last > tv ? '#FF3B30' : '#34C759';
    ctx.font = `700 ${10 * sc}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText('$' + last.toFixed(1), px + panelW - 6, baseY + 13);
  }

  _drawBubbleMeter(ctx, isDark) {
    if (this._priceHistory.length === 0) return;
    const pit = this._buildingMap.pit;
    if (!pit || !pit._chartH) return;
    const sc = this._scale;
    const chartH = pit._chartH;
    const pad = 6;
    const panelW = (pit.w - pad * 3) / 2;
    const panelH = chartH - pad * 2;
    const bx = pit.x - pit.w / 2 + pad * 2 + panelW;
    const baseY = pit.y - pit.h / 2 + 28 + pad;

    ctx.fillStyle = isDark ? 'rgba(22,27,34,0.9)' : 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, baseY, panelW, panelH, 6);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = isDark ? '#e6edf3' : '#1d1d1f';
    ctx.font = `700 ${9 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('BUBBLE', bx + 6, baseY + 13);

    const barX = bx + 6, barY = baseY + 20, barW = panelW - 12, barH = 12;
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 3);
    ctx.fill();

    const pct = clamp(this._bubblePct, -1, 1);
    const mid = barX + barW / 2;
    const fillW = Math.abs(pct) * barW / 2;
    ctx.fillStyle = pct > 0 ? 'rgba(255,59,48,0.6)' : 'rgba(52,199,89,0.6)';
    if (pct > 0) ctx.fillRect(mid, barY, fillW, barH);
    else ctx.fillRect(mid - fillW, barY, fillW, barH);

    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid, barY - 2);
    ctx.lineTo(mid, barY + barH + 2);
    ctx.stroke();

    ctx.fillStyle = pct > 0 ? '#FF3B30' : '#34C759';
    ctx.font = `700 ${9 * sc}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText((pct > 0 ? '+' : '') + (pct * 100).toFixed(1) + '%', bx + panelW / 2, baseY + panelH - 5);
  }

  _ensureDrawing() {
    if (this.running) return;
    if (this._idleFrame) return;
    this._idleFrame = requestAnimationFrame(() => {
      this._idleFrame = null;
      this._draw();
    });
  }

  _loop(time) {
    if (!this.running) return;
    const dt = Math.min(0.05, (time - this._lastTime) / 1000);
    this._lastTime = time;

    for (const sp of this.sprites) sp.update(dt, this.speed);
    this._draw();

    if (this._phase === 'done') {
      this._doneTimer = (this._doneTimer || 0) + dt;
      if (this._doneTimer > 4) {
        this.running = false;
        this._draw();
        return;
      }
    }

    this._animFrame = requestAnimationFrame(t => this._loop(t));
  }

  start() {
    this.running = true;
    this._doneTimer = 0;
    this._lastTime = performance.now();
    this._loop(this._lastTime);
    this._playGame();
  }

  stop() {
    this.running = false;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }

  togglePause() { this.paused = !this.paused; }
  setFollow(f) { this._camFollow = f; }
  setZoom(z) { this._camZoom = z; }

  /* ---- Game sequence ---- */
  async _playGame() {
    const history = this.history;
    const agents = history.agents;
    const rounds = history.rounds;

    // Phase 1: Hub
    this._phase = 'hub';
    this._arrangeIn('hub', this.sprites, true);
    this._focusBuilding('hub');
    this._log('phase', '1. Trader Initialization', `${agents.length} CARA agents — \u03b3 drawn, endowments allocated`);
    await this._wait(1500);

    // Phase 2: Belief formation
    this._phase = 'signal';
    this._arrangeIn('signal', this.sprites, true);
    this._focusBuilding('signal');
    this._log('phase', '2. Belief Formation', 'Experienced track FV(t) (DLM \u03b1); inexperienced anchor on FV(0) with weight 0.5^e');
    await this._wait(1000);

    const fv0 = (history.fvs && history.fvs[0]) || 100;
    for (const sp of this.sprites) {
      const isExp = sp.agent.expType === 'experienced';
      const belief = sp.agent.belief != null ? sp.agent.belief : fv0;
      sp.pnlFlash = { value: belief - fv0, alpha: 2.0 };
      sp.label = isExp ? t('info.experienced') : t('info.inexperienced');
    }
    await this._wait(2000);

    // Phase 3: Trading rounds
    this._phase = 'trading';
    this._arrangeIn('pit', this.sprites, true);
    this._focusBuilding('pit');
    this._log('phase', '3. Continuous Double Auction', `${rounds.length} periods — bid \u2265 ask matching at reservation prices`);
    await this._wait(1000);

    const totalRounds = rounds.length;
    const stepScale = totalRounds <= 10 ? 1.0 : totalRounds <= 30 ? 0.6 : 0.3;

    for (let r = 0; r < totalRounds; r++) {
      if (!this.running) return;
      this._roundNum = r + 1;
      const rd = rounds[r];

      if (rd.trades && rd.trades.length > 0) {
        const stage = this._stageCenter('pit');
        const nAnimate = Math.min(rd.trades.length, 5);

        for (let ti = 0; ti < nAnimate; ti++) {
          const trade = rd.trades[ti];
          const buyer = this.sprites[trade.buyerId];
          const seller = this.sprites[trade.sellerId];
          if (!buyer || !seller) continue;

          buyer.active = true;
          seller.active = true;
          buyer.moveTo(stage.x - 25, stage.y);
          seller.moveTo(stage.x + 25, stage.y);
          await this._wait(Math.round(400 * stepScale));

          const fvNow = (history.fvs && history.fvs[r]) || 100;
          const buyPnL = fvNow - trade.price;
          const sellPnL = trade.price - fvNow;
          buyer.pnlFlash = { value: buyPnL, alpha: 1.5 };
          seller.pnlFlash = { value: sellPnL, alpha: 1.5 };
          await this._wait(Math.round(300 * stepScale));

          buyer.active = false;
          seller.active = false;
          buyer.moveTo(buyer._gridX, buyer._gridY);
          seller.moveTo(seller._gridX, seller._gridY);
        }

        if (rd.vwap != null) {
          this._priceHistory.push(rd.vwap);
          this._lastPrice = rd.vwap;
          const fvNow = (history.fvs && history.fvs[r]) || 100;
          this._bubblePct = fvNow > 0 ? (rd.vwap - fvNow) / fvNow : 0;
        }

        this._log('round', `Round ${r + 1}: ${rd.trades.length} trades @ $${(rd.vwap || 0).toFixed(2)}`);
      } else {
        this._log('round', `Round ${r + 1}: No trades`);
      }

      this._focusBuilding('pit');
      await this._wait(Math.round(500 * stepScale));
    }

    // Phase 4: Settlement
    this._phase = 'settle';
    this._arrangeIn('settle', this.sprites, true);
    this._focusBuilding('settle');
    this._log('phase', '4. Dividend Settlement', 'Period payoffs paid; total P&L realised');
    await this._wait(1000);

    for (const sp of this.sprites) {
      const pnl = sp.agent.totalPnL || 0;
      sp.pnlFlash = { value: pnl, alpha: 3.0 };
      sp.label = `P&L: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}`;
    }

    const bubble = history.bubble || {};
    this._log('summary', 'Simulation Complete', [
      `Haessel-R\u00b2: ${(bubble.haesselR2 || 0).toFixed(3)}`,
      `NAPD: ${(bubble.napd || 0).toFixed(3)}`,
      `Total Trades: ${rounds.reduce((s, r) => s + (r.volume || 0), 0)}`,
    ].join(' | '));

    this._phase = 'done';
  }

  _log(type, title, detail) {
    if (typeof window._gameLog === 'function') {
      window._gameLog(type, title, detail);
    }
  }
}
