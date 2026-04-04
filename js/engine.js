/**
 * Market Microstructure Simulation Engine
 * ========================================
 * Continuous Double Auction with heterogeneous agents,
 * private information, and optional strategic communication.
 *
 * Based on:
 * - Kyle (1985): Continuous Auctions and Insider Trading
 * - Glosten & Milgrom (1985): Bid, Ask and Transaction Prices
 * - Grossman & Stiglitz (1980): Informationally Efficient Markets
 * - Smith, Suchanek & Williams (1988): Experimental Asset Bubbles
 * - Choi, Lee & Lim (2025): Lying Aversion vs. Deception Aversion
 */

/* ---- Random utilities ---- */
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
  while (!u) u = g();
  while (!v) v = g();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

/* ---- Agent names ---- */
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

/* ---- Info type noise (as fraction of true value) ---- */
const INFO_NOISE = {
  informed:   0.05,   // ~5% noise  — knows true value well
  partial:    0.15,   // ~15% noise — rough idea
  uninformed: 0.40,   // ~40% noise — very uncertain
};

/* ---- Risk type parameters ---- */
const RISK_PARAMS = {
  risk_loving:  { loc: 0.003, scale: 0.001 },
  risk_neutral: { loc: 0.015, scale: 0.005 },
  risk_averse:  { loc: 0.060, scale: 0.015 },
};

/* ---- Create agent population ---- */
function createAgents(params) {
  const {
    n, informedPct, partialPct,
    rlPct, rnPct,
    trueValue, optimismBias,
    clMean, cdMean, seed
  } = params;
  const g = mulberry32(seed || 42);

  // Assign info types
  const nInf = Math.round(n * informedPct / 100);
  const nPar = Math.round(n * partialPct / 100);
  const nUni = n - nInf - nPar;
  const infoArr = [];
  for (let i = 0; i < nInf; i++) infoArr.push('informed');
  for (let i = 0; i < nPar; i++) infoArr.push('partial');
  for (let i = 0; i < nUni; i++) infoArr.push('uninformed');
  // Shuffle
  for (let i = infoArr.length - 1; i > 0; i--) {
    const j = Math.floor(g() * (i + 1));
    [infoArr[i], infoArr[j]] = [infoArr[j], infoArr[i]];
  }

  // Assign risk types
  const nRL = Math.round(n * rlPct / 100);
  const nRN = Math.round(n * rnPct / 100);
  const riskArr = [];
  for (let i = 0; i < nRL; i++) riskArr.push('risk_loving');
  for (let i = 0; i < nRN; i++) riskArr.push('risk_neutral');
  for (let i = 0; i < n - nRL - nRN; i++) riskArr.push('risk_averse');
  for (let i = riskArr.length - 1; i > 0; i--) {
    const j = Math.floor(g() * (i + 1));
    [riskArr[i], riskArr[j]] = [riskArr[j], riskArr[i]];
  }

  const agents = [];
  for (let i = 0; i < n; i++) {
    const it = infoArr[i];
    const rt = riskArr[i];
    const rp = RISK_PARAMS[rt];

    // Signal noise
    const noiseStd = INFO_NOISE[it] * trueValue;
    const signal = trueValue + (it === 'uninformed' ? optimismBias : 0) + noiseStd * randn(g);

    // Risk aversion (CARA parameter)
    const alpha = Math.max(0.0005, rp.loc + rp.scale * randn(g));

    // Moral costs for communication
    const cl = Math.max(0, Math.exp(clMean + randn(g)));
    const cd = Math.max(0, Math.exp(cdMean + randn(g)));

    agents.push({
      id: i,
      name: AGENT_NAMES[i] || `Agent${i}`,
      infoType: it,
      riskType: rt,
      signal,
      belief: signal,
      precision: 1 / (noiseStd * noiseStd),
      alpha,
      cl, cd,
      cash: 10000,
      shares: 10,
      totalPnL: 0,
      trades: [],
      messages: [],
    });
  }
  return agents;
}

