# Market Microstructure Simulator — Design Document

## Theoretical Foundation

This simulator visualizes price discovery, bubble formation, and strategic communication in a continuous double auction (CDA) market populated by heterogeneous agents.

**Core papers:**

- **Kyle (1985)** — "Continuous Auctions and Insider Trading": Informed trading and price impact
- **Glosten & Milgrom (1985)** — "Bid, Ask and Transaction Prices": Adverse selection in order-driven markets
- **Grossman & Stiglitz (1980)** — "On the Impossibility of Informationally Efficient Markets": Information aggregation limits
- **Smith, Suchanek & Williams (1988)** — "Bubbles, Crashes, and Endogenous Expectations": Experimental bubbles
- **Choi, Lee & Lim (2025)** — "The Anatomy of Honesty": Lying/deception costs in strategic communication
- **Benabou & Laroque (1992)** — "Using Privileged Information to Manipulate Markets"

---

## Core Model

### True Value

An asset has a true fundamental value V* known only to the experimenter. Agents receive noisy private signals about V*.

### Agent Types by Information

| Type | Signal Noise (σ) | Precision (τ = 1/σ²) | Interpretation |
|------|------------------|-----------------------|----------------|
| **Informed** | 5% of V* | High | Knows value well (insider/analyst) |
| **Partial** | 15% of V* | Medium | Has some idea (sector expert) |
| **Uninformed** | 40% of V* | Low | Very uncertain (noise trader) |

Each agent i receives signal: **s_i = V* + bias_i + ε_i**, where ε_i ~ N(0, σ²_i)

Uninformed agents may have an optimism bias (shift), creating systematic mispricing.

### Risk Preferences (CARA Utility)

Agent utility: U_i(W) = -exp(-α_i * W)

| Type | α (risk aversion) | Behavior |
|------|-------------------|----------|
| **Risk-Loving** | ~0.003 | Trades aggressively, tight spreads |
| **Risk-Neutral** | ~0.015 | Moderate trading |
| **Risk-Averse** | ~0.060 | Trades cautiously, wide spreads |

### Order Computation

Given belief μ_i and precision τ_i:

```
Bid price = μ_i - α_i / (2 * τ_i)     (max willing to pay)
Ask price = μ_i + α_i / (2 * τ_i)     (min willing to sell)
```

The spread width reflects both uncertainty (1/τ) and risk aversion (α).

---

## Trading Mechanism: Continuous Double Auction

Each round:

1. **Order submission**: Every agent computes bid and ask prices
2. **Matching**: Bids sorted descending, asks ascending. Match while bid ≥ ask
3. **Execution**: Trade price = midpoint of matched bid and ask
4. **Market price**: Volume-weighted average of all transaction prices (VWAP)
5. **Belief update**: Agents learn from market price via Bayesian updating

### Bayesian Learning from Prices

After observing market price P_t:

```
τ'_i = τ_i + τ_P                    (precision increases)
μ'_i = (τ_i * μ_i + τ_P * P_t) / τ'_i   (belief moves toward price)
```

where τ_P is the informativeness of the market price.

---

## Bubble Dynamics

### Formation Mechanism

Bubbles form when uninformed agents have systematically biased beliefs:

- **Optimism bias > 0**: Uninformed signals biased upward → price inflated above V*
- **Optimism bias < 0**: Signals biased downward → price depressed below V*

### Momentum (Trend-Following)

Agents may extrapolate price trends:

```
belief_adjusted = belief + momentum * (P_t - P_{t-1})
```

High momentum amplifies bubbles and delays correction.

### Correction Mechanism

