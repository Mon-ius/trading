/**
 * AI Agent Engine — Multi-provider LLM agents for the market simulation.
 * Supports: Anthropic, OpenAI, Google, DeepSeek, Qwen, MiniMax, Kimi, Zhipu.
 * Administrator model generates tailored prompts → dispatched to heterogeneous agents.
 * Following the same pattern as the lying project.
 */

/* ---- Retry with backoff for 429 rate-limit errors ---- */
async function withRetry(fn, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) {
      if (i < retries && /429|rate.limit/i.test(e.message)) {
        await new Promise(r => setTimeout(r, (i + 1) * 15000));
      } else throw e;
    }
  }
}

/* ---- Shared OpenAI-compatible API call ---- */
function _openaiCall(label, defaultEP) {
  return async (cfg, system, prompt) => {
    const r = await fetch(cfg.endpoint || defaultEP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model, temperature: 0.4,
        ...(/^(gpt-5|o[3-9]|o[1-9]\d)/.test(cfg.model) ? { max_completion_tokens: cfg.maxTokens || 1024 } : { max_tokens: cfg.maxTokens || 1024 }),
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`${label} ${r.status}: ${await r.text()}`);
    const d = await r.json();
    return d.choices[0].message.content.trim();
  };
}

/* ---- Provider Registry ---- */
const PROVIDERS = {
  claude: {
    name: 'Claude',
    models: [
      { id: 'claude-opus-4-6', label: 'Opus 4.6' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    ],
    defaultEndpoint: 'https://anthropic-20250719-b6006324.rootdirectorylab.com/v1/messages',
    call: async (cfg, system, prompt) => {
      const r = await fetch(cfg.endpoint || PROVIDERS.claude.defaultEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: cfg.model, max_tokens: cfg.maxTokens || 1024, temperature: 0.4,
          system, messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
      const d = await r.json();
      return d.content[0].text.trim();
    },
  },
  gpt: {
    name: 'GPT',
    models: [
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
      { id: 'o3', label: 'o3' },
      { id: 'o4-mini', label: 'o4-mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
    defaultEndpoint: 'https://openai-20250719-f7491cbb.rootdirectorylab.com/v1/chat/completions',
    call: _openaiCall('GPT', 'https://openai-20250719-f7491cbb.rootdirectorylab.com/v1/chat/completions'),
  },
  gemini: {
    name: 'Gemini',
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    defaultEndpoint: 'https://gemini-20250719-bdb3d11b.rootdirectorylab.com/v1beta',
    call: async (cfg, system, prompt) => {
      const ep = cfg.endpoint || PROVIDERS.gemini.defaultEndpoint;
      const r = await fetch(`${ep}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: cfg.maxTokens || 1024 },
        }),
      });
      if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
      const d = await r.json();
      return d.candidates[0].content.parts[0].text.trim();
    },
  },
  deepseek: {
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
      { id: 'deepseek-chat', label: 'DeepSeek V3' },
    ],
    defaultEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    call: _openaiCall('DeepSeek', 'https://api.deepseek.com/v1/chat/completions'),
  },
  qwen: {
    name: 'Qwen',
    models: [
      { id: 'qwen3-max', label: 'Qwen3 Max' },
      { id: 'qwen3.5-plus', label: 'Qwen3.5 Plus' },
      { id: 'qwq-plus', label: 'QwQ Plus' },
      { id: 'qwen3.5-flash', label: 'Qwen3.5 Flash' },
      { id: 'qwen-turbo', label: 'Qwen Turbo' },
    ],
    defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    call: _openaiCall('Qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'),
  },
  minimax: {
    name: 'MiniMax',
    models: [
      { id: 'MiniMax-M2.7', label: 'M2.7' },
      { id: 'MiniMax-M2.5', label: 'M2.5' },
      { id: 'MiniMax-M2.1', label: 'M2.1' },
    ],
    defaultEndpoint: 'https://api.minimax.io/v1/chat/completions',
    call: _openaiCall('MiniMax', 'https://api.minimax.io/v1/chat/completions'),
  },
  kimi: {
    name: 'Kimi',
    models: [
      { id: 'kimi-k2.5', label: 'Kimi K2.5' },
      { id: 'moonshot-v1-auto', label: 'Moonshot V1 Auto' },
      { id: 'moonshot-v1-128k', label: 'Moonshot V1 128K' },
    ],
    defaultEndpoint: 'https://api.moonshot.cn/v1/chat/completions',
    call: _openaiCall('Kimi', 'https://api.moonshot.cn/v1/chat/completions'),
  },
  glm: {
    name: 'GLM',
    models: [
      { id: 'glm-5', label: 'GLM-5' },
      { id: 'glm-4.5', label: 'GLM-4.5' },
      { id: 'glm-4.5-flash', label: 'GLM-4.5 Flash' },
    ],
    defaultEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    call: _openaiCall('GLM', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'),
  },
};

/* ---- Provider config — reads API key/endpoint per section ---- */
function getProviderCfg(provider, modelOverride, section, maxTokens) {
  const el = id => document.getElementById(id);
  const sec = section || 'admin';
  return {
    apiKey: el(`pk-${sec}`)?.value.trim() || '',
    endpoint: el(`pe-${sec}`)?.value.trim() || '',
    model: modelOverride || '',
    maxTokens: maxTokens || 1024,
  };
}

/* ---- Key placeholder hints ---- */
const KEY_PLACEHOLDERS = {
  claude:'sk-ant-...', gpt:'sk-...', gemini:'AIza...', deepseek:'sk-...',
  qwen:'sk-...', minimax:'...', kimi:'sk-...', glm:'...',
};
function updateSectionKey(sec) {
  const provSel = sec === 'admin'
    ? document.getElementById('orch-provider')
    : document.getElementById(`grp-${sec}-prov`);
  const pkEl = document.getElementById(`pk-${sec}`);
  const peEl = document.getElementById(`pe-${sec}`);
  if (provSel && pkEl) pkEl.placeholder = KEY_PLACEHOLDERS[provSel.value] || 'API Key';
  if (peEl) {
    const prov = provSel?.value;
    const hasFixedEP = prov === 'claude' || prov === 'gpt' || prov === 'gemini';
    peEl.value = hasFixedEP ? PROVIDERS[prov].defaultEndpoint : (peEl.dataset.userVal || '');
    peEl.disabled = hasFixedEP;
    if (!hasFixedEP) peEl.dataset.userVal = peEl.value;
  }
}

/* ---- System prompt for trading ---- */
const TRADING_CONTEXT = `You are an AI agent participating in a Continuous Double Auction (CDA) market simulation based on Dufwenberg, Lindqvist & Moore (2005, AER) "Bubbles and Experience."

MARKET STRUCTURE:
- Asset has a finite life of T periods. Each period it pays a stochastic dividend: 0 or 2×E[d] with equal probability.
- Fundamental Value at period t: FV(t) = (T - t) × E[d], declining linearly to 0 at period T.
- Agents trade by submitting bid/ask orders. Trades execute when max(bid) ≥ min(ask).
- Your goal: maximize final cash holdings through profitable trading.

KEY INSIGHTS (from paper):
- Experienced agents who know FV suppress bubble formation.
- Inexperienced agents tend to overvalue the asset (optimism bias, anchoring, momentum).
- The critical fraction α* of experienced agents needed to prevent bubbles is the central research question.

RISK TYPES:
- Risk-loving (ρ < 0.01): wider spread tolerance, aggressive trading
- Risk-neutral (ρ ≈ 0.02): moderate spread, balanced trading
- Risk-averse (ρ > 0.05): narrow spread, conservative trading`;

/* ---- Administrator: generate per-agent valuation prompts ---- */
async function orchestrateTradePrompts(agents, period, T, fv, lastPrice, priceHistory, orchCfg) {
  const provider = PROVIDERS[orchCfg.provider];
  if (!provider) throw new Error('Invalid administrator provider');

  const histStr = priceHistory.length > 0 ? priceHistory.map((p,i) => `P${i+1}=$${p.toFixed(1)}`).join(', ') : 'none';

  const BATCH = 5;
  const allResults = [];
  for (let i = 0; i < agents.length; i += BATCH) {
    const batch = agents.slice(i, i + BATCH);
    const agentList = batch.map(a =>
      `  ${a.id}: experience=${a.expType}, risk=${a.riskType}, ρ=${a.riskAversion.toFixed(4)}, cash=$${a.cash.toFixed(0)}, shares=${a.shares}`
    ).join('\n');

    const orchPrompt = `You are the administrator for a CDA market experiment.
Period ${period + 1}/${T}. FV=$${fv.toFixed(1)}. Last price=${lastPrice != null ? '$' + lastPrice.toFixed(1) : 'none'}.
Price history: [${histStr}]

AGENTS:
${agentList}

For EACH agent, write a 2-sentence prompt: state their situation (period, FV, cash, shares, risk type), then ask for their asset valuation estimate as a single dollar amount.
Output ONLY: [{"id":N,"prompt":"..."},...]`;

    const cfg = getProviderCfg(orchCfg.provider, orchCfg.model, 'admin', 2048);
    const raw = await withRetry(() => provider.call(cfg, TRADING_CONTEXT, orchPrompt));

    const jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    try {
      const parsed = JSON.parse(jsonStr);
      allResults.push(...parsed);
    } catch {
      throw new Error('Administrator returned invalid JSON: ' + raw.substring(0, 200));
    }
  }
  return allResults;
}

/* ---- Dispatch prompt to individual agent — returns valuation ---- */
async function dispatchTradeAgent(agent, prompt) {
  const provider = PROVIDERS[agent.aiProvider];
  if (!provider) throw new Error(`Unknown provider: ${agent.aiProvider}`);
  const cfg = getProviderCfg(agent.aiProvider, agent.aiModel, agent.aiSection);
  if (!cfg.apiKey) throw new Error(`No API key for ${agent.aiProvider} (${agent.aiSection})`);

  const system = TRADING_CONTEXT + '\n\nYou must output ONLY a single number representing your dollar valuation of the asset. No explanation — just the number.';
  const raw = await withRetry(() => provider.call(cfg, system, prompt));

  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`No number in response: "${raw.substring(0, 100)}"`);
  return { value: parseFloat(match[1]), raw };
}

/* ---- Fallback prompt ---- */
function buildTradeFallbackPrompt(agent, period, T, fv, lastPrice) {
  return `Period ${period + 1}/${T}. FV=$${fv.toFixed(1)}. Last price=${lastPrice != null ? '$' + lastPrice.toFixed(1) : 'none'}.
You are ${agent.expType} with ${agent.riskType.replace('_','-')} risk (ρ=${agent.riskAversion.toFixed(3)}).
Cash=$${agent.cash.toFixed(0)}, shares=${agent.shares}.
What is your valuation of the asset? Output a single dollar amount:`;
}

/* ---- Build agent roster from UI ---- */
function buildTradeRoster() {
  const counts = getTradeGroupCounts();
  const groups = ['rl', 'rn', 'ra'];
  const roster = [];
  for (const g of groups) {
    const provEl = document.getElementById(`grp-${g}-prov`);
    const modelEl = document.getElementById(`grp-${g}-model`);
    if (!provEl || !modelEl) continue;
    for (let i = 0; i < counts[g]; i++) roster.push({ provider: provEl.value, model: modelEl.value, riskGroup: g });
  }
  return roster;
}

function getTradeGroupCounts() {
  const n = +document.getElementById('p-n').value;
  const rl = +document.getElementById('p-rl').value;
  const rn = +document.getElementById('p-rn').value;
  const tot = rl + rn + (100 - rl - rn);
  return {
    rl: Math.round(n * rl / tot),
    rn: Math.round(n * rn / tot),
    ra: n - Math.round(n * rl / tot) - Math.round(n * rn / tot),
  };
}

function updateTradeGroupCounts() {
  const c = getTradeGroupCounts();
  const el = id => document.getElementById(id);
  if (el('rc-rl')) el('rc-rl').value = c.rl;
  if (el('rc-rn')) el('rc-rn').value = c.rn;
  if (el('rc-ra')) el('rc-ra').value = c.ra;
}

/* ---- Main AI Trading Experiment ---- */
async function runAITradingExperiment(progressCb) {
  const orchProvider = document.getElementById('orch-provider').value;
  const orchModel = document.getElementById('orch-model').value;
  const orchCfg = { provider: orchProvider, model: orchModel };

  const params = readSimParams();
  const { n, T, expectedDiv, rlPct, rnPct, initialCash, initialShares, seed } = params;

  const g = mulberry32(seed || 42);
  const agents = createMarketAgents(params, g);

  // Assign AI providers to agents based on risk group
  const roster = buildTradeRoster();
  const riskToGroup = { risk_loving: 'rl', risk_neutral: 'rn', risk_averse: 'ra' };
  agents.forEach(a => {
    const grp = riskToGroup[a.riskType];
    const provEl = document.getElementById(`grp-${grp}-prov`);
    const modelEl = document.getElementById(`grp-${grp}-model`);
    a.aiProvider = provEl ? provEl.value : 'claude';
    a.aiModel = modelEl ? modelEl.value : 'claude-haiku-4-5';
    a.aiSection = grp;
  });

  const prices = [], fvs = [], volumes = [], spreads = [];
  const rounds = [];
  const aiLog = [];
  let lastPrice = null, prevPrice = null;

  const totalSteps = T * (1 + agents.length);
  let step = 0;

  for (let period = 0; period < T; period++) {
    const fv = fundamentalValue(period, T, expectedDiv);
    fvs.push(fv);

    // AI belief update: orchestrate prompts for this period
    if (progressCb) progressCb(++step, totalSteps, `Period ${period + 1}: Orchestrating...`);

    let agentPrompts;
    try {
      agentPrompts = await orchestrateTradePrompts(agents, period, T, fv, lastPrice, prices, orchCfg);
    } catch (e) {
      agentPrompts = agents.map(a => ({ id: a.id, prompt: buildTradeFallbackPrompt(a, period, T, fv, lastPrice) }));
      aiLog.push({ type: 'orchestrator', period, status: 'fallback', error: e.message });
    }

    const promptMap = {};
    for (const p of agentPrompts) promptMap[p.id] = p.prompt;

    // Dispatch to each agent (concurrency 4)
    const concurrency = 4;
    for (let i = 0; i < agents.length; i += concurrency) {
      const batch = agents.slice(i, i + concurrency);
      await Promise.all(batch.map(async (a) => {
        const prompt = promptMap[a.id] || buildTradeFallbackPrompt(a, period, T, fv, lastPrice);
        const entry = { type: 'agent', period, id: a.id, provider: a.aiProvider, model: a.aiModel, belief: null, error: null };
        try {
          const { value, raw } = await dispatchTradeAgent(a, prompt);
          a.belief = Math.max(0, value);
          entry.belief = a.belief;
        } catch (e) {
          entry.error = e.message;
          // Fallback: use engine's belief update
          updateAgentBelief(a, period, T, expectedDiv, lastPrice, prevPrice, params, g);
          entry.belief = a.belief;
        }
        aiLog.push(entry);
        if (progressCb) progressCb(++step, totalSteps, `Period ${period + 1}: ${a.name} (${a.aiProvider})...`);
      }));
    }

    // Order computation + CDA matching (same as engine)
    const orders = computeOrders(agents, fv);
    const { trades, vwap, volume } = matchOrders(orders, agents);

    const allBids = orders.map(o => o.bid).sort((a, b) => b - a);
    const allAsks = orders.map(o => o.ask).sort((a, b) => a - b);
    const bestBid = allBids[0] || 0, bestAsk = allAsks[0] || 0;

    prevPrice = lastPrice;
    if (vwap != null) lastPrice = vwap;
    prices.push(lastPrice != null ? lastPrice : fv);
    volumes.push(volume);
    spreads.push(bestAsk - bestBid);

    for (const tr of trades) {
      const bt = agents[tr.buyerId].trades;
      bt[bt.length - 1].period = period;
      const st = agents[tr.sellerId].trades;
      st[st.length - 1].period = period;
    }

    const div = g() < 0.5 ? 0 : 2 * expectedDiv;
    for (const a of agents) {
      const earned = div * a.shares;
      a.cash += earned;
      a.dividendsReceived += earned;
    }

    rounds.push({ period, fv, div, trades, vwap, volume, bestBid, bestAsk, orders });
  }

  // Final P&L
  for (const a of agents) {
    a.finalWealth = a.cash;
    a.totalPnL = a.cash - initialCash;
  }

  const bubble = bubbleMetrics(prices, fvs);

  return { agents, prices, fvs, volumes, spreads, rounds, bubble, T, expectedDiv, params, aiLog };
}

/* ---- Group model UI helpers ---- */
function updateGroupModels(group) {
  const p = document.getElementById(`grp-${group}-prov`).value;
  const modelSel = document.getElementById(`grp-${group}-model`);
  const prov = PROVIDERS[p];
  if (prov && modelSel) modelSel.innerHTML = prov.models.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
}

function initGroupModels() {
  ['rl', 'rn', 'ra'].forEach(g => {
    const provEl = document.getElementById(`grp-${g}-prov`);
    if (provEl) { updateGroupModels(g); updateSectionKey(g); }
  });
  updateOrchModels();
  updateSectionKey('admin');
  updateTradeGroupCounts();
}

function updateOrchModels() {
  const p = document.getElementById('orch-provider')?.value;
  const modelSel = document.getElementById('orch-model');
  const prov = PROVIDERS[p];
  if (prov && modelSel) modelSel.innerHTML = prov.models.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
}
