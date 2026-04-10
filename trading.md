# Virtual Trading Simulator — Design Document

A naive in-silico replacement of the human laboratory in **Dufwenberg, Lindqvist & Moore (2005, AER)** "Bubbles and Experience", with the human subjects swapped out for the **Lopez-Lira (2025)** CARA / LLM trading-agent framework.

---

## Source Papers

- **Dufwenberg, Lindqvist & Moore (2005)** — *"Bubbles and Experience: An Experiment"*, **American Economic Review** 95(5):1731–1737. Defines the declining-FV asset, the CDA market, the bubble metrics (Haessel-R², NAPD, amplitude, turnover), and the *experience effect* (bubbles diminish across replays of the market with the same subjects).
- **Lopez-Lira (2025)** — *"Can Large Language Models Trade? Testing Financial Theories with LLM Agents in Market Simulations."* Provides the CARA utility agent architecture, the closed-form reservation prices `bid = belief − γσ²/2`, and the CDA matching engine that replaces human traders.

---

## Setting Panel — Every Slider Comes From a Paper Symbol

The sidebar exposes only parameters that appear (by name or by symbol) in one of the two source papers. Behavioural knobs that have no paper symbol (optimism bias, FV anchoring, momentum, belief noise, endowment variance) have all been removed. The full list:

| Symbol | Slider | Source | Meaning |
|---|---|---|---|
| **N** | Traders | DLM (2005) §I | Number of CDA traders. DLM used N = 6; we default to 20. |
| **T** | Periods | DLM (2005) §I | Asset life. FV(t) = (T − t)·E[d], reaches zero at period T. |
| **E[d]** | Expected dividend | DLM (2005) §I | Per-period dividend draw ∈ {0, 2·E[d]} with Pr = 0.5. |
| **C₀** | Initial cash | DLM (2005) §I | Cash endowment, equal across all N traders. |
| **S₀** | Initial shares | DLM (2005) §I | Share endowment, equal across all N traders. |
| **α** | Experienced fraction | DLM (2005) §II "α-treatment" | Within-session: fraction of agents who track FV(t) directly. |
| **e** | Experience replays | DLM (2005) Table 2 | Across-session: persistent replay counter. |
| **γ < 0 share** | Risk-loving fraction | Lopez-Lira (2025) §2 | CARA risk parameter γ ∈ [−0.008, 0.002]. |
| **γ ≈ 0 share** | Risk-neutral fraction | Lopez-Lira (2025) §2 | γ ∈ [0.002, 0.012]. |
| **γ > 0 share** | Risk-averse fraction | Lopez-Lira (2025) §2 | γ ∈ [0.012, 0.060]. |
| **PRNG seed** | Engineering | — | Reproducibility control: dividend draws, agent assignment, order shuffling. |

There are no behavioural knobs. The only learning lever is the experience counter `e`.

---

## Belief Dynamics

Every input is from the source papers. Experienced agents track the rational fundamental; inexperienced agents anchor on the *initial* fundamental value FV(0) and shed the anchor as their experience counter `e` grows.

```
ε ~ small symmetric noise (0.05)

belief^exp(t)   = FV(t) · (1 + ε)
belief^inexp(t) = [ FV(0)·0.5^e + FV(t)·(1 − 0.5^e) ] · (1 + ε)
```

At `e = 0` an inexperienced agent is fully anchored on FV(0) — the source of bubbles. After two replays the anchor weight is 1/4; after four, 1/16. This is the simplest possible computational analogue of DLM's "learning from playing the market" channel.

---

## CARA Reservation Prices (Lopez-Lira 2025)

Each agent submits one bid and one ask at the closed-form CARA-optimal reservation prices:

```
bid_i = belief_i − γ_i · σ² / 2
ask_i = belief_i + γ_i · σ² / 2
```

`γ` is signed: γ < 0 → risk-loving (narrow spreads, aggressive bidding); γ > 0 → risk-averse (wide spreads, conservative bids); γ ≈ 0 → reservation prices coincide with belief.

---

## Trading Mechanism: Continuous Double Auction

Each period:

1. **Belief update** for every agent (formulas above).
2. **Order computation** at CARA reservation prices.
3. **Shuffle** to remove arrival-order artefacts.
4. **Match** while max(bid) ≥ min(ask). Trade price = midpoint. No short-selling, no margin.
5. **Pay dividend** ∈ {0, 2·E[d]} with Pr = 0.5 to every share-holder.
6. **Record** VWAP, volume, best bid/ask, per-trade P&L.

---

## Bubble Metrics (DLM 2005 §II)

| Metric | Formula | Interpretation |
|---|---|---|
| **Haessel-R²** | 1 − Σ(P − FV)² / Σ(FV − F̄V)² | 1 = perfect tracking; <0 = worse than mean |
| **MSE** | Σ(P − FV)² / T | Average squared mispricing |
| **NAPD** | Σ\|P − FV\| / (T · FV(0)) | Normalised bubble magnitude (DLM Table 2) |
| **Amplitude** | (max(P − FV) − min(P − FV)) / FV(0) | Total price swing relative to FV(0) |
| **Turnover** | Total trades / total shares outstanding | Liquidity / disagreement proxy |

---

## Experience Replay Loop

`e ∈ {0, 1, 2, …}` is a persistent counter on each agent. When the experiment runs more than one session:

1. Reset cash and shares to (C₀, S₀).
2. Increment `e` by 1.
3. Re-run the T-period CDA with the same agents and risk types.
4. Inexperienced agents' anchor on FV(0) is now multiplied by `0.5^e`.

The Experience Effect chart (Fig. 6) plots Haessel-R², NAPD, and Amplitude across consecutive replays — the direct in-silico analogue of DLM (2005) Table 2.

---

## Visualisation

### Charts (Plotly)

1. **Price vs FV** — VWAP overlaid on the declining FV(t) path; bubble metrics annotated.
2. **Trading Volume** — trades per period as bars.
3. **Price Deviation from FV** — (P − FV)/FV per period; red = bubble, green = crash.
4. **Belief Trajectories** — sampled experienced (blue, FV(t)) and inexperienced (red, anchored) beliefs.
5. **P&L by Risk Type** — average P&L grouped by γ-type, split by experience.
6. **Experience Effect** — Haessel-R², NAPD, Amplitude across replays.

### Trading Floor (Canvas 2D)

Four-stage pipeline reflecting the DLM / Lopez-Lira protocol:

1. **Trader Initialization** — CARA agents drawn with γ, endowments allocated.
2. **Belief Formation** — experienced track FV(t); inexperienced anchor on FV(0) with weight `0.5^e`.
3. **Continuous Double Auction** — order matching at reservation prices with a live mini price chart and bubble meter.
4. **Dividend Settlement** — period payoffs paid; total P&L realised.

---

## Optional LLM Backend

If an API key is provided in the AI Agent panel, each agent's belief-formation function is replaced by a Claude / GPT call that receives the market context (period, FV, recent prices, the agent's type) and returns a numeric belief. The CDA, dividend payment, and bubble-metric computation are unchanged. Without an API key the simulator falls back to the closed-form CARA stochastic model — fully reproducible from the PRNG seed.

---

## Reproducibility

Static SPA — no build step, deployable to GitHub Pages. PRNG seeded for exact replication. JSON / CSV export of every session. EN / ZH i18n.

```
github.com/Mon-ius/trading
```