/* ---- Compute bid/ask for an agent ---- */
function computeOrder(agent, lastPrice, momentum) {
  let belief = agent.belief;

  // Momentum: trend-following adjustment
  if (momentum > 0 && lastPrice != null && agent.trades.length > 0) {
    const lastTrade = agent.trades[agent.trades.length - 1];
    if (lastTrade.price != null) {
      belief += momentum * (lastPrice - lastTrade.price);
    }
  }

  const spread = agent.alpha / (2 * agent.precision);
  const bid = belief - spread;
  const ask = belief + spread;

  // Determine desire: want to buy if belief > lastPrice, sell if belief < lastPrice
  const refPrice = lastPrice != null ? lastPrice : belief;
  const wantsBuy = belief > refPrice || agent.shares < 3;
  const wantsSell = belief < refPrice || agent.shares > 15;

  return { agentId: agent.id, bid, ask, belief, wantsBuy, wantsSell };
}

/* ---- CDA matching engine ---- */
function matchOrders(orders, agents) {
  // Separate into buy and sell orders
  const buys = orders.filter(o => o.wantsBuy).map(o => ({ ...o, price: o.bid }));
  const sells = orders.filter(o => o.wantsSell).map(o => ({ ...o, price: o.ask }));

  // Sort: buys descending by bid, sells ascending by ask
  buys.sort((a, b) => b.price - a.price);
  sells.sort((a, b) => a.price - b.price);

  const trades = [];
  let bi = 0, si = 0;

  while (bi < buys.length && si < sells.length) {
    const buy = buys[bi], sell = sells[si];
    if (buy.agentId === sell.agentId) { si++; continue; }
    if (buy.price < sell.price) break;

    const price = (buy.price + sell.price) / 2;
    const buyer = agents[buy.agentId];
    const seller = agents[sell.agentId];

    // Check constraints
    if (buyer.cash < price || seller.shares < 1) {
      if (buyer.cash < price) bi++; else si++;
      continue;
    }

    // Execute trade
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
    buyer.trades.push({ ...trade, side: 'buy' });
    seller.trades.push({ ...trade, side: 'sell' });

    bi++; si++;
  }

  const vwap = trades.length > 0
    ? trades.reduce((s, t) => s + t.price, 0) / trades.length
    : null;

  return { trades, vwap, volume: trades.length };
}

/* ---- Strategic communication ---- */
function communicationRound(agents, lastPrice, g, params) {
  const messages = [];
  const refPrice = lastPrice != null ? lastPrice : params.trueValue;

  for (const a of agents) {
    // Direction: buy (understate) vs sell (overstate)
    const direction = a.belief > refPrice ? -1 : 1; // -1 = buyer lies low, +1 = seller lies high
    const strategicBenefit = Math.abs(a.belief - refPrice) * 0.3;
    const lyingPenalty = a.cl;
    const deceptionPenalty = a.cd * 0.5;
    const netBenefit = Math.max(0, strategicBenefit - lyingPenalty - deceptionPenalty);
    const bias = direction * netBenefit;

    const message = a.signal + bias;
    const isLie = Math.abs(bias) > 0.01 * params.trueValue;
    const isDeceptive = isLie && Math.abs(bias) > 0.05 * params.trueValue;

    messages.push({
      senderId: a.id,
      message,
      truthful: a.signal,
      bias,
      isLie,
      isDeceptive,
    });
    a.messages.push({ round: params.currentRound, message, bias, isLie, isDeceptive });
  }

  return messages;
}

/* ---- Update beliefs from market price & messages ---- */
function updateBeliefs(agents, marketPrice, messages, params) {
  // Market price informativeness — depends on informed participation
  const tauPrice = params.priceInfoWeight || 0.001;

  for (const a of agents) {
    // Learn from market price
    if (marketPrice != null) {
      const tauOld = a.precision;
      const tauNew = tauOld + tauPrice;
      a.belief = (tauOld * a.belief + tauPrice * marketPrice) / tauNew;
      a.precision = tauNew;
    }

    // Learn from messages (if communication enabled)
    if (messages && messages.length > 0) {
      const tauMsg = tauPrice * 0.3; // Messages less informative than prices
      for (const msg of messages) {
        if (msg.senderId === a.id) continue; // Skip own message
        const credibility = 1 / (1 + agents[msg.senderId].messages.filter(m => m.isLie).length * 0.5);
        const weight = tauMsg * credibility;
        const tauOld = a.precision;
        a.belief = (tauOld * a.belief + weight * msg.message) / (tauOld + weight);
        a.precision = tauOld + weight;
      }
    }
  }
}

