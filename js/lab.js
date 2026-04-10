/**
 * Lab Experiment Engine — Merged Framework
 * ==========================================
 * Primary:  Lopez-Lira (2025) "Can LLMs Trade?"
 *           — CARA utility agents, CDA matching, heterogeneous preferences
 * Extended: Henning et al. (2025) "LLM Trading"
 *           — Declining fundamental value, dividends, interest, bubble metrics,
 *             hypothesis classification (R/H/E)
 *           Dufwenberg, Lindqvist & Moore (2005, AER) "Bubbles and Experience"
 *           — Experience sessions, mixed-experience markets, experience effect
 *
 * Research questions:
 *   1. Does the asset flow to the highest-valuation agent? (Coase theorem)
 *   2. Do bubbles diminish with experience? (Dufwenberg result)
 *   3. Does communication help or hinder price discovery?
 */

/* ================================================================
   CARA Utility — Lopez-Lira (2025)
   U(W) = -exp(-gamma*W)/gamma   for gamma != 0
   U(W) = W                      for gamma = 0 (risk-neutral)
   ================================================================ */

function caraUtility(W, gamma) {
  if (Math.abs(gamma) < 1e-8) return W;
  return -Math.exp(-gamma * W) / gamma;
}

function caraCE(eu, gamma) {
  if (Math.abs(gamma) < 1e-8) return eu;
  const inner = -gamma * eu;
  if (inner <= 0) return 1e6;
  return -Math.log(inner) / gamma;
}

/* ================================================================
   Fundamental Value Model — Henning (2025) / Dufwenberg (2005)
   FV = E[div] / interest_rate  (constant benchmark)
   Dividends: stochastic per round {divLow, divHigh} with equal prob
   Interest: cash earns interestRate per round
   ================================================================ */

function computeFundamentalValue(params) {
  const eDividend = (params.divLow + params.divHigh) / 2;
  return eDividend / params.interestRate;
}

function drawDividend(params, g) {
  return g() < 0.5 ? params.divLow : params.divHigh;
}

/* ================================================================
   Agent Creation — Lopez-Lira + Dufwenberg experience
   ================================================================ */

const LAB_GAMMA = {
  risk_loving:  { lo: -0.008, hi: 0.002 },
  risk_neutral: { lo: 0.002,  hi: 0.012 },
  risk_averse:  { lo: 0.012,  hi: 0.060 },
};

function createLabAgents(params, g) {
  const {
    n, baseValue, valSpread, rlPct, rnPct,
    cashMean, sharesMean, endowVar, experienceRounds,
  } = params;

  const nRL = Math.round(n * rlPct / 100);
  const nRN = Math.round(n * rnPct / 100);
  const nRA = n - nRL - nRN;

  const riskArr = [];
  for (let i = 0; i < nRL; i++) riskArr.push('risk_loving');
  for (let i = 0; i < nRN; i++) riskArr.push('risk_neutral');
  for (let i = 0; i < nRA; i++) riskArr.push('risk_averse');
  shuffle(riskArr, g);

  const agents = [];

  for (let i = 0; i < n; i++) {
    const rt = riskArr[i];
    const gp = LAB_GAMMA[rt];
    const gamma = gp.lo + (gp.hi - gp.lo) * g();

    // Psychological valuation: beta-like spread around baseValue
    const u1 = g(), u2 = g();
    const psi = Math.max(1, baseValue + valSpread * (u1 + u2 - 1));

    // Heterogeneous endowments
    const cashMul = Math.max(0.3, 1 + endowVar * randn(g));
    const shareMul = Math.max(0, 1 + endowVar * randn(g));

    agents.push({
      id: i,
      name: AGENT_NAMES[i] || `A${i}`,
      riskType: rt,
      gamma,
      psi,                                    // true private valuation
      effectivePsi: psi,                      // trading valuation (may shift from comm)
      cash: Math.max(50, Math.round(cashMean * cashMul)),
      shares: Math.max(0, Math.round(sharesMean * shareMul)),
      initialCash: 0,
      initialShares: 0,
      experience: 0,                          // Dufwenberg: experience level (session count)
      trades: [],
      wealthHistory: [],
      shareHistory: [],
      dividendsReceived: 0,
      interestEarned: 0,
    });
  }

  // Record initial state
  for (const a of agents) {
    a.initialCash = a.cash;
    a.initialShares = a.shares;
  }

  return agents;
}

