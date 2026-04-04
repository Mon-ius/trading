/**
 * Trading Floor — Canvas 2D Game Visualization
 * Animates agents trading in a visual market environment.
 */

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
  constructor(id, name, infoType, riskType, x, y) {
    this.id = id;
    this.name = name;
    this.infoType = infoType;
    this.riskType = riskType;
    this.x = x; this.y = y;
    this.tx = x; this.ty = y;
    this._gridX = x; this._gridY = y;
    this._moveDelay = 0;
    this.agent = null;     // reference to engine agent
    this.active = false;
    this.pnlFlash = null;  // { value, alpha }
    this.bubble = null;    // { text, alpha, isLie }
    this.label = '';
  }

  moveTo(x, y) { this.tx = x; this.ty = y; }

  update(dt, speed) {
    if (this._moveDelay > 0) { this._moveDelay -= dt * speed; return; }
    const sp = 4 * speed;
    this.x += (this.tx - this.x) * Math.min(1, sp * dt);
    this.y += (this.ty - this.y) * Math.min(1, sp * dt);
    // Decay flashes
    if (this.pnlFlash) {
      this.pnlFlash.alpha -= dt * 1.5;
      if (this.pnlFlash.alpha <= 0) this.pnlFlash = null;
    }
    if (this.bubble) {
      this.bubble.alpha -= dt * 0.8;
      if (this.bubble.alpha <= 0) this.bubble = null;
    }
  }

  draw(ctx, sc) {
    const r = 10 * sc;
    const { x, y } = this;

    // Body
    const colors = {
      informed: '#007AFF', partial: '#FF9500', uninformed: '#FF3B30',
    };
    ctx.fillStyle = colors[this.infoType] || '#8E8E93';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Active ring
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
    ctx.arc(x - 3 * sc, y - 2 * sc, 1.5 * sc, 0, Math.PI * 2);
    ctx.arc(x + 3 * sc, y - 2 * sc, 1.5 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y + 2 * sc, 3 * sc, 0, Math.PI);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 * sc;
    ctx.stroke();

    // Name label
    ctx.fillStyle = '#1d1d1f';
    ctx.font = `600 ${8 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(this.name, x, y + r + 10 * sc);

    // Info type label
    ctx.fillStyle = '#6e6e73';
    ctx.font = `500 ${6 * sc}px -apple-system, sans-serif`;
    ctx.fillText(this.label || this.infoType, x, y + r + 18 * sc);

    // P&L flash
    if (this.pnlFlash) {
      const pf = this.pnlFlash;
      ctx.globalAlpha = pf.alpha;
      ctx.fillStyle = pf.value >= 0 ? '#34C759' : '#FF3B30';
      ctx.font = `700 ${10 * sc}px monospace`;
      ctx.fillText((pf.value >= 0 ? '+' : '') + pf.value.toFixed(1), x, y - r - 8 * sc);
      ctx.globalAlpha = 1;
    }

    // Speech bubble
    if (this.bubble) {
      const b = this.bubble;
      ctx.globalAlpha = b.alpha;
      const bx = x, by = y - r - 20 * sc;
      const bw = 40 * sc, bh = 16 * sc;
      ctx.fillStyle = b.isLie ? 'rgba(255,59,48,0.15)' : 'rgba(52,199,89,0.15)';
      ctx.strokeStyle = b.isLie ? '#FF3B30' : '#34C759';
      ctx.lineWidth = 1 * sc;
      ctx.beginPath();
      ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 4 * sc);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = b.isLie ? '#FF3B30' : '#34C759';
      ctx.font = `600 ${7 * sc}px -apple-system, sans-serif`;
      ctx.fillText(b.text, bx, by + 3 * sc);
      ctx.globalAlpha = 1;
    }
  }
}

/* ---- Buildings ---- */
const BUILDINGS = [
  { id: 'hub',    label: 'gw.hub',    x: 0, y: 0, w: 280, h: 200, color: '#E8F5E9' },
  { id: 'signal', label: 'gw.signal', x: 350, y: 0, w: 200, h: 200, color: '#E3F2FD' },
  { id: 'pit',    label: 'gw.pit',    x: 175, y: 280, w: 350, h: 300, color: '#FFF3E0', _stageH: 100 },
  { id: 'comm',   label: 'gw.comm',   x: -150, y: 280, w: 200, h: 200, color: '#F3E5F5' },
  { id: 'settle', label: 'gw.settle', x: 175, y: 650, w: 350, h: 200, color: '#FFFDE7' },
];

/* ---- TradingFloor (GameWorld) ---- */
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
    this._camX = 175; this._camY = 200;
    this._camZoom = 1;
    this._camTarget = null;
    this._camFollow = true;
    this._animFrame = null;
    this._lastTime = 0;
    this._phase = 'idle';
    this._buildingMap = {};

    // In-world data displays
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
    // Scale buildings based on agent count
    const n = this.history.agents.length;
    const cols = Math.ceil(Math.sqrt(n * 1.5));
    const rows = Math.ceil(n / cols);
    const sc = Math.max(0.6, Math.min(1, 10 / Math.sqrt(n)));
    this._scale = sc;

    for (const b of BUILDINGS) {
      const copy = { ...b };
      if (b.id === 'hub' || b.id === 'settle') {
        copy.w = Math.max(b.w, cols * 36 * sc + 40);
        copy.h = Math.max(b.h, rows * 30 * sc + 50);
      }
      if (b.id === 'pit') {
        copy.w = Math.max(b.w, cols * 36 * sc + 40);
        const stageH = Math.max(80, 65 * sc + 30);
        copy._stageH = stageH;
        copy.h = Math.max(b.h, rows * 30 * sc + 50 + stageH);
      }
      this._buildingMap[copy.id] = copy;
    }

    // Position buildings vertically
    let y = 0;
    for (const id of ['hub', 'signal', 'pit', 'settle']) {
      const b = this._buildingMap[id];
      b.y = y + b.h / 2;
      y += b.h + 40;
    }
    // Comm lounge beside pit
    const pit = this._buildingMap.pit;
    const comm = this._buildingMap.comm;
    comm.x = pit.x - pit.w / 2 - comm.w / 2 - 30;
    comm.y = pit.y;
  }

  _initSprites() {
    const agents = this.history.agents;
    for (const a of agents) {
      const sp = new Sprite(a.id, a.name, a.infoType, a.riskType, 0, 0);
      sp.agent = a;
      sp.label = t('info.' + a.infoType);
      this.sprites.push(sp);
    }
  }

  _setupInput() {
    const cv = this.canvas;
    let drag = false, lx, ly;
    cv.addEventListener('pointerdown', e => {
      drag = true; lx = e.clientX; ly = e.clientY;
      this._camFollow = false;
    });
    cv.addEventListener('pointermove', e => {
      if (!drag) return;
      this._camX -= (e.clientX - lx) / this._camZoom;
      this._camY -= (e.clientY - ly) / this._camZoom;
      lx = e.clientX; ly = e.clientY;
    });
    cv.addEventListener('pointerup', () => drag = false);
    cv.addEventListener('pointerleave', () => drag = false);
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const dz = e.deltaY > 0 ? 0.9 : 1.1;
      this._camZoom = clamp(this._camZoom * dz, 0.3, 4);
    }, { passive: false });
  }

  _resize() {
    const cv = this.canvas;
    const w = cv.parentElement.clientWidth || 800;
    const h = Math.max(480, cv.parentElement.clientHeight || 480);
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
  }

  /* ---- Arrangement helpers ---- */
  _arrangeIn(buildingId, list, stagger) {
    const b = this._buildingMap[buildingId];
    if (!b) return;
    const sc = this._scale;
    const headerH = 28;
    const stageH = b._stageH || 0;
    const padX = 18, padY = 12;
    const cellW = 34 * sc, cellH = 28 * sc;
    const areaTop = b.y - b.h / 2 + headerH + stageH;
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
    const stageH = b._stageH || 80;
    return { x: b.x, y: b.y - b.h / 2 + headerH + stageH / 2 + 5 };
  }

  _focusBuilding(id) {
    if (!this._camFollow) return;
    const b = this._buildingMap[id];
    this._camTarget = { x: b.x, y: b.y, zoom: Math.min(1.8, this.canvas.width / ((b.w + 80) * this._scale * devicePixelRatio)) };
  }

  _focusStage(id) {
    if (!this._camFollow) return;
    const b = this._buildingMap[id];
    const stageY = b.y - b.h / 2 + 28 + (b._stageH || 80) / 2;
    this._camTarget = { x: b.x, y: stageY - 40, zoom: Math.min(2.2, this.canvas.width / (300 * this._scale * devicePixelRatio)) };
  }

  /* ---- Wait helper ---- */
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
    ctx.clearRect(0, 0, W, H);

    // Camera lerp
    if (this._camTarget) {
      this._camX += (this._camTarget.x - this._camX) * 0.08;
      this._camY += (this._camTarget.y - this._camY) * 0.08;
      this._camZoom += (this._camTarget.zoom - this._camZoom) * 0.08;
    }

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(this._camZoom, this._camZoom);
    ctx.translate(-this._camX, -this._camY);

    // Draw buildings
    this._drawBuildings(ctx);

    // Draw sprites
    const sc = this._scale;
    for (const sp of this.sprites) sp.draw(ctx, sc);

    // Draw in-world price chart
    this._drawPriceDisplay(ctx);

    // Draw bubble meter
    this._drawBubbleMeter(ctx);

    ctx.restore();
  }

  _drawBuildings(ctx) {
    const sc = this._scale;
    for (const b of Object.values(this._buildingMap)) {
      const x = b.x - b.w / 2, y = b.y - b.h / 2;

      // Background
      ctx.fillStyle = b.color || '#f0f0f0';
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, b.h, 12);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, b.h, 12);
      ctx.stroke();

      // Header
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, 28, [12, 12, 0, 0]);
      ctx.fill();

      ctx.fillStyle = '#1d1d1f';
      ctx.font = `700 ${11 * sc}px -apple-system, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(t(b.label), x + 10, y + 18);

      // Stage zone for pit
      if (b._stageH && b.id === 'pit') {
        const sy = y + 28;
        ctx.fillStyle = 'rgba(0,122,255,0.06)';
        ctx.fillRect(x + 2, sy, b.w - 4, b._stageH);

        // Divider
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(0,122,255,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 8, sy + b._stageH);
        ctx.lineTo(x + b.w - 8, sy + b._stageH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels
        ctx.fillStyle = 'rgba(0,122,255,0.4)';
        ctx.font = `600 ${7 * sc}px -apple-system, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(t('gw.stage'), x + b.w - 8, sy + 12);
        ctx.fillText(t('gw.queue'), x + b.w - 8, sy + b._stageH + 14);
      }
    }
  }

  _drawPriceDisplay(ctx) {
    if (this._priceHistory.length === 0) return;
    const pit = this._buildingMap.pit;
    const x = pit.x + pit.w / 2 + 20;
    const y = pit.y - pit.h / 2 + 30;
    const w = 140, h = 90;
    const sc = this._scale;

    // Background
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill(); ctx.stroke();

    // Title
    ctx.fillStyle = '#1d1d1f';
    ctx.font = `700 ${8 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('PRICE', x + 6, y + 12);

    // Price line
    const prices = this._priceHistory;
    const tv = this.history.trueValue;
    const minP = Math.min(tv * 0.8, ...prices);
    const maxP = Math.max(tv * 1.2, ...prices);
    const range = maxP - minP || 1;
    const chartX = x + 6, chartY = y + 18, chartW = w - 12, chartH = h - 26;

    // True value line
    const tvY = chartY + chartH - ((tv - minP) / range) * chartH;
    ctx.strokeStyle = 'rgba(52,199,89,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(chartX, tvY);
    ctx.lineTo(chartX + chartW, tvY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price line
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < prices.length; i++) {
      const px = chartX + (i / Math.max(1, prices.length - 1)) * chartW;
      const py = chartY + chartH - ((prices[i] - minP) / range) * chartH;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Current price text
    const last = prices[prices.length - 1];
    ctx.fillStyle = last > tv ? '#FF3B30' : '#34C759';
    ctx.font = `700 ${9 * sc}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText('$' + last.toFixed(1), x + w - 6, y + 12);
  }

  _drawBubbleMeter(ctx) {
    if (this._priceHistory.length === 0) return;
    const pit = this._buildingMap.pit;
    const x = pit.x + pit.w / 2 + 20;
    const y = pit.y - pit.h / 2 + 130;
    const w = 140, h = 50;
    const sc = this._scale;

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#1d1d1f';
    ctx.font = `700 ${8 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('BUBBLE', x + 6, y + 12);

    // Meter bar
    const barX = x + 6, barY = y + 18, barW = w - 12, barH = 10;
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 3);
    ctx.fill();

    const pct = clamp(this._bubblePct, -1, 1);
    const mid = barX + barW / 2;
    const fillW = Math.abs(pct) * barW / 2;
    ctx.fillStyle = pct > 0 ? 'rgba(255,59,48,0.6)' : 'rgba(52,199,89,0.6)';
    if (pct > 0) {
      ctx.fillRect(mid, barY, fillW, barH);
    } else {
      ctx.fillRect(mid - fillW, barY, fillW, barH);
    }

    // Center tick
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid, barY - 2);
    ctx.lineTo(mid, barY + barH + 2);
    ctx.stroke();

    // Percentage
    ctx.fillStyle = pct > 0 ? '#FF3B30' : '#34C759';
    ctx.font = `700 ${9 * sc}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText((pct > 0 ? '+' : '') + (pct * 100).toFixed(1) + '%', x + w / 2, y + 42);
  }

  /* ---- Animation loop ---- */
  _loop(time) {
    if (!this.running) return;
    const dt = Math.min(0.05, (time - this._lastTime) / 1000);
    this._lastTime = time;

    for (const sp of this.sprites) sp.update(dt, this.speed);
    this._draw();
    this._animFrame = requestAnimationFrame(t => this._loop(t));
  }

  start() {
    this.running = true;
    this._lastTime = performance.now();
    this._loop(this._lastTime);
    this._playGame();
  }

  stop() {
    this.running = false;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }

  togglePause() { this.paused = !this.paused; }

  setFollow(f) {
    this._camFollow = f;
  }

  setZoom(z) { this._camZoom = z; }

  /* ---- Game sequence ---- */
  async _playGame() {
    const history = this.history;
    const agents = history.agents;
    const rounds = history.rounds;

    // Phase 1: Hub — spawn all agents
    this._phase = 'hub';
    this._arrangeIn('hub', this.sprites, true);
    this._focusBuilding('hub');
    this._log('phase', '1. Agent Hub', `${agents.length} agents initialized`);
    await this._wait(1500);

    // Phase 2: Signal Tower — agents receive signals
    this._phase = 'signal';
    this._arrangeIn('signal', this.sprites, true);
    this._focusBuilding('signal');
    this._log('phase', '2. Signal Tower', 'Agents receive private signals');
    await this._wait(1000);

    // Show signal values briefly
    for (const sp of this.sprites) {
      sp.pnlFlash = { value: sp.agent.signal - history.trueValue, alpha: 2.0 };
    }
    await this._wait(2000);

    // Phase 3: Trading rounds
    this._phase = 'trading';
    this._arrangeIn('pit', this.sprites, true);
    this._focusBuilding('pit');
    this._log('phase', '3. Trading Pit', `${rounds.length} rounds of CDA trading`);
    await this._wait(1000);

    const totalRounds = rounds.length;
    const stepScale = totalRounds <= 10 ? 1.0 : totalRounds <= 30 ? 0.6 : 0.3;

    for (let r = 0; r < totalRounds; r++) {
      if (!this.running) return;
      this._roundNum = r + 1;
      const rd = rounds[r];

      // Communication phase (if any)
      if (rd.messages && rd.messages.length > 0) {
        this._log('round', `Round ${r + 1}: Communication`);
        for (const msg of rd.messages) {
          const sp = this.sprites[msg.senderId];
          const label = msg.isLie ? 'LIE' : 'TRUTH';
          sp.bubble = { text: `$${msg.message.toFixed(0)} ${label}`, alpha: 1.5, isLie: msg.isLie };
        }
        await this._wait(Math.round(1200 * stepScale));
      }

      // Trading round
      if (rd.trades.length > 0) {
        // Animate each trade: buyer and seller briefly meet at stage center
        const stage = this._stageCenter('pit');
        const nAnimate = Math.min(rd.trades.length, 5); // Show up to 5 trades in detail

        for (let ti = 0; ti < nAnimate; ti++) {
          const trade = rd.trades[ti];
          const buyer = this.sprites[trade.buyerId];
          const seller = this.sprites[trade.sellerId];

          buyer.active = true;
          seller.active = true;
          buyer.moveTo(stage.x - 20, stage.y);
          seller.moveTo(stage.x + 20, stage.y);
          this._focusStage('pit');
          await this._wait(Math.round(400 * stepScale));

          // Show P&L
          const buyPnL = history.trueValue - trade.price;
          const sellPnL = trade.price - history.trueValue;
          buyer.pnlFlash = { value: buyPnL, alpha: 1.5 };
          seller.pnlFlash = { value: sellPnL, alpha: 1.5 };
          await this._wait(Math.round(300 * stepScale));

          buyer.active = false;
          seller.active = false;
          buyer.moveTo(buyer._gridX, buyer._gridY);
          seller.moveTo(seller._gridX, seller._gridY);
        }

        // Update price display
        if (rd.vwap != null) {
          this._priceHistory.push(rd.vwap);
          this._lastPrice = rd.vwap;
          this._bubblePct = (rd.vwap - history.trueValue) / history.trueValue;
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
    this._log('phase', '4. Settlement', 'Final P&L calculated');
    await this._wait(1000);

    // Show final P&L
    for (const sp of this.sprites) {
      sp.pnlFlash = { value: sp.agent.totalPnL, alpha: 3.0 };
      // Color by result
      sp.label = `P&L: ${sp.agent.totalPnL >= 0 ? '+' : ''}${sp.agent.totalPnL.toFixed(0)}`;
    }

    const bubble = history.bubble;
    this._log('summary', 'Simulation Complete', [
      `Efficiency: ${(history.infoAggregation * 100).toFixed(1)}%`,
      `Max Bubble: ${(bubble.maxBubble * 100).toFixed(1)}%`,
      `Total Trades: ${history.rounds.reduce((s, r) => s + r.volume, 0)}`,
    ].join(' | '));

    this._phase = 'done';
  }

  /* ---- Logging ---- */
  _log(type, title, detail) {
    if (typeof window._gameLog === 'function') {
      window._gameLog(type, title, detail);
    }
  }
}
