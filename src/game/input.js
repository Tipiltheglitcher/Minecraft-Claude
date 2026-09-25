// Gestion du clavier, de la souris (pointer lock) et du tactile
export class Input {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // appuis de cette frame
    this.tickPressed = new Set(); // appuis depuis le dernier tick
    this.mouse = { left: false, right: false, middle: false, dx: 0, dy: 0, wheel: 0 };
    this.clicked = { left: false, right: false, middle: false };
    this.locked = false;
    this.dragLook = false;
    this.lastTap = {};
    this.touch = { active: false, moveId: null, lookId: null, mx: 0, my: 0, sx: 0, sy: 0, lx: 0, ly: 0 };
    this.bind();
  }

  bind() {
    const c = this.canvas;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    c.addEventListener('mousedown', (e) => {
      this.game.audio.init();
      if (this.game.ui.screenOpen()) return;
      if (!this.locked) {
        this.requestLock();
        if (!document.pointerLockElement && this.game.state === 'playing') this.dragLook = true;
        if (!this.dragLook) return;
      }
      if (e.button === 0) { this.mouse.left = true; this.clicked.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.clicked.right = true; }
      if (e.button === 1) { this.mouse.middle = true; this.clicked.middle = true; e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 1) this.mouse.middle = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.locked || (this.dragLook && (e.buttons & 1 || e.buttons & 2) && !this.game.ui.screenOpen())) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    });
    c.addEventListener('wheel', (e) => {
      if (!this.game.ui.screenOpen()) { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.dragLook = false;
      if (!this.locked && this.game.state === 'playing' && !this.game.ui.screenOpen() && !this.dragLook && !this.ignoreUnlock) {
        this.game.ui.openPause();
      }
      this.ignoreUnlock = false;
    });
    document.addEventListener('pointerlockerror', () => {
      this.dragLook = true;
    });
    // tactile
    c.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), { passive: false });
    c.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), { passive: false });
    c.addEventListener('touchend', (e) => this.onTouch(e, 'end'), { passive: false });
    c.addEventListener('touchcancel', (e) => this.onTouch(e, 'end'), { passive: false });
  }

  requestLock() {
    if (this.game.state !== 'playing') return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.dragLook = true; });
    } catch (e) {
      this.dragLook = true;
    }
  }

  releaseLock() {
    if (document.pointerLockElement) {
      this.ignoreUnlock = true;
      document.exitPointerLock();
    }
  }

  onKey(e, down) {
    const code = e.code;
    const ui = this.game.ui;
    if (down) this.game.audio.init();
    if (ui && ui.handleKey(e, down)) return;
    if (this.game.state !== 'playing') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'F1', 'F3', 'F5', 'Slash'].includes(code)) e.preventDefault();
    if (down) {
      if (!this.keys.has(code)) {
        this.pressed.add(code);
        this.tickPressed.add(code);
        const now = performance.now();
        if (this.lastTap[code] && now - this.lastTap[code] < 300) { this.pressed.add('double_' + code); this.tickPressed.add('double_' + code); }
        this.lastTap[code] = now;
      }
      this.keys.add(code);
    } else this.keys.delete(code);
  }

  down(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  endTick() {
    this.tickPressed.clear();
    this.clicked.left = this.clicked.right = this.clicked.middle = false;
  }

  endFrame() {
    this.pressed.clear();
    if (this.game.state !== 'playing' || this.game.paused) this.endTick();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }

  // ---------- tactile : moitié gauche = déplacement, moitié droite = regard ----------
  onTouch(e, kind) {
    if (this.game.state !== 'playing' || this.game.ui.screenOpen()) return;
    e.preventDefault();
    this.game.audio.init();
    const t = this.touch;
    t.active = true;
    const w = this.canvas.clientWidth;
    for (const tt of e.changedTouches) {
      if (kind === 'start') {
        if (tt.clientX < w / 2 && t.moveId === null) { t.moveId = tt.identifier; t.sx = tt.clientX; t.sy = tt.clientY; t.mx = 0; t.my = 0; }
        else if (t.lookId === null) { t.lookId = tt.identifier; t.lx = tt.clientX; t.ly = tt.clientY; t.lookStart = performance.now(); t.lookMoved = 0; }
      } else if (kind === 'move') {
        if (tt.identifier === t.moveId) { t.mx = (tt.clientX - t.sx) / 50; t.my = (tt.clientY - t.sy) / 50; }
        if (tt.identifier === t.lookId) {
          const dx = tt.clientX - t.lx, dy = tt.clientY - t.ly;
          this.mouse.dx += dx * 2; this.mouse.dy += dy * 2;
          t.lookMoved += Math.abs(dx) + Math.abs(dy);
          t.lx = tt.clientX; t.ly = tt.clientY;
          if (performance.now() - t.lookStart > 400 && t.lookMoved < 10) this.mouse.left = true;
        }
      } else {
        if (tt.identifier === t.moveId) { t.moveId = null; t.mx = t.my = 0; }
        if (tt.identifier === t.lookId) {
          if (performance.now() - t.lookStart < 250 && t.lookMoved < 10) this.clicked.right = true;
          this.mouse.left = false;
          t.lookId = null;
        }
      }
    }
  }
}
