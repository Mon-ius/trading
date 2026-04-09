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
 *           Sobel (2020, JPE) "Lying and Deception in Games"
 *           — Formal lying vs deception distinction, sender-receiver model,
 *             damage metric, credulity, communication ON/OFF toggle
 *
 * Research questions:
 *   1. Does the asset flow to the highest-valuation agent? (Coase theorem)
 *   2. How does strategic lying/deception affect allocative efficiency?
 *   3. Do bubbles diminish with experience? (Dufwenberg result)
 *   4. Does communication help or hinder price discovery?
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
      psi,                                    // true private valuation (Sobel: theta)
      effectivePsi: psi,                      // trading valuation (may shift from comm)
      cash: Math.max(50, Math.round(cashMean * cashMul)),
      shares: Math.max(0, Math.round(sharesMean * shareMul)),
      initialCash: 0,
      initialShares: 0,
      experience: 0,                          // Dufwenberg: experience level (session count)
      // Sobel model properties
      reportedPsi: null,                      // message m sent by this agent
      beliefPsi: null,                        // receiver's posterior belief after messages
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
   Sobel (2020) Lying & Deception Model
   ================================================================
   Formal definitions from "Lying and Deception in Games" (JPE):

   - Lying (Def 1): A message m is a LIE given true state theta if
     m = m_{theta_0} and theta not in Theta_0.
     In our context: agent reports psi_reported where they BELIEVE
     psi_reported != psi_true. The statement has accepted meaning
     (the reported valuation) that differs from the truth.

   - Deception (Def 4): A message m is DECEPTIVE given theta and
     beliefs mu if there exists alternative message n such that
     mu(.|m) = p*mu(.|n) + (1-p)*rho, where rho has rho(theta)=0.
     In practice: m induces beliefs FARTHER from truth than some
     alternative message n could have.

   - Damage (Sec V): An action is DAMAGING if the receiver would
     make a better decision given an alternative message.
     In our context: trade price is worse for receiver due to
     deceptive signal.

   - Credulity (Def 6): Receiver is CREDULOUS if they update
     beliefs literally: mu(theta|m_theta) = posterior conditional
     on theta in Theta_0.

   - Bluffing (Sec VI): Deception that benefits the sender.
     Buyers understate (bluff low) to buy cheap.
     Sellers overstate (bluff high) to sell dear.
   ================================================================ */

/**
 * Sobel communication model
 * @param {Array} agents - All agents
 * @param {number|null} lastPrice - Previous round VWAP
 * @param {Function} g - PRNG
 * @param {Object} params - Experiment parameters
 * @returns {Array} messages with Sobel classifications
 */