/* ================================================================
   Reservation Prices — Lopez-Lira CARA + FV adjustment
   bid = effectivePsi - |gamma| * sigma^2 / 2
   ask = effectivePsi + |gamma| * sigma^2 / 2
   ================================================================ */

function reservationBid(agent, marketUncertainty) {
  const sigma = marketUncertainty || Math.max(1, agent.effectivePsi * 0.15);
  const riskPremium = agent.gamma * sigma * sigma / 2;
  return Math.max(0.01, agent.effectivePsi - riskPremium);
}

function reservationAsk(agent, marketUncertainty) {
  const sigma = marketUncertainty || Math.max(1, agent.effectivePsi * 0.15);
  const riskPremium = agent.gamma * sigma * sigma / 2;
  return Math.max(0.01, agent.effectivePsi + riskPremium);
}

/* ================================================================
   Lab CDA Matching Engine — Lopez-Lira
   ================================================================ */

function computeLabOrders(agents, marketUncertainty) {
  const orders = [];
  for (const a of agents) {
    const bid = reservationBid(a, marketUncertainty);
    const ask = reservationAsk(a, marketUncertainty);
    orders.push({
      agentId: a.id,
      bid, ask,
      psi: a.effectivePsi,
      wantsBuy: a.cash >= bid * 0.5,
      wantsSell: a.shares > 0,
    });
  }
  return orders;
}

function matchLabOrders(orders, agents) {
  const buys = orders
    .filter(o => o.wantsBuy && agents[o.agentId].cash >= o.bid * 0.5)
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
    const execPrice = (buy.price + sell.price) / 2;

    if (buyer.cash < execPrice || seller.shares < 1) {
      if (buyer.cash < execPrice) bi++; else si++;
      continue;
    }

    buyer.cash -= execPrice;
    buyer.shares += 1;
    seller.cash += execPrice;
    seller.shares -= 1;

    const trade = {
      buyerId: buy.agentId, sellerId: sell.agentId, price: execPrice,
      buyerPsi: agents[buy.agentId].psi, sellerPsi: agents[sell.agentId].psi,
      buyerBid: buy.price, sellerAsk: sell.price,
    };
    trades.push(trade);
    buyer.trades.push({ ...trade, side: 'buy' });
    seller.trades.push({ ...trade, side: 'sell' });
    bi++; si++;
  }

  const vwap = trades.length > 0
    ? trades.reduce((s, t) => s + t.price, 0) / trades.length : null;
  const bestBid = buys.length > 0 ? buys[0].price : 0;
  const bestAsk = sells.length > 0 ? sells[0].price : 0;

  return { trades, vwap, volume: trades.length, bestBid, bestAsk };
}

/* ================================================================
   Naive Communication Model
   ================================================================
   Simple pre-trade signal exchange: each agent broadcasts a noisy
   version of their private valuation ψ.  Receivers average others'
   signals and blend with their own ψ (weight = signalWeight param).
   No game-theoretic classification — just truthful ± noise.
   ================================================================ */

function naiveCommunication(agents, lastPrice, g, params) {
  const noise = params.commNoise ?? 0.10;       // ±10 % noise on signal
  const weight = params.signalWeight ?? 0.20;    // how much receivers trust signals
  const messages = [];

  // Each agent broadcasts ψ + noise
  for (const a of agents) {
    const reported = Math.max(0.01, a.psi * (1 + noise * randn(g)));
    messages.push({
      senderId: a.id,
      reported,
      truePsi: a.psi,
      riskType: a.riskType,
    });
  }

  // Receivers blend own ψ with average signal
  for (const a of agents) {
    const otherMsgs = messages.filter(m => m.senderId !== a.id);
    if (otherMsgs.length === 0) continue;
    const avgSignal = avg(otherMsgs.map(m => m.reported));
    const w = clamp(weight, 0, 0.5);
    a.effectivePsi = a.psi * (1 - w) + avgSignal * w;
  }

  return messages;
}

