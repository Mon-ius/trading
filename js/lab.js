/**
 * Lab Experiment Engine — Utility-Maximizing Heterogeneous Agents
 * ================================================================
 * Based on Lopez-Lira (2025) "Can Large Language Models Trade?"
 * Extended with:
 *   - CARA utility functions per agent
 *   - Heterogeneous psychological valuations (private v_i)
 *   - Heterogeneous endowments
 *   - Two-phase design: Phase 1 (silent) → Phase 2 (deception)
 *   - Allocation efficiency tracking (Coase theorem test)
 *
 * Research question:
 *   Does the asset end up with the agent who values it most?
 *   How does strategic deception affect allocative efficiency?
 */

/* ================================================================
   CARA Utility
   U(W) = -exp(-γW)/γ   for γ ≠ 0
   U(W) = W              for γ = 0 (risk-neutral)
   ================================================================ */

function caraUtility(W, gamma) {
  if (Math.abs(gamma) < 1e-8) return W;
  return -Math.exp(-gamma * W) / gamma;
}

/* Certainty equivalent: CE such that U(CE) = EU */
function caraCE(eu, gamma) {
  if (Math.abs(gamma) < 1e-8) return eu;
  const inner = -gamma * eu;
  if (inner <= 0) return 1e6; // edge case
  return -Math.log(inner) / gamma;
}

/* ================================================================
   Agent Creation
   ================================================================ */

const LAB_GAMMA = {
  risk_loving:  { lo: -0.008, hi: 0.002 },
  risk_neutral: { lo: 0.002,  hi: 0.012 },
  risk_averse:  { lo: 0.012,  hi: 0.060 },
};