Informed agents trade against mispricing:
- When price > V*: Informed agents sell (they know it's overpriced)
- When price < V*: Informed agents buy (they know it's underpriced)

**Key question**: What percentage of informed agents is needed to bring price to true value?

### Bubble Metrics

- **Price efficiency**: 1 - |P_final - V*| / V*
- **Max bubble**: max_t |P_t - V*| / V*
- **Average deviation**: mean |P_t - V*| / V*

---

## Strategic Communication

When enabled, agents can send messages (cheap talk) before each trading round.

### Message Strategy

Each agent announces a "claimed value" for the asset:

```
message_i = signal_i + strategic_bias_i
```

- **Buyers** (belief > price): bias < 0 — understate value to buy cheap
- **Sellers** (belief < price): bias > 0 — overstate value to sell dear

### Moral Costs (from Choi et al. 2025)

Strategic bias is modulated by lying and deception costs:

```
net_benefit = strategic_benefit - c_l * I{bias ≠ 0} - c_d * |belief_distortion|
```

- **c_l**: Lying cost — penalty for sending message ≠ signal (literal falsehood)
- **c_d**: Deception cost — penalty for distorting receiver beliefs

### Lying vs Deception in Markets

| | Message ≠ Signal (Lie) | Message = Signal (Truth) |
|---|---|---|
| **Distorts beliefs** | Deceptive lie (common) | Deceptive truth (e.g., informed trader strategically revealing true signal to trigger panic) |
| **No belief distortion** | Non-deceptive lie (social convention) | Honest communication |

### Receiver Belief Update

Agents weight incoming messages by sender credibility:

```
credibility_k = 1 / (1 + count_of_past_lies_k * 0.5)
```

Repeated liars lose credibility — reputation mechanism analogous to Choi et al.'s sender-receiver game.

---

## Configurable Parameters

| Parameter | Default | Range | Paper Reference |
|---|---|---|---|
| Agents (n) | 20 | 2-128 | Population size |
| True Value (V*) | 100 | 1-10000 | Fundamental value |
| Rounds | 20 | 1-200 | Trading sessions |
| Informed % | 30 | 0-100 | Kyle (1985) |
| Partial % | 40 | 0-100 | Signal precision |
| Uninformed % | 30 | 0-100 | Noise traders |
| Risk-Loving % | 33 | 0-100 | CARA parameter |
| Risk-Neutral % | 34 | 0-100 | CARA parameter |
| Risk-Averse % | 33 | 0-100 | CARA parameter |
| Communication | Off | On/Off | Cheap talk |
| Lying Cost μ | 0 | -3 to 3 | Choi et al. (2025) |
| Deception Cost μ | 0 | -3 to 3 | Choi et al. (2025) |
| Optimism Bias | 20 | -50 to 50 | SSW (1988) |
| Momentum | 10 | 0-100 | Trend following |
| Seed | 42 | 0-9999 | Reproducibility |

---

## Visualization

### Chart View

1. **Price Discovery**: Market price vs true value over rounds (+ volume bars)
2. **Bid-Ask Spread**: Best bid/ask evolution showing spread compression
3. **P&L Distribution**: Histogram by information type (informed earn more)
4. **Bubble Deviation**: Per-round % deviation from true value
5. **Belief Convergence**: Sample agents' beliefs converging to true value
6. **Trading Volume**: Trades per round (+ lies per round if communication on)

### Game View (Trading Floor)

Canvas 2D animation with:

**Buildings/zones:**
- Agent Hub — agents spawn with info type colors
- Signal Tower — agents receive private signals (flash values)
- Trading Pit — stage/queue layout for CDA trading
- Communication Lounge — speech bubbles with strategic messages
- Settlement Hall — final P&L display

**In-world displays:**
- Real-time price chart (mini line chart on canvas)
- Bubble meter (deviation gauge)
- Per-trade P&L flashes (+green/-red)
- Speech bubbles with LIE/TRUTH tags

**Agent sprites:**
- Color-coded by information type (blue=informed, orange=partial, red=uninformed)
- Active ring during trades
- Animated movement with stagger to prevent collisions

---

## Output Metrics

| Metric | Description |
|---|---|
| Price Efficiency | How close final price is to true value |
| Max Bubble | Peak price deviation from true value |
| Total Trades | Number of executed transactions |
| Avg P&L (Informed) | Average profit of informed agents |
| Avg P&L (Uninformed) | Average loss of uninformed agents |
| Info Aggregation Speed | Rounds until price within 5% of V* |

---

## References

1. Kyle, A. S. (1985). Continuous Auctions and Insider Trading. *Econometrica*, 53(6), 1315-1335.
2. Glosten, L. R. & Milgrom, P. R. (1985). Bid, Ask and Transaction Prices. *Journal of Financial Economics*, 14(1), 71-100.
3. Grossman, S. J. & Stiglitz, J. E. (1980). On the Impossibility of Informationally Efficient Markets. *American Economic Review*, 70(3), 393-408.
4. Smith, V. L., Suchanek, G. L. & Williams, A. W. (1988). Bubbles, Crashes, and Endogenous Expectations. *Econometrica*, 56(5), 1119-1151.
5. Choi, S., Lee, C. & Lim, W. (2025). The Anatomy of Honesty: Lying Aversion vs. Deception Aversion. Working Paper.
6. Sobel, J. (2020). Lying and Deception in Games. *Journal of Political Economy*, 128(3), 907-947.
7. Benabou, R. & Laroque, G. (1992). Using Privileged Information to Manipulate Markets. *QJE*, 107(3), 921-958.
8. Crawford, V. & Sobel, J. (1982). Strategic Information Transmission. *Econometrica*, 50(6), 1431-1451.