/* ================================================================
   Allocation Efficiency Metrics
   ================================================================ */

function computeWelfare(agents) {
  return agents.reduce((s, a) => s + a.psi * a.shares, 0);
}

function computeMaxWelfare(agents) {
  const totalShares = agents.reduce((s, a) => s + a.shares, 0);
  const sorted = [...agents].sort((a, b) => b.psi - a.psi);
  return sorted[0].psi * totalShares;
}

function computeMinWelfare(agents) {
  const totalShares = agents.reduce((s, a) => s + a.shares, 0);
  const sorted = [...agents].sort((a, b) => a.psi - b.psi);
  return sorted[0].psi * totalShares;
}

function allocativeEfficiency(agents) {
  const w = computeWelfare(agents);
  const wMax = computeMaxWelfare(agents);
  const wMin = computeMinWelfare(agents);
  const denom = wMax - wMin;
  return denom > 0 ? clamp((w - wMin) / denom, 0, 1) : 1;
}

function psiShareCorrelation(agents) {
  const n = agents.length;
  if (n < 2) return 0;
  const ranked = (arr) => {
    const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    sorted.forEach((s, r) => { ranks[s.i] = r + 1; });
    return ranks;
  };
  const psiRanks = ranked(agents.map(a => a.psi));
  const shareRanks = ranked(agents.map(a => a.shares));
  const dSq = psiRanks.reduce((s, r, i) => s + (r - shareRanks[i]) ** 2, 0);
  return 1 - (6 * dSq) / (n * (n * n - 1));
}

function topKConcentration(agents, k) {
  const totalShares = agents.reduce((s, a) => s + a.shares, 0);
  if (totalShares === 0) return 0;
  const sorted = [...agents].sort((a, b) => b.psi - a.psi);
  const topShares = sorted.slice(0, k || Math.ceil(agents.length * 0.25))
    .reduce((s, a) => s + a.shares, 0);
  return topShares / totalShares;
}

/* ================================================================
   Bubble Metrics — Henning (2025) / Dufwenberg (2005)
   ================================================================ */

/**
 * Haessel-R^2: goodness-of-fit between prices and fundamental values
 * Tends to 1 when prices = FV (rational behavior)
 */
function haesselR2(prices, fvs) {
  const n = prices.length;
  if (n === 0) return 0;
  const meanFV = avg(fvs);
  const ssRes = prices.reduce((s, p, i) => s + (p - fvs[i]) ** 2, 0);
  const ssTot = fvs.reduce((s, f) => s + (f - meanFV) ** 2, 0);
  if (ssTot === 0) return ssRes === 0 ? 1 : 0;
  return 1 - ssRes / ssTot;
}

/**
 * MSE from fundamental value — Henning (2025) Table 1
 */
function mseFundamental(prices, fvs) {
  if (prices.length === 0) return 0;
  return prices.reduce((s, p, i) => s + (p - fvs[i]) ** 2, 0) / prices.length;
}

/**
 * Normalized Absolute Price Deviation — Dufwenberg (2005) Table 2
 * Sum of |price - FV| / total shares outstanding
 */
function normalizedAbsPriceDev(prices, fvs, totalShares) {
  if (prices.length === 0 || totalShares === 0) return 0;
  return prices.reduce((s, p, i) => s + Math.abs(p - fvs[i]), 0) / totalShares;
}

/**
 * Price Amplitude — Dufwenberg (2005) Table 2
 * (max deviation - min deviation) / initial FV
 */
function priceAmplitude(prices, fvs) {
  if (prices.length === 0 || fvs[0] === 0) return 0;
  const devs = prices.map((p, i) => p - fvs[i]);
  return (Math.max(...devs) - Math.min(...devs)) / fvs[0];
}

/**
 * Turnover — Dufwenberg (2005)
 * Total trades / total shares outstanding
 */
function turnover(totalTrades, totalShares) {
  return totalShares > 0 ? totalTrades / totalShares : 0;
}

