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
    this.displayName = `${id + 1}.${name}`;
    this.infoType = infoType;
    this.riskType = riskType;
    this.x = x; this.y = y;
    this.tx = x; this.ty = y;
    this._gridX = x; this._gridY = y;
    this._moveDelay = 0;
    this.agent = null;
    this.active = false;
    this.pnlFlash = null;
    this.bubble = null;
    this.label = '';
  }

  moveTo(x, y) { this.tx = x; this.ty = y; }

  update(dt, speed) {
    if (this._moveDelay > 0) { this._moveDelay -= dt * speed; return; }
    const sp = 4 * speed;
    this.x += (this.tx - this.x) * Math.min(1, sp * dt);
    this.y += (this.ty - this.y) * Math.min(1, sp * dt);
    if (this.pnlFlash) {
      this.pnlFlash.alpha -= dt * 1.5;
      if (this.pnlFlash.alpha <= 0) this.pnlFlash = null;
    }
    if (this.bubble) {
      this.bubble.alpha -= dt * 0.8;
      if (this.bubble.alpha <= 0) this.bubble = null;
    }
  }

  draw(ctx, sc, isDark) {
    const r = 12 * sc;
    const { x, y } = this;
    const fgMain = isDark ? '#e6edf3' : '#1a1d23';

    // Body — color by experience type
    const expType = this.agent ? this.agent.expType : this.infoType;
    ctx.fillStyle = expType === 'experienced' ? '#2563eb' : '#dc2626';
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
    ctx.arc(x - 3.5 * sc, y - 2 * sc, 1.8 * sc, 0, Math.PI * 2);
    ctx.arc(x + 3.5 * sc, y - 2 * sc, 1.8 * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y + 2.5 * sc, 3.5 * sc, 0, Math.PI);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * sc;
    ctx.stroke();

    // Name label — pill background for readability
    const nameText = this.displayName;
    ctx.font = `600 ${8 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';

    // Measure combined width: name + optional P&L badge
    let pnlText = '';
    let pnlColor = '';
    if (this.pnlFlash) {
      const pf = this.pnlFlash;
      pnlText = (pf.value >= 0 ? '+' : '') + pf.value.toFixed(0);
      pnlColor = pf.value >= 0 ? '#34C759' : '#FF3B30';
    }

    const nameW = ctx.measureText(nameText).width;
    ctx.font = `700 ${7 * sc}px monospace`;
    const pnlW = pnlText ? ctx.measureText(pnlText).width : 0;
    const totalW = nameW + (pnlText ? pnlW + 6 * sc : 0) + 8 * sc;
    const ny = y + r + 12 * sc;

    // Pill background
    ctx.fillStyle = isDark ? 'rgba(22,27,34,0.85)' : 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.roundRect(x - totalW / 2, ny - 8 * sc, totalW, 11 * sc, 3 * sc);
    ctx.fill();

    // Name text
    const nameX = pnlText ? x - (pnlW + 6 * sc) / 2 : x;
    ctx.font = `600 ${8 * sc}px -apple-system, sans-serif`;
    ctx.fillStyle = fgMain;
    ctx.fillText(nameText, nameX, ny);

    // P&L badge inline after name
    if (pnlText) {
      const pf = this.pnlFlash;
      ctx.globalAlpha = Math.min(1, pf.alpha);
      ctx.font = `700 ${7 * sc}px monospace`;
      ctx.fillStyle = pnlColor;
      ctx.fillText(pnlText, nameX + nameW / 2 + 4 * sc + pnlW / 2, ny);
      ctx.globalAlpha = 1;
    }

    // Speech bubble
    if (this.bubble) {
      const b = this.bubble;
      ctx.globalAlpha = Math.min(1, b.alpha);
      const bx = x, by = y - r - 24 * sc;
      const bw = 44 * sc, bh = 16 * sc;
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

/* ---- Building definitions (base sizes, positioned dynamically) ---- */
/* All main-flow buildings share the same base width for visual alignment */
const BASE_W = 400;
const BUILDINGS = [
  { id: 'hub',    label: 'gw.hub',    w: BASE_W, h: 180, color: '#E8F5E9', darkColor: '#1a2e1a', phaseNum: '1' },
  { id: 'signal', label: 'gw.signal', w: BASE_W, h: 180, color: '#E3F2FD', darkColor: '#1a2540', phaseNum: '2' },
  { id: 'pit',    label: 'gw.pit',    w: BASE_W, h: 320, color: '#FFF3E0', darkColor: '#2d2614', _stageH: 80, phaseNum: '3' },
  { id: 'comm',   label: 'gw.comm',   w: 300, h: 280, color: '#F3E5F5', darkColor: '#231a35' },
  { id: 'settle', label: 'gw.settle', w: BASE_W, h: 200, color: '#FFFDE7', darkColor: '#2d2a14', phaseNum: '4' },
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
    this._camX = 0; this._camY = 200;
    this._camZoom = 1;
    this._camTarget = null;
    this._camFollow = true;
    this._initialZoomSet = false;
    this._animFrame = null;
    this._lastTime = 0;
    this._phase = 'idle';
    this._buildingMap = {};
    this._hasComm = false;

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
    const n = this.history.agents.length;
    const cols = Math.ceil(Math.sqrt(n * 1.5));
    const rows = Math.ceil(n / cols);
    const sc = Math.max(0.6, Math.min(1, 10 / Math.sqrt(n)));
    this._scale = sc;

    // Check if communication data exists
    this._hasComm = this.history.rounds.some(r => r.messages && r.messages.length > 0);

    // Compute uniform width for main-flow buildings
    const uniformW = Math.max(BASE_W, cols * 42 * sc + 50);

    for (const b of BUILDINGS) {
      if (b.id === 'comm' && !this._hasComm) continue;
      const copy = { ...b };
      if (b.id !== 'comm') {
        copy.w = uniformW; // all main buildings share the same width
      }
      if (b.id === 'hub' || b.id === 'signal' || b.id === 'settle') {
        copy.h = Math.max(b.h, rows * 48 * sc + 55);
      }
      if (b.id === 'pit') {
        const chartH = 70;  // height for Price/Bubble panel row
        copy._chartH = chartH;
        copy._stageH = Math.max(80, 65 * sc + 30);
        copy.h = Math.max(b.h, rows * 48 * sc + 55 + chartH + copy._stageH);
      }
      this._buildingMap[copy.id] = copy;
    }

    // Stack buildings vertically, all centered at x=0
    const GAP = 30;
    let y = 0;
    const flow = this._hasComm ? ['hub', 'signal', 'pit', 'settle'] : ['hub', 'signal', 'pit', 'settle'];
    for (const id of flow) {
      const b = this._buildingMap[id];
      if (!b) continue;
      b.x = 0;
      b.y = y + b.h / 2;
      y += b.h + GAP;
    }
    // Comm lounge beside pit (when present)
    if (this._hasComm && this._buildingMap.comm) {
      const pit = this._buildingMap.pit;
      const comm = this._buildingMap.comm;
      comm.x = pit.x - pit.w / 2 - comm.w / 2 - 20;
      comm.y = pit.y;
    }
  }

  _initSprites() {
    const agents = this.history.agents;
    for (const a of agents) {
      const expType = a.expType || a.infoType;
      const sp = new Sprite(a.id, a.name, expType, a.riskType, 0, 0);
      sp.agent = a;
      sp.displayName = a.displayName || `${a.id + 1}.${a.name}`;
      sp.label = expType === 'experienced' ? t('info.experienced') : t('info.inexperienced');
      this.sprites.push(sp);
    }
  }

  _setupInput() {
    const cv = this.canvas;
    let dragging = false, dragSX, dragSY, dragOX, dragOY, lastPinch = 0;

    cv.addEventListener('mousedown', e => {
      dragging = true; dragSX = e.clientX; dragSY = e.clientY;
      dragOX = this._camX; dragOY = this._camY;
      cv.style.cursor = 'grabbing'; this._camFollow = false;
      this._ensureDrawing();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      this._camX = dragOX - (e.clientX - dragSX) / this._camZoom;
      this._camY = dragOY - (e.clientY - dragSY) / this._camZoom;
      this._ensureDrawing();
    });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; cv.style.cursor = 'grab'; } });

    cv.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        dragging = true; dragSX = e.touches[0].clientX; dragSY = e.touches[0].clientY;
        dragOX = this._camX; dragOY = this._camY; this._camFollow = false;
        this._ensureDrawing();
      } else if (e.touches.length === 2) {
        dragging = false;
        lastPinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    cv.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && dragging) {
        this._camX = dragOX - (e.touches[0].clientX - dragSX) / this._camZoom;
        this._camY = dragOY - (e.touches[0].clientY - dragSY) / this._camZoom;
        this._ensureDrawing();
      } else if (e.touches.length === 2 && lastPinch > 0) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this._camZoom = clamp(this._camZoom * (dist / lastPinch), 0.3, 5);
        lastPinch = dist;
      }
    }, { passive: true });
    cv.addEventListener('touchend', () => { dragging = false; lastPinch = 0; }, { passive: true });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this._camZoom = clamp(this._camZoom * (e.deltaY > 0 ? 0.9 : 1.1), 0.3, 5);
      this._ensureDrawing();
    }, { passive: false });

    cv.style.cursor = 'grab';
  }

  _resize() {
    const cv = this.canvas;
    const w = cv.parentElement.clientWidth || 800;
    const h = Math.max(480, cv.parentElement.clientHeight || 480);
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    // Fit buildings to viewport width on first layout
    if (!this._initialZoomSet) {
      this._initialZoomSet = true;
      const bw = this._buildingMap.hub ? this._buildingMap.hub.w : BASE_W;
      // On mobile (<600px CSS), zoom in tighter so buildings are clearly readable
      const margin = w < 600 ? 10 : 40;
      const fitZoom = (w * devicePixelRatio) / (bw + margin);
      this._camZoom = clamp(fitZoom, 0.8, 5);
    }
  }

  /* ---- Arrangement helpers ---- */
  _arrangeIn(buildingId, list, stagger) {
    const b = this._buildingMap[buildingId];
    if (!b) return;
    const sc = this._scale;
    const headerH = 28;
    const chartH = b._chartH || 0;
    const stageH = b._stageH || 0;
    const padX = 20, padY = 14;
    const cellW = 42 * sc, cellH = 48 * sc;
    const areaTop = b.y - b.h / 2 + headerH + chartH + stageH;
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
    const chartH = b._chartH || 0;
    const stageH = b._stageH || 80;
    return { x: b.x, y: b.y - b.h / 2 + headerH + chartH + stageH / 2 + 5 };
  }

  _focusBuilding(id) {
    if (!this._camFollow) return;
    const b = this._buildingMap[id];
    if (!b) return;
    this._camTarget = { x: b.x, y: b.y, zoom: Math.min(1.8, this.canvas.width / ((b.w + 80) * this._scale * devicePixelRatio)) };
  }

  _focusStage(id) {
    if (!this._camFollow) return;
    const b = this._buildingMap[id];
    if (!b) return;
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
    const isDark = typeof _isDark === 'function' && _isDark();

    // Background
    ctx.fillStyle = isDark ? '#0d1117' : '#f0f2f5';
    ctx.fillRect(0, 0, W, H);

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

    this._drawConnections(ctx, isDark);
    this._drawBuildings(ctx, isDark);
    this._drawPriceDisplay(ctx, isDark);
    this._drawBubbleMeter(ctx, isDark);

    const sc = this._scale;
    for (const sp of this.sprites) sp.draw(ctx, sc, isDark);

    ctx.restore();
  }

  _drawConnections(ctx, isDark) {
    const flow = ['hub', 'signal', 'pit', 'settle'];
    const arrowColor = isDark ? 'rgba(37,99,235,0.5)' : 'rgba(37,99,235,0.6)';
    const textColor = isDark ? 'rgba(37,99,235,0.4)' : 'rgba(37,99,235,0.5)';
    const sc = this._scale;

    for (let i = 0; i < flow.length - 1; i++) {
      const from = this._buildingMap[flow[i]];
      const to = this._buildingMap[flow[i + 1]];
      if (!from || !to) continue;

      const x = from.x;
      const y1 = from.y + from.h / 2;
      const y2 = to.y - to.h / 2;
      const midY = (y1 + y2) / 2;

      // Arrow shaft
      ctx.strokeStyle = arrowColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y1 + 2);
      ctx.lineTo(x, y2 - 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowhead
      const ah = 8;
      ctx.fillStyle = arrowColor;
      ctx.beginPath();
      ctx.moveTo(x, y2 - 2);
      ctx.lineTo(x - ah / 2, y2 - ah - 2);
      ctx.lineTo(x + ah / 2, y2 - ah - 2);
      ctx.closePath();
      ctx.fill();

      // Flow labels
      const labels = ['Initialize', 'Signal', 'Trade'];
      ctx.fillStyle = textColor;
      ctx.font = `600 ${8 * sc}px -apple-system, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(labels[i] || '', x + 12, midY + 3);
    }

    // Comm lounge connection (if present)
    if (this._hasComm && this._buildingMap.comm && this._buildingMap.pit) {
      const pit = this._buildingMap.pit;
      const comm = this._buildingMap.comm;
      const y = comm.y;
      const x1 = comm.x + comm.w / 2;
      const x2 = pit.x - pit.w / 2;

      ctx.strokeStyle = isDark ? 'rgba(124,58,237,0.4)' : 'rgba(124,58,237,0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x1 + 2, y);
      ctx.lineTo(x2 - 2, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Bidirectional arrows
      const ah = 6;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(x2 - 2, y);
      ctx.lineTo(x2 - ah - 2, y - ah / 2);
      ctx.lineTo(x2 - ah - 2, y + ah / 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x1 + 2, y);
      ctx.lineTo(x1 + ah + 2, y - ah / 2);
      ctx.lineTo(x1 + ah + 2, y + ah / 2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = isDark ? 'rgba(124,58,237,0.3)' : 'rgba(124,58,237,0.4)';
      ctx.font = `600 ${7 * sc}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Talk', (x1 + x2) / 2, y - 8);
    }
  }

  _drawBuildings(ctx, isDark) {
    const sc = this._scale;
    for (const b of Object.values(this._buildingMap)) {
      const x = b.x - b.w / 2, y = b.y - b.h / 2;

      // Background
      ctx.fillStyle = isDark ? (b.darkColor || '#1c2129') : (b.color || '#f0f0f0');
      ctx.globalAlpha = isDark ? 0.6 : 0.35;
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, b.h, 12);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Border
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, b.h, 12);
      ctx.stroke();

      // Header bar
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
      ctx.beginPath();
      ctx.roundRect(x, y, b.w, 28, [12, 12, 0, 0]);
      ctx.fill();

      ctx.fillStyle = isDark ? '#e6edf3' : '#1a1d23';
      ctx.font = `700 ${12 * sc}px -apple-system, sans-serif`;
      ctx.textAlign = 'left';

      // Phase number badge
      if (b.phaseNum) {
        const bx = x + 10, by = y + 5;
        ctx.fillStyle = isDark ? 'rgba(37,99,235,0.3)' : 'rgba(37,99,235,0.15)';
        ctx.beginPath();
        ctx.arc(bx + 8, by + 9, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = isDark ? '#93c5fd' : '#2563eb';
        ctx.font = `700 ${9 * sc}px -apple-system, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(b.phaseNum, bx + 8, by + 12);
        ctx.textAlign = 'left';
        ctx.fillStyle = isDark ? '#e6edf3' : '#1a1d23';
        ctx.font = `700 ${12 * sc}px -apple-system, sans-serif`;
        ctx.fillText(t(b.label), bx + 22, y + 19);
      } else {
        ctx.fillText(t(b.label), x + 12, y + 19);
      }

      // Chart panel zone + stage zone for pit
      if (b.id === 'pit') {
        const chartH = b._chartH || 0;
        const stageH = b._stageH || 0;

        // Stage zone (below chart panels)
        if (stageH) {
          const sy = y + 28 + chartH;
          ctx.fillStyle = isDark ? 'rgba(37,99,235,0.08)' : 'rgba(0,122,255,0.06)';
          ctx.fillRect(x + 2, sy, b.w - 4, stageH);

          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = isDark ? 'rgba(37,99,235,0.2)' : 'rgba(0,122,255,0.2)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 8, sy + stageH);
          ctx.lineTo(x + b.w - 8, sy + stageH);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = isDark ? 'rgba(37,99,235,0.3)' : 'rgba(0,122,255,0.4)';
          ctx.font = `600 ${8 * sc}px -apple-system, sans-serif`;
          ctx.textAlign = 'right';
          ctx.fillText(t('gw.stage'), x + b.w - 10, sy + 13);
          ctx.fillText(t('gw.queue'), x + b.w - 10, sy + stageH + 15);
        }
      }
    }
  }

  _drawPriceDisplay(ctx, isDark) {
    if (this._priceHistory.length === 0) return;
    const pit = this._buildingMap.pit;
    if (!pit || !pit._chartH) return;
    const sc = this._scale;
    const chartH = pit._chartH;
    const pad = 6;
    const panelW = (pit.w - pad * 3) / 2;
    const panelH = chartH - pad * 2;
    const px = pit.x - pit.w / 2 + pad;
    const baseY = pit.y - pit.h / 2 + 28 + pad;

    ctx.fillStyle = isDark ? 'rgba(22,27,34,0.9)' : 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, baseY, panelW, panelH, 6);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = isDark ? '#e6edf3' : '#1d1d1f';
    ctx.font = `700 ${9 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('PRICE', px + 6, baseY + 13);

    const prices = this._priceHistory;
    const fvs = this.history.fvs || [];
    const tv = fvs.length > 0 ? fvs[Math.min(this._roundNum, fvs.length - 1)] : (this.history.trueValue || 100);
    const allVals = [...prices, ...fvs];
    const minP = Math.min(...allVals) * 0.8;
    const maxP = Math.max(...allVals) * 1.2;
    const range = maxP - minP || 1;
    const cX = px + 6, cY = baseY + 18, cW = panelW - 12, cH = panelH - 26;

    if (fvs.length > 1) {
      ctx.strokeStyle = 'rgba(52,199,89,0.5)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      for (let i = 0; i < fvs.length; i++) {
        const cx = cX + (i / Math.max(1, fvs.length - 1)) * cW;
        const cy = cY + cH - ((fvs[i] - minP) / range) * cH;
        i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < prices.length; i++) {
      const cx = cX + (i / Math.max(1, prices.length - 1)) * cW;
      const cy = cY + cH - ((prices[i] - minP) / range) * cH;
      i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    const last = prices[prices.length - 1];
    ctx.fillStyle = last > tv ? '#FF3B30' : '#34C759';
    ctx.font = `700 ${10 * sc}px monospace`;
    ctx.textAlign = 'right';
    ctx.fillText('$' + last.toFixed(1), px + panelW - 6, baseY + 13);
  }

  _drawBubbleMeter(ctx, isDark) {
    if (this._priceHistory.length === 0) return;
    const pit = this._buildingMap.pit;
    if (!pit || !pit._chartH) return;
    const sc = this._scale;
    const chartH = pit._chartH;
    const pad = 6;
    const panelW = (pit.w - pad * 3) / 2;
    const panelH = chartH - pad * 2;
    const bx = pit.x - pit.w / 2 + pad * 2 + panelW;
    const baseY = pit.y - pit.h / 2 + 28 + pad;

    ctx.fillStyle = isDark ? 'rgba(22,27,34,0.9)' : 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, baseY, panelW, panelH, 6);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = isDark ? '#e6edf3' : '#1d1d1f';
    ctx.font = `700 ${9 * sc}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('BUBBLE', bx + 6, baseY + 13);

    const barX = bx + 6, barY = baseY + 20, barW = panelW - 12, barH = 12;
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 3);
    ctx.fill();

    const pct = clamp(this._bubblePct, -1, 1);
    const mid = barX + barW / 2;
    const fillW = Math.abs(pct) * barW / 2;
    ctx.fillStyle = pct > 0 ? 'rgba(255,59,48,0.6)' : 'rgba(52,199,89,0.6)';
    if (pct > 0) ctx.fillRect(mid, barY, fillW, barH);
    else ctx.fillRect(mid - fillW, barY, fillW, barH);

    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid, barY - 2);
    ctx.lineTo(mid, barY + barH + 2);
    ctx.stroke();

    ctx.fillStyle = pct > 0 ? '#FF3B30' : '#34C759';
    ctx.font = `700 ${9 * sc}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText((pct > 0 ? '+' : '') + (pct * 100).toFixed(1) + '%', bx + panelW / 2, baseY + panelH - 5);
  }

  /* ---- Ensure canvas redraws on interaction (even after game ends) ---- */
  _ensureDrawing() {
    if (this.running) return;           // loop already active
    if (this._idleFrame) return;        // already scheduled
    this._idleFrame = requestAnimationFrame(() => {
      this._idleFrame = null;
      this._draw();
    });
  }

  /* ---- Animation loop ---- */
  _loop(time) {
    if (!this.running) return;
    const dt = Math.min(0.05, (time - this._lastTime) / 1000);
    this._lastTime = time;

    for (const sp of this.sprites) sp.update(dt, this.speed);
    this._draw();

    // Stop animation loop once 'done' phase settles (P&L flashes finished)
    if (this._phase === 'done') {
      this._doneTimer = (this._doneTimer || 0) + dt;
      if (this._doneTimer > 4) { // Allow 4 seconds for final P&L flashes
        this.running = false;
        this._draw(); // Final frame
        return;
      }
    }

    this._animFrame = requestAnimationFrame(t => this._loop(t));
  }

  start() {
    this.running = true;
    this._doneTimer = 0;
    this._lastTime = performance.now();
    this._loop(this._lastTime);
    this._playGame();
  }

  stop() {
    this.running = false;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }

  togglePause() { this.paused = !this.paused; }
  setFollow(f) { this._camFollow = f; }
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

    const fv0 = (history.fvs && history.fvs[0]) || history.trueValue || 100;
    for (const sp of this.sprites) {
      const isExp = sp.agent.expType === 'experienced';
      sp.pnlFlash = { value: isExp ? 0 : (sp.agent.belief - fv0), alpha: 2.0 };
      sp.label = isExp ? 'Experienced' : 'Inexperienced';
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

      // Communication phase
      if (this._hasComm && rd.messages && rd.messages.length > 0) {
        this._arrangeIn('comm', this.sprites, true);
        this._focusBuilding('comm');
        this._log('round', `Round ${r + 1}: Communication`);
        await this._wait(Math.round(600 * stepScale));

        for (const msg of rd.messages) {
          const sp = this.sprites[msg.senderId];
          if (!sp) continue;
          const label = msg.isLie ? 'LIE' : 'TRUTH';
          const val = msg.reported ?? msg.message ?? 0;
          sp.bubble = { text: `$${val.toFixed(0)} ${label}`, alpha: 2.0, isLie: msg.isLie };
        }
        await this._wait(Math.round(1200 * stepScale));

        this._arrangeIn('pit', this.sprites, true);
        this._focusBuilding('pit');
        await this._wait(Math.round(400 * stepScale));
      }

      // Trading
      if (rd.trades.length > 0) {
        const stage = this._stageCenter('pit');
        const nAnimate = Math.min(rd.trades.length, 5);

        for (let ti = 0; ti < nAnimate; ti++) {
          const trade = rd.trades[ti];
          const buyer = this.sprites[trade.buyerId];
          const seller = this.sprites[trade.sellerId];

          buyer.active = true;
          seller.active = true;
          buyer.moveTo(stage.x - 25, stage.y);
          seller.moveTo(stage.x + 25, stage.y);
          this._focusStage('pit');
          await this._wait(Math.round(400 * stepScale));

          const fvNow = (history.fvs && history.fvs[r]) || history.trueValue || 100;
          const buyPnL = fvNow - trade.price;
          const sellPnL = trade.price - fvNow;
          buyer.pnlFlash = { value: buyPnL, alpha: 1.5 };
          seller.pnlFlash = { value: sellPnL, alpha: 1.5 };
          await this._wait(Math.round(300 * stepScale));

          buyer.active = false;
          seller.active = false;
          buyer.moveTo(buyer._gridX, buyer._gridY);
          seller.moveTo(seller._gridX, seller._gridY);
        }

        if (rd.vwap != null) {
          this._priceHistory.push(rd.vwap);
          this._lastPrice = rd.vwap;
          const fvNow = (history.fvs && history.fvs[r]) || history.trueValue || 100;
          this._bubblePct = fvNow > 0 ? (rd.vwap - fvNow) / fvNow : 0;
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

    for (const sp of this.sprites) {
      sp.pnlFlash = { value: sp.agent.totalPnL, alpha: 3.0 };
      sp.label = `P&L: ${sp.agent.totalPnL >= 0 ? '+' : ''}${sp.agent.totalPnL.toFixed(0)}`;
    }

    const bubble = history.bubble || {};
    this._log('summary', 'Simulation Complete', [
      `Haessel-R\u00b2: ${(bubble.haesselR2 || 0).toFixed(3)}`,
      `NAPD: ${(bubble.napd || 0).toFixed(3)}`,
      `Total Trades: ${history.rounds.reduce((s, r) => s + (r.volume || 0), 0)}`,
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
