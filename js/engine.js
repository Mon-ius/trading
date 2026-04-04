/**
 * Market Microstructure Simulation Engine
 * ========================================
 * Continuous Double Auction with declining fundamental value.
 *
 * Following Dufwenberg, Lindqvist & Moore (2005, AER)
 *   "Bubbles and Experience: An Experiment"
 * Extended with heterogeneous risk preferences and knowledge levels.
 *
 * Research question:
 *   alpha* = min fraction of experienced agents to burst bubbles
 *   alpha* = f(n, risk_distribution, knowledge_distribution)
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

/* ---- Risk type CARA parameters ---- */
const RISK_PARAMS = {
  risk_loving:  { loc: 0.005, scale: 0.002 },
  risk_neutral: { loc: 0.020, scale: 0.006 },
  risk_averse:  { loc: 0.080, scale: 0.020 },
};

/* ================================================================
   Asset model — declining fundamental value
   Following Smith, Suchanek & Williams (1988) / Dufwenberg et al. (2005)

   Asset life: T periods
   Each period dividend d_t ∈ {0, 2·E[d]} with P = 0.5 each
   Fundamental value at period t: FV(t) = (T - t) × E[d]
   ================================================================ */

function fundamentalValue(period, T, expectedDiv) {
  return Math.max(0, (T - period) * expectedDiv);
}

/* ---- Create agents for a single market ---- */
function createMarketAgents(params, g) {
  const {
    n, alpha, rlPct, rnPct,
    initialCash, initialShares,
    expNoise, inexpBias, inexpNoise, inexpAnchor,
    T, expectedDiv,
  } = params;

  // Number experienced vs inexperienced
  const nExp = Math.round(n * alpha);
  const nInexp = n - nExp;

  // Assign experience types
  const expArr = [];
  for (let i = 0; i < nExp; i++) expArr.push('experienced');
  for (let i = 0; i < nInexp; i++) expArr.push('inexperienced');
  shuffle(expArr, g);

  // Assign risk types
  const nRL = Math.round(n * rlPct / 100);
  const nRN = Math.round(n * rnPct / 100);
  const riskArr = [];
  for (let i = 0; i < nRL; i++) riskArr.push('risk_loving');
  for (let i = 0; i < nRN; i++) riskArr.push('risk_neutral');
  for (let i = 0; i < n - nRL - nRN; i++) riskArr.push('risk_averse');
  shuffle(riskArr, g);

  const fv0 = fundamentalValue(0, T, expectedDiv);
  const agents = [];
  for (let i = 0; i < n; i++) {
    const et = expArr[i];
    const rt = riskArr[i];
    const rp = RISK_PARAMS[rt];
    const riskAversion = Math.max(0.001, rp.loc + rp.scale * randn(g));

    agents.push({
      id: i,
      name: AGENT_NAMES[i] || `A${i}`,
      expType: et,
      riskType: rt,
      riskAversion,
      cash: initialCash,
      shares: initialShares,
      belief: fv0,        // initial belief = FV(0) for everyone
      trades: [],
      dividendsReceived: 0,
    });
  }
  return agents;
}

/* ---- Update agent belief for current period ---- */
function updateAgentBelief(agent, period, T, expectedDiv, lastPrice, prevPrice, params, g) {
  const fv = fundamentalValue(period, T, expectedDiv);

  if (agent.expType === 'experienced') {
    // Experienced: knows FV, slight noise
    agent.belief = fv * (1 + params.expNoise * randn(g));
  } else {
    // Inexperienced: anchored to initial FV, optimism bias, momentum
    const fv0 = fundamentalValue(0, T, expectedDiv);
    const anchor = params.inexpAnchor;
    // Partial anchoring: weighted average of current FV and initial FV
    const base = fv * (1 - anchor) + fv0 * anchor;
    // Optimism bias
    const biased = base * (1 + params.inexpBias);
    // Momentum: chase price trends
    let mom = 0;
    if (lastPrice != null && prevPrice != null) {
      mom = params.momentum * (lastPrice - prevPrice);
    }
    agent.belief = Math.max(0, biased + mom + fv * params.inexpNoise * randn(g));
  }
}

/* ---- Compute bid/ask orders ---- */
function computeOrders(agents, fv) {
  const orders = [];
  for (const a of agents) {
    const spread = a.riskAversion * Math.max(1, a.belief) * 0.15;
    const bid = Math.max(0, a.belief - spread);
    const ask = a.belief + spread;

    // Buy if belief > current value estimate, sell if belief < value estimate
    const wantsBuy = a.belief > fv * 0.85 && a.cash >= bid;
    const wantsSell = a.belief < fv * 1.15 || a.shares > 0;

    orders.push({ agentId: a.id, bid, ask, belief: a.belief, wantsBuy, wantsSell });
  }
  return orders;
}

/* ---- CDA matching engine ---- */
function matchOrders(orders, agents) {
  const buys = orders.filter(o => o.wantsBuy && agents[o.agentId].cash > 0)
    .map(o => ({ ...o, price: o.bid }));
  const sells = orders.filter(o => o.wantsSell && agents[o.agentId].shares > 0)
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
  return { trades, vwap, volume: trades.length };
}