/**
 * Hypothesis Classification — Henning (2025) Section 4.1.1
 * R (Rational): MSE < threshold, prices near FV
 * H (Human): bubble-like dynamics, higher PCC with human average
 * E (Erratic): no consistent pattern
 */
function classifyHypothesis(mse, amplitude, napd) {
  if (mse < 2 && amplitude < 0.5) return 'R';  // Rational
  if (amplitude > 0.3 && napd > 0.5) return 'H';  // Human-like bubbles
  return 'E';  // Erratic
}

/* ================================================================
   Run Single Lab Phase (multiple CDA rounds)
   — with dividends, interest, and configurable communication
   ================================================================ */

function runLabPhase(agents, params, g, withComm) {
  const { labRounds, interestRate, divLow, divHigh } = params;
  const prices = [], volumes = [], spreads = [], fvs = [];
  const rounds = [];
  const welfareTrack = [];
  const dividends = [];
  let lastPrice = null;

  // FV is constant (Henning model)
  const fv = computeFundamentalValue(params);

  // Market uncertainty estimate
  const psiArr = agents.map(a => a.psi);
  const psiStd = Math.sqrt(avg(psiArr.map(v => (v - avg(psiArr)) ** 2)));
  const marketSigma = Math.max(1, psiStd * 0.5);
  const totalShares = agents.reduce((s, a) => s + a.shares, 0);

  for (let r = 0; r < labRounds; r++) {
    // Reset effective psi to true psi
    for (const a of agents) a.effectivePsi = a.psi;

    // === Dividend payment (Henning: stochastic each round) ===
    const div = drawDividend(params, g);
    dividends.push(div);
    for (const a of agents) {
      const divPayment = div * a.shares;
      a.cash += divPayment;
      a.dividendsReceived += divPayment;
    }

    // === Interest on cash (Henning: 5% per period) ===
    for (const a of agents) {
      const interest = a.cash * interestRate;
      a.cash += interest;
      a.interestEarned += interest;
    }

    fvs.push(fv);

    // === Communication phase (naive signal exchange, if enabled) ===
    let messages = null;
    if (withComm) {
      messages = naiveCommunication(agents, lastPrice, g, params);
    }

    // Compute orders
    const orders = computeLabOrders(agents, marketSigma);
    shuffle(orders, g);

    // CDA matching
    const { trades, vwap, volume, bestBid, bestAsk } = matchLabOrders(orders, agents);

    if (vwap != null) lastPrice = vwap;
    prices.push(lastPrice || fv);
    volumes.push(volume);
    spreads.push(Math.max(0, bestAsk - bestBid));

    welfareTrack.push(computeWelfare(agents));

    for (const a of agents) {
      a.wealthHistory.push(a.cash + a.shares * a.psi);
      a.shareHistory.push(a.shares);
    }

    rounds.push({
      round: r, trades, vwap, volume, bestBid, bestAsk,
      messages, orders, dividend: div, fv,
    });
  }

  // Bubble metrics (Henning + Dufwenberg)
  const totalTrades = rounds.reduce((s, r) => s + r.volume, 0);
  const bubbleMetrics = {
    haesselR2: haesselR2(prices, fvs),
    mse: mseFundamental(prices, fvs),
    napd: normalizedAbsPriceDev(prices, fvs, totalShares),
    amplitude: priceAmplitude(prices, fvs),
    turnover: turnover(totalTrades, totalShares),
    hypothesis: classifyHypothesis(
      mseFundamental(prices, fvs),
      priceAmplitude(prices, fvs),
      normalizedAbsPriceDev(prices, fvs, totalShares)
    ),
  };

  return {
    prices, volumes, spreads, fvs, rounds, welfareTrack, dividends,
    bubbleMetrics,
    allocation: {
      efficiency: allocativeEfficiency(agents),
      correlation: psiShareCorrelation(agents),
      topQuartile: topKConcentration(agents),
      welfare: computeWelfare(agents),
      maxWelfare: computeMaxWelfare(agents),
    },
  };
}

/* ================================================================
   Main Lab Experiment
   ================================================================ */

