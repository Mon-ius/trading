# Trading — Market Microstructure Simulator

## Deployment

This project is hosted on GitHub Pages at https://mon-ius.github.io/trading/

**After every code change, always commit and push to `main` so the live site stays current:**

```
git add <changed files>
git commit -m "description"
git push origin main
```

Never leave changes uncommitted or unpushed. The site must always reflect the latest code.

## Project structure

Static SPA — no build step. All files served directly:

- `index.html` — single page app (navbar, sidebar, chart/game views, architecture, glossary)
- `css/style.css` — design tokens, dark mode, responsive layout
- `js/engine.js` — simulation engine (CDA, agents, bubble metrics, alpha sweep)
- `js/i18n.js` — EN + ZH translations
- `js/charts.js` — Plotly chart rendering (6 sim + 4 experiment charts)
- `js/game.js` — canvas 2D trading floor visualization
- `js/app.js` — UI controller (theme, export, panel logic, event binding)
- `favicon.svg` — candlestick + alpha-star icon

## Key conventions

- i18n: every user-visible string uses `data-i18n` attributes + `t()` function
- Dark mode: CSS variables on `[data-theme]`, auto-detect via `prefers-color-scheme`
- Agent names: numbered format `"1.Ada"`, `"2.Ben"` — set via `assignDisplayNames()`
- Risk sliders: linked comp-bar, always sum to 100% via `constrainRisk()`
- Charts: HTML `<h4 class="chart-title">` above Plotly div, Plotly has `margin.t: 8` (no internal title)
- Game canvas: separate mouse/touch/wheel handlers — never use pointer events (conflict-prone)
- Sidebar: unified panels (no mode tabs), experiment params collapsed below divider
- Export: JSON and CSV from same `_history` / `_expResults` data source

## Research context

Based on Dufwenberg, Lindqvist & Moore (2005, AER) "Bubbles and Experience."
Core result: alpha* = f(n, risk_distribution, knowledge_distribution)