function sobelCommunication(agents, lastPrice, g, params) {
  const { deceptStrength, credulity } = params;
  const refPrice = lastPrice || avg(agents.map(a => a.psi));
  const messages = [];

  // === Phase A: Each agent sends a signal (Sobel: sender chooses m) ===
  // Deception aggressiveness varies by risk type (Lopez-Lira heterogeneity)
  const DECEPT_SCALE = {
    risk_loving: 1.5,    // most aggressive bluffers
    risk_neutral: 1.0,
    risk_averse: 0.5,    // cautious, less deceptive
  };

  // Experience dampens deception (Dufwenberg: experienced traders are wiser)
  for (const a of agents) {
    const scale = DECEPT_SCALE[a.riskType] * deceptStrength;
    const expDampen = Math.max(0.3, 1 - a.experience * 0.15);  // experience reduces deception
    let reported;
    let intention = 'truthful';  // Sobel: sender's strategic intent

    if (a.psi > refPrice && a.cash > refPrice) {
      // BUYER wants price down -> understate valuation (bluff low)
      reported = a.psi * (1 - scale * expDampen * (0.1 + 0.2 * g()));
      intention = 'deflate';  // Sobel: bluffing for buyer benefit
    } else if (a.shares > 0 && a.psi < refPrice) {
      // SELLER wants price up -> overstate valuation (bluff high)
      reported = a.psi * (1 + scale * expDampen * (0.1 + 0.2 * g()));
      intention = 'inflate';  // Sobel: bluffing for seller benefit
    } else {
      // No clear strategic motive -> truthful (± small noise)
      reported = a.psi * (1 + 0.02 * randn(g));
      intention = 'truthful';
    }

    a.reportedPsi = Math.max(0.01, reported);

    // === Sobel Classification ===
    const bias = a.reportedPsi - a.psi;
    const biasPct = Math.abs(bias) / a.psi;

    // Lying (Sobel Def 1): m has accepted meaning, and sender believes it false
    // A lie threshold: reported value differs from true value beyond noise
    const isLie = biasPct > 0.03;

    // Deception (Sobel Def 4): message induces beliefs farther from truth
    // than alternative message (truth) would. Deception requires intentional
    // belief manipulation — lies need not be deceptive if discounted.
    // Deception = isLie AND sender has strategic intent to mislead
    const isDeceptive = isLie && intention !== 'truthful';

    // Bluffing (Sobel Sec VI): deception for sender's benefit
    const isBluff = isDeceptive;  // in trading, all strategic deception is bluffing

    messages.push({
      senderId: a.id,
      truePsi: a.psi,           // Sobel: theta (true state)
      reported: a.reportedPsi,  // Sobel: m (message)
      bias,
      biasPct,
      isLie,                    // Sobel Def 1
      isDeceptive,              // Sobel Def 4
      isBluff,                  // Sobel Sec VI
      intention,
      riskType: a.riskType,
      experience: a.experience,
    });
  }

  // === Phase B: Receivers update beliefs (Sobel: receiver forms mu(.|m)) ===
  // Credulity model from Sobel Def 6:
  // Credulous receiver: updates beliefs literally (takes message at face value)
  // Sophisticated receiver: discounts messages (Bayesian updating with skepticism)
  const SKEPTICISM = {
    risk_loving: 0.8,    // credulous (Sobel: takes messages literally)
    risk_neutral: 1.0,
    risk_averse: 1.3,    // skeptical (discounts signals)
  };

  for (const a of agents) {
    const otherMsgs = messages.filter(m => m.senderId !== a.id);
    if (otherMsgs.length === 0) continue;
    const avgSignal = avg(otherMsgs.map(m => m.reported));

    // Sobel credulity: how literally agent takes messages
    // Experienced agents are more skeptical (Dufwenberg experience effect)
    const expSkepticism = 1 + a.experience * 0.1;
    const effectiveCredul = credulity / (SKEPTICISM[a.riskType] * expSkepticism);
    const w = clamp(effectiveCredul, 0, 0.5);

    a.beliefPsi = a.psi * (1 - w) + avgSignal * w;
    a.effectivePsi = a.beliefPsi;
  }

  // === Phase C: Compute Sobel damage metric ===
  // Damage = welfare loss from deception compared to truthful communication
  // For each agent, compare effectivePsi with what it would be under truth
  const truthfulAvg = avg(agents.map(a => a.psi));
  for (const msg of messages) {
    const receiver_agents = agents.filter(a => a.id !== msg.senderId);
    // Damage: would the receiver have made a better decision with truthful signal?
    // Proxy: how much did this sender's lie shift the aggregate signal?
    if (msg.isDeceptive && receiver_agents.length > 0) {
      const shiftPerReceiver = msg.bias / receiver_agents.length;
      msg.damage = Math.abs(shiftPerReceiver);
    } else {
      msg.damage = 0;
    }
    // isDamaging (Sobel Sec V): deception that actually worsens receiver outcome
    msg.isDamaging = msg.damage > 0.01 * truthfulAvg;
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

    // === Communication phase (Sobel model, if enabled) ===
    let messages = null;
    if (withComm) {
      messages = sobelCommunication(agents, lastPrice, g, params);
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
   Sobel Deception Summary — aggregate lying/deception statistics
   ================================================================ */

function computeDeceptionSummary(allMessages) {
  if (allMessages.length === 0) {
    return {
      totalMessages: 0, totalLies: 0, totalDeceptions: 0, totalDamaging: 0, totalBluffs: 0,
      lieRate: 0, deceptionRate: 0, damageRate: 0, avgBias: 0, avgDamage: 0,
      inflations: 0, deflations: 0,
      byRiskType: {
        risk_loving:  { lies: 0, deceptions: 0, damaging: 0, total: 0 },
        risk_neutral: { lies: 0, deceptions: 0, damaging: 0, total: 0 },
        risk_averse:  { lies: 0, deceptions: 0, damaging: 0, total: 0 },
      },
    };
  }

  const lies = allMessages.filter(m => m.isLie);
  const deceptions = allMessages.filter(m => m.isDeceptive);
  const damaging = allMessages.filter(m => m.isDamaging);
  const bluffs = allMessages.filter(m => m.isBluff);

  const byRiskType = {};
  for (const rt of ['risk_loving', 'risk_neutral', 'risk_averse']) {
    const rtMsgs = allMessages.filter(m => m.riskType === rt);
    byRiskType[rt] = {
      lies: rtMsgs.filter(m => m.isLie).length,
      deceptions: rtMsgs.filter(m => m.isDeceptive).length,
      damaging: rtMsgs.filter(m => m.isDamaging).length,
      total: rtMsgs.length,
    };
  }

  return {
    totalMessages: allMessages.length,
    totalLies: lies.length,
    totalDeceptions: deceptions.length,
    totalDamaging: damaging.length,
    totalBluffs: bluffs.length,
    lieRate: lies.length / allMessages.length,
    deceptionRate: deceptions.length / allMessages.length,
    damageRate: damaging.length / allMessages.length,
    avgBias: avg(allMessages.map(m => m.bias)),
    avgDamage: avg(allMessages.map(m => m.damage)),
    inflations: allMessages.filter(m => m.intention === 'inflate').length,
    deflations: allMessages.filter(m => m.intention === 'deflate').length,
    byRiskType,
  };
}

/* ================================================================
   Main Lab Experiment — configurable phases with Sobel model
   ================================================================ */

function runLabExperiment(params) {
  const g = mulberry32(params.seed || 42);
  const agents = createLabAgents(params, g);
  const commEnabled = params.commEnabled !== false;  // default ON for backward compat

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
  let phase2 = null;
  let phase2Snapshot = null;
  let deception = null;

  // Reset trade logs for Phase 2 (keep positions)
  for (const a of agents) {
    a.trades = [];
    a.wealthHistory = [];
    a.shareHistory = [];
    a.effectivePsi = a.psi;
    a.reportedPsi = null;
    a.beliefPsi = null;
    a.dividendsReceived = 0;
    a.interestEarned = 0;
  }

  if (commEnabled) {
    // Phase 2 WITH Sobel communication (lying + deception)
    phase2 = runLabPhase(agents, params, g, true);
    phase2Snapshot = agents.map(a => ({
      id: a.id, name: a.name, displayName: a.displayName,
      riskType: a.riskType, gamma: a.gamma, psi: a.psi,
      cash: a.cash, shares: a.shares, experience: a.experience,
      totalPnL: a.cash - phase1Snapshot.find(s => s.id === a.id).cash,
      dividendsReceived: a.dividendsReceived,
    }));

    // Sobel deception summary
    const allMessages = phase2.rounds.flatMap(r => r.messages || []);
    deception = computeDeceptionSummary(allMessages);
  } else {
    // Phase 2 also silent (no communication) — control condition
    phase2 = runLabPhase(agents, params, g, false);
    phase2Snapshot = agents.map(a => ({
      id: a.id, name: a.name, displayName: a.displayName,
      riskType: a.riskType, gamma: a.gamma, psi: a.psi,
      cash: a.cash, shares: a.shares, experience: a.experience,
      totalPnL: a.cash - phase1Snapshot.find(s => s.id === a.id).cash,
      dividendsReceived: a.dividendsReceived,
    }));
    deception = computeDeceptionSummary([]);
  }

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
      a.reportedPsi = null;
      a.beliefPsi = null;
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
    deception,       // Sobel summary
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