/* ---- Compute agent P&L ---- */
function computePnL(agents, trueValue) {
  for (const a of agents) {
    const portfolioValue = a.cash + a.shares * trueValue;
    a.totalPnL = portfolioValue - (10000 + 10 * trueValue); // vs initial endowment
  }
}

/* ---- Bubble metrics ---- */
function bubbleMetrics(priceHistory, trueValue) {
  if (priceHistory.length === 0) return { maxBubble: 0, avgDeviation: 0, efficiency: 1 };
  const deviations = priceHistory.map(p => (p - trueValue) / trueValue);
  const maxBubble = Math.max(...deviations.map(Math.abs));
  const avgDeviation = deviations.reduce((s, d) => s + Math.abs(d), 0) / deviations.length;
  const lastDev = Math.abs(deviations[deviations.length - 1]);
  const efficiency = Math.max(0, 1 - lastDev);
  return { maxBubble, avgDeviation, efficiency, deviations };
}

/* ---- Full simulation ---- */
function runSimulation(params) {
  const {
    n, informedPct, partialPct, rlPct, rnPct,
    trueValue, optimismBias, rounds, communication,
    momentum, clMean, cdMean, seed
  } = params;

  const g = mulberry32(seed || 42);
  const agents = createAgents(params);

  const history = {
    prices: [],
    volumes: [],
    spreads: [],
    rounds: [],
    agents,
    trueValue,
    params,
  };

  let lastPrice = null;

  for (let r = 0; r < rounds; r++) {
    const roundData = { round: r, trades: [], messages: [], orders: [] };

    // Communication phase (optional)
    let messages = null;
    if (communication) {
      messages = communicationRound(agents, lastPrice, g, {
        ...params, currentRound: r,
      });
      roundData.messages = messages;
    }

    // Update beliefs from messages before trading
    if (messages) {
      updateBeliefs(agents, null, messages, params);
    }

    // Order computation
    const orders = agents.map(a => computeOrder(a, lastPrice, momentum / 100));
    roundData.orders = orders;

    // CDA matching
    const { trades, vwap, volume } = matchOrders(orders, agents);
    roundData.trades = trades;
    roundData.volume = volume;
    roundData.vwap = vwap;

    // Record price
    if (vwap != null) {
      lastPrice = vwap;
      history.prices.push(vwap);
    } else if (lastPrice != null) {
      history.prices.push(lastPrice);
    }
    history.volumes.push(volume);

    // Bid-ask spread
    const allBids = orders.map(o => o.bid).sort((a, b) => b - a);
    const allAsks = orders.map(o => o.ask).sort((a, b) => a - b);
    const bestBid = allBids[0] || 0, bestAsk = allAsks[0] || 0;
    history.spreads.push(bestAsk - bestBid);
    roundData.bestBid = bestBid;
    roundData.bestAsk = bestAsk;

    // Update beliefs from market price
    if (vwap != null) {
      updateBeliefs(agents, vwap, null, params);
    }

    history.rounds.push(roundData);
  }

  // Final P&L
  computePnL(agents, trueValue);

  // Bubble metrics
  history.bubble = bubbleMetrics(history.prices, trueValue);

  // Agent summary: belief accuracy
  for (const a of agents) {
    a.beliefError = Math.abs(a.belief - trueValue) / trueValue;
    a.finalWealth = a.cash + a.shares * trueValue;
  }

  // Information aggregation: how close is final price to true value?
  const finalPrice = history.prices[history.prices.length - 1] || trueValue;
  history.infoAggregation = 1 - Math.abs(finalPrice - trueValue) / trueValue;

  return history;
}