/* ================================================================
   Bubble metrics — from Dufwenberg et al. (2005) Table 1-2
   ================================================================ */

function bubbleMetrics(prices, fvs) {
  const T = prices.length;
  if (T === 0) return { haesselR2: 1, napd: 0, amplitude: 0, avgDev: 0, maxDev: 0 };

  // Haessel-R² = 1 - Σ(P_t - FV_t)² / Σ(P_t - P_mean)²
  // Using exogenous FV as reference (not endogenous regression)
  const ssr = prices.reduce((s, p, i) => s + (p - fvs[i]) ** 2, 0);
  const fvMean = avg(fvs);
  const sst = fvs.reduce((s, f) => s + (f - fvMean) ** 2, 0);
  const haesselR2 = sst > 0 ? Math.max(0, 1 - ssr / sst) : (ssr < 1e-6 ? 1 : 0);

  // Normalized absolute price deviation
  // NAPD = Σ|P_t - FV_t| / (T × FV_0)
  const fv0 = fvs[0] || 1;
  const napd = prices.reduce((s, p, i) => s + Math.abs(p - fvs[i]), 0) / (T * fv0);

  // Price amplitude = (max_t(P_t - FV_t) - min_t(P_t - FV_t)) / FV_0
  const diffs = prices.map((p, i) => p - fvs[i]);
  const amplitude = (Math.max(...diffs) - Math.min(...diffs)) / fv0;

  // Average absolute deviation %
  const avgDev = avg(prices.map((p, i) => fvs[i] > 0 ? Math.abs(p - fvs[i]) / fvs[i] : 0));

  // Max deviation %
  const maxDev = Math.max(...prices.map((p, i) => fvs[i] > 0 ? Math.abs(p - fvs[i]) / fvs[i] : 0));

  return { haesselR2, napd, amplitude, avgDev, maxDev };
}

/* ================================================================
   Single market simulation
   ================================================================ */

function runMarket(params) {
  const {
    n, T, expectedDiv, alpha,
    rlPct, rnPct,
    initialCash, initialShares,
    expNoise, inexpBias, inexpNoise, inexpAnchor, momentum,
    communication, clMean, cdMean,
    seed,
  } = params;

  const g = mulberry32(seed || 42);
  const agents = createMarketAgents(params, g);
  const totalShares = n * initialShares;

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

    // Communication phase (optional)
    let messages = null;
    if (communication) {
      messages = communicationRoundDFV(agents, lastPrice, fv, g, params);
    }

    // Order computation
    const orders = computeOrders(agents, fv);

    // CDA matching
    const { trades, vwap, volume } = matchOrders(orders, agents);

    // Bid-ask spread
    const allBids = orders.map(o => o.bid).sort((a, b) => b - a);
    const allAsks = orders.map(o => o.ask).sort((a, b) => a - b);
    const bestBid = allBids[0] || 0, bestAsk = allAsks[0] || 0;

    // Record
    prevPrice = lastPrice;
    if (vwap != null) lastPrice = vwap;
    prices.push(lastPrice != null ? lastPrice : fv);
    volumes.push(volume);
    spreads.push(bestAsk - bestBid);

    // Mark trade periods
    for (const tr of trades) {
      const bt = agents[tr.buyerId].trades;
      bt[bt.length - 1].period = period;
      const st = agents[tr.sellerId].trades;
      st[st.length - 1].period = period;
    }

    // Dividend realization
    const div = g() < 0.5 ? 0 : 2 * expectedDiv;
    for (const a of agents) {
      const earned = div * a.shares;
      a.cash += earned;
      a.dividendsReceived += earned;
    }

    rounds.push({
      period, fv, div, trades, vwap, volume,
      bestBid, bestAsk, messages,
      orders,
    });
  }

  // Final P&L: portfolio = cash (no remaining asset value since FV(T) = 0)
  const initWealth = initialCash + initialShares * fundamentalValue(0, T, expectedDiv);
  for (const a of agents) {
    // At end, shares are worthless. Total wealth = cash accumulated.
    a.finalWealth = a.cash;
    a.totalPnL = a.cash - initialCash; // Net gain from trading + dividends
  }

  // Bubble metrics
  const bubble = bubbleMetrics(prices, fvs);

  return {
    agents, prices, fvs, volumes, spreads, rounds, bubble,
    T, expectedDiv, totalShares, params,
  };
}