function createLabAgents(params, g) {
  const {
    n, baseValue, valSpread, rlPct, rnPct,
    cashMean, sharesMean, endowVar,
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
  const totalShares = n * sharesMean;

  for (let i = 0; i < n; i++) {
    const rt = riskArr[i];
    const gp = LAB_GAMMA[rt];
    const gamma = gp.lo + (gp.hi - gp.lo) * g();

    // Psychological valuation: spread around baseValue
    // Use beta-like distribution for more interesting heterogeneity
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
      effectivePsi: psi,                      // used for trading (may be influenced by communication)
      cash: Math.max(50, Math.round(cashMean * cashMul)),
      shares: Math.max(0, Math.round(sharesMean * shareMul)),
      initialCash: 0,                         // set after creation
      initialShares: 0,
      reportedPsi: null,                      // deceptive signal
      trades: [],
      wealthHistory: [],
      shareHistory: [],
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
   Reservation Prices (Utility-Maximization)
   ================================================================ */

/**
 * Buy reservation price: max price p such that
 *   U(cash - p) + psi  ≥  U(cash)   [simplified]
 *
 * For CARA with market uncertainty σ:
 *   bid = psi - |γ| × σ² / 2
 *
 * Risk-loving (γ < 0): bid > psi (aggressive, willing to overpay)
 * Risk-neutral (γ ≈ 0): bid ≈ psi
 * Risk-averse (γ > 0): bid < psi (conservative, needs discount)
 */
function reservationBid(agent, marketUncertainty) {
  const sigma = marketUncertainty || Math.max(1, agent.effectivePsi * 0.15);
  const riskPremium = agent.gamma * sigma * sigma / 2;
  return Math.max(0.01, agent.effectivePsi - riskPremium);
}

/**
 * Sell reservation price: min price p such that
 *   U(cash + p) - psi  ≥  U(cash)   [simplified]
 *
 * ask = psi + |γ| × σ² / 2
 */
function reservationAsk(agent, marketUncertainty) {
  const sigma = marketUncertainty || Math.max(1, agent.effectivePsi * 0.15);
  const riskPremium = agent.gamma * sigma * sigma / 2;
  return Math.max(0.01, agent.effectivePsi + riskPremium);
}

/* ================================================================
   Lab CDA Matching Engine
   ================================================================ */

function computeLabOrders(agents, marketUncertainty) {
  const orders = [];
  for (const a of agents) {
    const bid = reservationBid(a, marketUncertainty);
    const ask = reservationAsk(a, marketUncertainty);
    orders.push({
      agentId: a.id,
      bid,
      ask,
      psi: a.effectivePsi,
      wantsBuy: a.cash >= bid * 0.5,        // has enough cash
      wantsSell: a.shares > 0,               // has shares to sell
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

  buys.sort((a, b) => b.price - a.price);    // highest bid first
  sells.sort((a, b) => a.price - b.price);    // lowest ask first

  const trades = [];
  let bi = 0, si = 0;

  while (bi < buys.length && si < sells.length) {
    const buy = buys[bi], sell = sells[si];

    // No self-trade
    if (buy.agentId === sell.agentId) { si++; continue; }

    // No trade if bid < ask
    if (buy.price < sell.price) break;

    const buyer = agents[buy.agentId];
    const seller = agents[sell.agentId];
    const execPrice = (buy.price + sell.price) / 2;

    // Validate resources
    if (buyer.cash < execPrice || seller.shares < 1) {
      if (buyer.cash < execPrice) bi++; else si++;
      continue;
    }

    // Execute trade
    buyer.cash -= execPrice;
    buyer.shares += 1;
    seller.cash += execPrice;
    seller.shares -= 1;

    const trade = {
      buyerId: buy.agentId,
      sellerId: sell.agentId,
      price: execPrice,
      buyerPsi: agents[buy.agentId].psi,
      sellerPsi: agents[sell.agentId].psi,
      buyerBid: buy.price,
      sellerAsk: sell.price,
    };
    trades.push(trade);
    buyer.trades.push({ ...trade, side: 'buy' });
    seller.trades.push({ ...trade, side: 'sell' });

    bi++; si++;
  }

  const vwap = trades.length > 0
    ? trades.reduce((s, t) => s + t.price, 0) / trades.length
    : null;

  const bestBid = buys.length > 0 ? buys[0].price : 0;
  const bestAsk = sells.length > 0 ? sells[0].price : 0;

  return { trades, vwap, volume: trades.length, bestBid, bestAsk };
}

/* ================================================================
   Communication with Strategic Deception
   ================================================================ */

/**
 * Deception model:
 * - Buyers (want price to go down): report psi_lower = psi × (1 - deceptFactor)
 * - Sellers (want price to go up): report psi_higher = psi × (1 + deceptFactor)
 * - deceptFactor varies by risk type:
 *     risk_loving → more deceptive (aggressive)
 *     risk_averse → less deceptive (conservative)
 *
 * Reception model:
 * - Agents update effectivePsi toward received avg signal
 * - Credulity parameter controls weight of update
 * - Sophisticated agents (experienced traders) discount signals more
 */
function labCommunication(agents, lastPrice, g, params) {
  const { deceptStrength, credulity } = params;
  const refPrice = lastPrice || avg(agents.map(a => a.psi));
  const messages = [];

  // Deception factors by risk type
  const DECEPT_SCALE = {
    risk_loving: 1.5,    // most deceptive
    risk_neutral: 1.0,
    risk_averse: 0.5,    // least deceptive
  };

  // Phase 1: Each agent sends a (possibly deceptive) signal
  for (const a of agents) {
    const scale = DECEPT_SCALE[a.riskType] * deceptStrength;
    let reported;

    if (a.psi > refPrice && a.cash > refPrice) {
      // Wants to BUY → understate valuation to push price down
      reported = a.psi * (1 - scale * (0.1 + 0.2 * g()));
    } else if (a.shares > 0 && a.psi < refPrice) {
      // Wants to SELL → overstate valuation to push price up
      reported = a.psi * (1 + scale * (0.1 + 0.2 * g()));
    } else {
      // Truthful (± small noise)
      reported = a.psi * (1 + 0.02 * randn(g));
    }

    a.reportedPsi = Math.max(0.01, reported);
    const bias = a.reportedPsi - a.psi;
    const isLie = Math.abs(bias) > 0.03 * a.psi;

    messages.push({
      senderId: a.id,
      truePsi: a.psi,
      reported: a.reportedPsi,
      bias,
      isLie,
      direction: bias > 0 ? 'inflate' : bias < 0 ? 'deflate' : 'truthful',
      riskType: a.riskType,
    });
  }

  // Phase 2: Each agent receives others' signals and partially updates
  for (const a of agents) {
    const otherMsgs = messages.filter(m => m.senderId !== a.id);
    const avgSignal = avg(otherMsgs.map(m => m.reported));

    // Credulity: how much to trust received signals
    // Risk-averse agents are more skeptical (discount signals more)
    const SKEPTICISM = {
      risk_loving: 0.8,    // very credulous
      risk_neutral: 1.0,
      risk_averse: 1.3,    // skeptical
    };
    const effectiveCredul = credulity / SKEPTICISM[a.riskType];
    const w = clamp(effectiveCredul, 0, 0.5);

    a.effectivePsi = a.psi * (1 - w) + avgSignal * w;
  }

  return messages;
}

/* ================================================================
   Allocation Efficiency Metrics
   ================================================================ */

/**
 * Welfare = Σ psi_i × shares_i
 * Measures total value created by current allocation
 */
function computeWelfare(agents) {
  return agents.reduce((s, a) => s + a.psi * a.shares, 0);
}

/**
 * Maximum possible welfare: give all shares to highest-psi agents first
 */
function computeMaxWelfare(agents) {
  const totalShares = agents.reduce((s, a) => s + a.shares, 0);
  const sorted = [...agents].sort((a, b) => b.psi - a.psi);
  let remaining = totalShares;
  let welfare = 0;
  for (const a of sorted) {
    if (remaining <= 0) break;
    // In optimal allocation, this agent gets as many shares as possible
    // (bounded by what makes sense — here all shares are fungible)
    welfare += a.psi * Math.min(remaining, totalShares);
    remaining -= totalShares;  // give all to highest
    break; // Actually, optimal = all to one agent (highest psi)
  }
  // More realistic: distribute proportionally to preference
  // Optimal: give all shares to the single highest-psi agent
  return sorted[0].psi * totalShares;
}

/**
 * Minimum welfare: give all shares to lowest-psi agent
 */
function computeMinWelfare(agents) {
  const totalShares = agents.reduce((s, a) => s + a.shares, 0);
  const sorted = [...agents].sort((a, b) => a.psi - b.psi);
  return sorted[0].psi * totalShares;
}

/**
 * Allocative efficiency ∈ [0, 1]
 * = (welfare - min) / (max - min)
 */
function allocativeEfficiency(agents) {
  const w = computeWelfare(agents);
  const wMax = computeMaxWelfare(agents);
  const wMin = computeMinWelfare(agents);
  const denom = wMax - wMin;
  return denom > 0 ? clamp((w - wMin) / denom, 0, 1) : 1;
}

/**
 * Spearman rank correlation between psi and shares
 */
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

/**
 * Top-K concentration: what fraction of shares are held by top-K highest-psi agents?
 */
function topKConcentration(agents, k) {
  const totalShares = agents.reduce((s, a) => s + a.shares, 0);
  if (totalShares === 0) return 0;
  const sorted = [...agents].sort((a, b) => b.psi - a.psi);
  const topShares = sorted.slice(0, k || Math.ceil(agents.length * 0.25))
    .reduce((s, a) => s + a.shares, 0);
  return topShares / totalShares;
}

/* ================================================================
   Run Single Lab Phase (multiple CDA rounds)
   ================================================================ */

function runLabPhase(agents, params, g, withComm) {
  const { labRounds } = params;
  const prices = [], volumes = [], spreads = [];
  const rounds = [];
  const welfareTrack = [];
  let lastPrice = null;

  // Market uncertainty estimate
  const psiArr = agents.map(a => a.psi);
  const psiStd = Math.sqrt(avg(psiArr.map(v => (v - avg(psiArr)) ** 2)));
  const marketSigma = Math.max(1, psiStd * 0.5);

  for (let r = 0; r < labRounds; r++) {
    // Reset effective psi to true psi at start of each round (before communication)
    for (const a of agents) a.effectivePsi = a.psi;

    // Communication phase (Phase 2 only)
    let messages = null;
    if (withComm) {
      messages = labCommunication(agents, lastPrice, g, params);
    }

    // Compute orders based on (possibly influenced) valuations
    const orders = computeLabOrders(agents, marketSigma);

    // Shuffle order submission to avoid systematic priority
    shuffle(orders, g);

    // CDA matching
    const { trades, vwap, volume, bestBid, bestAsk } = matchLabOrders(orders, agents);

    if (vwap != null) lastPrice = vwap;
    prices.push(lastPrice || avg(psiArr));
    volumes.push(volume);
    spreads.push(Math.max(0, bestAsk - bestBid));

    // Track welfare
    welfareTrack.push(computeWelfare(agents));

    // Record agent snapshots
    for (const a of agents) {
      a.wealthHistory.push(a.cash + a.shares * a.psi);
      a.shareHistory.push(a.shares);
    }

    rounds.push({
      round: r,
      trades,
      vwap,
      volume,
      bestBid,
      bestAsk,
      messages,
      orders,
    });
  }

  return {
    prices,
    volumes,
    spreads,
    rounds,
    welfareTrack,
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
   Main Lab Experiment — Two Phases
   ================================================================ */

function runLabExperiment(params) {
  const g = mulberry32(params.seed || 42);
  const agents = createLabAgents(params, g);

  // Assign display names
  agents.forEach(a => { a.displayName = `${a.id + 1}.${a.name}`; });

  // Snapshot initial state
  const initialSnapshot = agents.map(a => ({
    id: a.id, name: a.name, displayName: a.displayName,
    riskType: a.riskType, gamma: a.gamma,
    psi: a.psi, cash: a.cash, shares: a.shares,
  }));

  // Initial allocation metrics
  const initialAlloc = {
    efficiency: allocativeEfficiency(agents),
    correlation: psiShareCorrelation(agents),
    topQuartile: topKConcentration(agents),
    welfare: computeWelfare(agents),
    maxWelfare: computeMaxWelfare(agents),
  };

  // ---- Phase 1: Silent Trading (no communication) ----
  const phase1 = runLabPhase(agents, params, g, false);
  const phase1Agents = agents.map(a => ({
    ...a,
    wealthHistory: [...a.wealthHistory],
    shareHistory: [...a.shareHistory],
    trades: [...a.trades],
  }));

  // Snapshot after Phase 1
  const phase1Snapshot = agents.map(a => ({
    id: a.id, name: a.name, displayName: a.displayName,
    riskType: a.riskType, gamma: a.gamma, psi: a.psi,
    cash: a.cash, shares: a.shares,
    totalPnL: a.cash - a.initialCash,
  }));

  // Reset trade logs for Phase 2 (keep positions)
  for (const a of agents) {
    a.trades = [];
    a.wealthHistory = [];
    a.shareHistory = [];
    a.effectivePsi = a.psi;
    a.reportedPsi = null;
  }

  // ---- Phase 2: Communication with Deception ----
  const phase2 = runLabPhase(agents, params, g, true);

  // Snapshot after Phase 2
  const phase2Snapshot = agents.map(a => ({
    id: a.id, name: a.name, displayName: a.displayName,
    riskType: a.riskType, gamma: a.gamma, psi: a.psi,
    cash: a.cash, shares: a.shares,
    totalPnL: a.cash - phase1Snapshot.find(s => s.id === a.id).cash,
  }));

  // Deception summary
  const allMessages = phase2.rounds.flatMap(r => r.messages || []);
  const lies = allMessages.filter(m => m.isLie);
  const deception = {
    totalMessages: allMessages.length,
    totalLies: lies.length,
    lieRate: allMessages.length > 0 ? lies.length / allMessages.length : 0,
    avgBias: allMessages.length > 0 ? avg(allMessages.map(m => m.bias)) : 0,
    inflations: lies.filter(m => m.direction === 'inflate').length,
    deflations: lies.filter(m => m.direction === 'deflate').length,
    byRiskType: {
      risk_loving: {
        lies: lies.filter(m => m.riskType === 'risk_loving').length,
        total: allMessages.filter(m => m.riskType === 'risk_loving').length,
      },
      risk_neutral: {
        lies: lies.filter(m => m.riskType === 'risk_neutral').length,
        total: allMessages.filter(m => m.riskType === 'risk_neutral').length,
      },
      risk_averse: {
        lies: lies.filter(m => m.riskType === 'risk_averse').length,
        total: allMessages.filter(m => m.riskType === 'risk_averse').length,
      },
    },
  };

  // Find the highest-psi agent
  const highestPsi = [...agents].sort((a, b) => b.psi - a.psi)[0];

  return {
    initialSnapshot,
    initialAlloc,
    phase1: {
      ...phase1,
      agents: phase1Snapshot,
    },
    phase2: {
      ...phase2,
      agents: phase2Snapshot,
    },
    deception,
    finalAgents: agents,
    highestPsiAgent: {
      id: highestPsi.id,
      name: highestPsi.displayName,
      psi: highestPsi.psi,
      finalShares: highestPsi.shares,
      totalShares: agents.reduce((s, a) => s + a.shares, 0),
      sharePercent: agents.reduce((s, a) => s + a.shares, 0) > 0
        ? highestPsi.shares / agents.reduce((s, a) => s + a.shares, 0) * 100
        : 0,
    },
    params,
  };
}