function runLabExperiment(params) {
  const g = mulberry32(params.seed || 42);
  const agents = createLabAgents(params, g);
  const commEnabled = params.commEnabled !== false;

  agents.forEach(a => { a.displayName = `${a.id + 1}.${a.name}`; });

  // Initial snapshot
  const initialSnapshot = agents.map(a => ({
    id: a.id, name: a.name, displayName: a.displayName,
    riskType: a.riskType, gamma: a.gamma,
    psi: a.psi, cash: a.cash, shares: a.shares, experience: a.experience,
  }));

  const initialAlloc = {
    efficiency: allocativeEfficiency(agents),
    correlation: psiShareCorrelation(agents),
    topQuartile: topKConcentration(agents),
    welfare: computeWelfare(agents),
    maxWelfare: computeMaxWelfare(agents),
  };

  // ---- Phase 1: Silent Trading (no communication) ----
  const phase1 = runLabPhase(agents, params, g, false);
  const phase1Snapshot = agents.map(a => ({
    id: a.id, name: a.name, displayName: a.displayName,
    riskType: a.riskType, gamma: a.gamma, psi: a.psi,
    cash: a.cash, shares: a.shares, experience: a.experience,
    totalPnL: a.cash - a.initialCash,
    dividendsReceived: a.dividendsReceived,
  }));

  // Increase experience after Phase 1 (Dufwenberg: agents learn)
  for (const a of agents) {
    a.experience += 1;
  }

  // ---- Phase 2: depends on communication toggle ----
  // Reset trade logs for Phase 2 (keep positions)
  for (const a of agents) {
    a.trades = [];
    a.wealthHistory = [];
    a.shareHistory = [];
    a.effectivePsi = a.psi;
    a.dividendsReceived = 0;
    a.interestEarned = 0;
  }

  const phase2 = runLabPhase(agents, params, g, commEnabled);
  const phase2Snapshot = agents.map(a => ({
    id: a.id, name: a.name, displayName: a.displayName,
    riskType: a.riskType, gamma: a.gamma, psi: a.psi,
    cash: a.cash, shares: a.shares, experience: a.experience,
    totalPnL: a.cash - phase1Snapshot.find(s => s.id === a.id).cash,
    dividendsReceived: a.dividendsReceived,
  }));

  // Increase experience after Phase 2
  for (const a of agents) {
    a.experience += 1;
  }

  // ---- Experience Sessions (Dufwenberg) ----
  // Run additional sessions if requested
  const expSessions = params.experienceRounds || 0;
  const sessionResults = [];

  for (let sess = 0; sess < expSessions; sess++) {
    // Reset positions to initial but keep experience
    for (const a of agents) {
      a.cash = a.initialCash;
      a.shares = a.initialShares;
      a.trades = [];
      a.wealthHistory = [];
      a.shareHistory = [];
      a.effectivePsi = a.psi;
      a.dividendsReceived = 0;
      a.interestEarned = 0;
    }

    // Run a full session (silent phase)
    const sessResult = runLabPhase(agents, params, g, false);
    sessionResults.push({
      session: sess + 1,
      experience: agents[0].experience,
      ...sessResult,
    });

    // Agents gain experience
    for (const a of agents) {
      a.experience += 1;
    }
  }

  // Find highest-psi agent
  const highestPsi = [...agents].sort((a, b) => b.psi - a.psi)[0];
  const totalShares = agents.reduce((s, a) => s + a.shares, 0);

  return {
    initialSnapshot,
    initialAlloc,
    fundamentalValue: computeFundamentalValue(params),
    phase1: { ...phase1, agents: phase1Snapshot },
    phase2: { ...phase2, agents: phase2Snapshot },
    commEnabled,
    sessionResults,  // Dufwenberg experience sessions
    finalAgents: agents,
    highestPsiAgent: {
      id: highestPsi.id,
      name: highestPsi.displayName,
      psi: highestPsi.psi,
      finalShares: highestPsi.shares,
      totalShares,
      sharePercent: totalShares > 0 ? highestPsi.shares / totalShares * 100 : 0,
    },
    params,
  };
}