/* ---- Communication for declining FV model ---- */
function communicationRoundDFV(agents, lastPrice, fv, g, params) {
  const messages = [];
  const refPrice = lastPrice != null ? lastPrice : fv;
  for (const a of agents) {
    const cl = Math.max(0, Math.exp((params.clMean || 0) + randn(g)));
    const cd = Math.max(0, Math.exp((params.cdMean || 0) + randn(g)));
    const direction = a.belief > refPrice ? -1 : 1;
    const benefit = Math.abs(a.belief - refPrice) * 0.3;
    const bias = direction * Math.max(0, benefit - cl - cd * 0.5);
    const message = a.belief + bias;
    const isLie = Math.abs(bias) > 0.01 * fv;
    messages.push({ senderId: a.id, message, bias, isLie, isDeceptive: isLie && Math.abs(bias) > 0.05 * fv });
  }
  // Receivers incorporate messages (simplified)
  for (const a of agents) {
    if (a.expType === 'inexperienced') {
      const otherMsgs = messages.filter(m => m.senderId !== a.id);
      const avgMsg = avg(otherMsgs.map(m => m.message));
      a.belief = 0.7 * a.belief + 0.3 * avgMsg; // partial update
    }
  }
  return messages;
}

/* ================================================================
   Alpha sweep — find alpha* for a given configuration
   ================================================================ */

function runAlphaSweep(baseParams, onProgress) {
  const alphaSteps = baseParams.alphaSteps || 20;
  const replications = baseParams.replications || 20;
  const results = [];

  for (let i = 0; i <= alphaSteps; i++) {
    const alpha = i / alphaSteps;
    const reps = [];

    for (let k = 0; k < replications; k++) {
      const result = runMarket({
        ...baseParams,
        alpha,
        seed: (baseParams.seed || 42) + k * 10000 + i * 137,
      });
      reps.push(result.bubble);
    }

    results.push({
      alpha,
      haesselR2: avg(reps.map(r => r.haesselR2)),
      napd:      avg(reps.map(r => r.napd)),
      amplitude: avg(reps.map(r => r.amplitude)),
      avgDev:    avg(reps.map(r => r.avgDev)),
      maxDev:    avg(reps.map(r => r.maxDev)),
      // Standard errors
      napd_se:   Math.sqrt(avg(reps.map(r => (r.napd - avg(reps.map(x => x.napd))) ** 2)) / replications),
    });

    if (onProgress) onProgress((i + 1) / (alphaSteps + 1));
  }

  // Find alpha*: first alpha where NAPD drops below threshold
  const threshold = baseParams.bubbleThreshold || 0.15;
  let alphaStar = 1.0;
  for (const r of results) {
    if (r.napd < threshold) { alphaStar = r.alpha; break; }
  }

  return { results, alphaStar, threshold };
}

/* ================================================================
   Full experiment — sweep n, risk, knowledge → alpha* surface
   ================================================================ */

function runExperiment(config, onProgress) {
  const {
    nValues, riskConfigs, knowledgeConfigs,
    baseParams,
  } = config;

  const total = nValues.length * riskConfigs.length * knowledgeConfigs.length;
  let done = 0;
  const experimentResults = [];

  for (const n of nValues) {
    for (const risk of riskConfigs) {
      for (const know of knowledgeConfigs) {
        const params = {
          ...baseParams,
          n,
          rlPct: risk.rl, rnPct: risk.rn,
          inexpBias: know.bias,
          inexpNoise: know.noise,
          inexpAnchor: know.anchor != null ? know.anchor : baseParams.inexpAnchor,
        };

        const sweep = runAlphaSweep(params);

        experimentResults.push({
          n, risk, knowledge: know,
          alphaStar: sweep.alphaStar,
          sweep: sweep.results,
          threshold: sweep.threshold,
        });

        done++;
        if (onProgress) onProgress(done / total);
      }
    }
  }

  return experimentResults;
}

/* ================================================================
   Backward-compatible wrapper — "single simulation" mode
   Maps old params to new engine
   ================================================================ */

function runSimulation(params) {
  const {
    n, informedPct, partialPct, rlPct, rnPct,
    trueValue, optimismBias, rounds, communication,
    momentum, clMean, cdMean, seed,
  } = params;

  // Map informed% to alpha (experienced fraction)
  const alpha = (informedPct + partialPct * 0.5) / 100;

  const result = runMarket({
    n,
    T: rounds || 15,
    expectedDiv: (trueValue || 100) / (rounds || 15),
    alpha,
    rlPct: rlPct || 33,
    rnPct: rnPct || 34,
    initialCash: 1000,
    initialShares: 5,
    expNoise: 0.05,
    inexpBias: (optimismBias || 20) / 100,
    inexpNoise: 0.25,
    inexpAnchor: 0.4,
    momentum: (momentum || 10) / 100,
    communication: communication || false,
    clMean: clMean || 0,
    cdMean: cdMean || 0,
    seed: seed || 42,
  });

  // Map to old format for chart compatibility
  const history = {
    prices: result.prices,
    fvs: result.fvs,
    volumes: result.volumes,
    spreads: result.spreads,
    rounds: result.rounds,
    agents: result.agents.map(a => ({
      ...a,
      infoType: a.expType === 'experienced' ? 'informed' : 'uninformed',
      signal: a.belief,
    })),
    trueValue: trueValue || 100,
    bubble: result.bubble,
    infoAggregation: result.bubble.haesselR2,
    params,
    _raw: result,
  };

  return history;
}
