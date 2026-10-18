// Gestion du clavier, de la souris (pointer lock) et du tactile.
// Les actions passent par les touches configurables (settings.keys).
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
    this.touch = { active: false, moveId: null, lookId: null, mx: 0, my: 0, sx: 0, sy: 0, lx: 0, ly: 0, sprint: false, holding: null, lastTouch: 0 };
    this.bind();
  }

  get binds() {
    return this.game.settings.keys;
  }

  // Code physique (clavier ou souris) enfoncé / relâché : met à jour l'état des actions
  press(code, down) {
    const b = this.binds;
    if (code === b.attack) { this.mouse.left = down; if (down) this.clicked.left = true; }
    if (code === b.use) { this.mouse.right = down; if (down) this.clicked.right = true; }
    if (code === b.pickBlock) { this.mouse.middle = down; if (down) this.clicked.middle = true; }
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

  // État des actions
  held(action) { return this.keys.has(this.binds[action]); }
  hit(action) { return this.tickPressed.has(this.binds[action]); }
  hitFrame(action) { return this.pressed.has(this.binds[action]); }
  doubleHit(action) { return this.tickPressed.has('double_' + this.binds[action]); }

  releaseAll() {
    this.keys.clear();
    this.mouse.left = this.mouse.right = this.mouse.middle = false;
    const t = this.touch;
    t.moveId = t.lookId = null; t.mx = t.my = 0; t.sprint = false; t.holding = null;
  }

  bind() {
    const c = this.canvas;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    c.addEventListener('mousedown', (e) => {
      this.game.audio.init();
      if (this.game.ui.screenOpen()) return;
      if (!this.locked) {
        this.requestLock(true);
        // ce clic sert seulement à recapturer la souris (il ne mine pas et n'attaque pas),
        // sauf si le verrouillage est indisponible (page intégrée) : on regarde en glissant
        if (!this.dragLook) return;
      }
      if (e.button === 1) e.preventDefault();
      this.press('Mouse' + e.button, true);
    });
    window.addEventListener('mouseup', (e) => {
      if (this.keys.has('Mouse' + e.button) || e.button <= 2) this.press('Mouse' + e.button, false);
    });
    window.addEventListener('mousemove', (e) => {
      // vraie souris (pas un événement simulé après un appui tactile) : on quitte le mode tactile
      if ((e.movementX || e.movementY) && performance.now() - this.touch.lastTouch > 1500) this.game.ui.setTouchMode(false);
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
      if (this.locked) { this.dragLook = false; this.lockWorked = true; }
      if (!this.locked && this.game.state === 'playing' && !this.game.ui.screenOpen() && !this.dragLook && !this.ignoreUnlock) {
        this.game.ui.openPause();
      }
      this.ignoreUnlock = false;
    });
    document.addEventListener('pointerlockerror', () => this.lockError());
    // tactile
    c.addEventListener('touchstart', (e) => this.onTouch(e, 'start'), { passive: false });
    c.addEventListener('touchmove', (e) => this.onTouch(e, 'move'), { passive: false });
    c.addEventListener('touchend', (e) => this.onTouch(e, 'end'), { passive: false });
    c.addEventListener('touchcancel', (e) => this.onTouch(e, 'end'), { passive: false });
  }

  // soft : en cas de refus, on reste en jeu avec « Cliquez pour jouer » au lieu d'ouvrir la pause
  requestLock(soft = false) {
    if (this.game.state !== 'playing') return;
    this.softUntil = soft ? performance.now() + 1500 : 0;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this.lockError());
    } catch (e) {
      this.lockError();
    }
  }

  // Échec du verrouillage : si la souris a déjà été capturée, c'est qu'il manquait un clic → pause ;
  // sinon le verrouillage est indisponible (page intégrée) → regard en glissant
  lockError() {
    if (this.locked) return;
    if (this.lockWorked && performance.now() < (this.softUntil || 0)) return;
    if (this.lockWorked) this.game.ui.lockFailed();
    else this.dragLook = true;
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
    const b = this.binds;
    if (code === 'Tab' || code.startsWith('F') && /^F\d+$/.test(code) || code === b.jump || code === b.command || code === 'Space' || code.startsWith('Arrow')) e.preventDefault();
    if (down && e.repeat) return;
    this.press(code, down);
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

  // ---------- tactile (comme Minecraft Bedrock) ----------
  // moitié gauche : joystick qui apparaît sous le pouce (poussé à fond vers l'avant = sprint) ;
  // moitié droite : glisser pour regarder, appui bref = frapper / poser / utiliser,
  // doigt immobile 0,35 s = miner (ou manger, boire, bander l'arc) tant qu'il reste posé
  onTouch(e, kind) {
    const t = this.touch;
    t.lastTouch = performance.now();
    const ui = this.game.ui;
    ui.setTouchMode(true);
    const playing = this.game.state === 'playing' && !ui.screenOpen();
    if (!playing && kind === 'start') return;
    e.preventDefault();
    this.game.audio.init();
    t.active = true;
    const w = ui.viewW();
    const now = performance.now();
    const R = ui.joyRadius || 50;
    for (const tt of e.changedTouches) {
      // coordonnées dans le repère du jeu (l'affichage peut être tourné en paysage)
      const [x, y] = ui.toGame(tt.clientX, tt.clientY);
      if (kind === 'start') {
        if (x < w / 2 && t.moveId === null) {
          t.moveId = tt.identifier; t.sx = x; t.sy = y; t.mx = 0; t.my = 0; t.sprint = false;
          ui.joystick(x, y, 0, 0);
        } else if (t.lookId === null) {
          t.lookId = tt.identifier; t.lx = x; t.ly = y; t.ax = x; t.ay = y;
          t.lookStart = now; t.stillSince = now; t.dragged = false; t.holding = null;
          ui.touchRing(x, y, 'show');
        }
      } else if (kind === 'move') {
        if (tt.identifier === t.moveId) {
          let dx = (x - t.sx) / R, dy = (y - t.sy) / R;
          const l = Math.hypot(dx, dy);
          // la base suit le pouce s'il dépasse le cercle
          if (l > 1) { t.sx = x - (dx / l) * R; t.sy = y - (dy / l) * R; dx /= l; dy /= l; }
          t.mx = Math.abs(dx) < 0.12 ? 0 : dx;
          t.my = Math.abs(dy) < 0.12 ? 0 : dy;
          t.sprint = l >= 0.98 && dy < -0.85;
          ui.joystick(t.sx, t.sy, dx, dy, t.sprint);
        }
        if (tt.identifier === t.lookId) {
          const dx = x - t.lx, dy = y - t.ly;
          this.mouse.dx += dx * 2.2; this.mouse.dy += dy * 2.2;
          t.lx = x; t.ly = y;
          if (Math.hypot(x - t.ax, y - t.ay) > 10) {
            t.ax = x; t.ay = y; t.stillSince = now; t.dragged = true;
            if (!t.holding) ui.touchRing(x, y, 'show');
          }
          ui.touchRing(x, y);
        }
      } else {
        if (tt.identifier === t.moveId) { t.moveId = null; t.mx = t.my = 0; t.sprint = false; ui.joystick(null); }
        if (tt.identifier === t.lookId) {
          if (t.holding === 'use') this.mouse.right = false;
          else if (t.holding) this.mouse.left = false;
          else if (playing && !t.dragged && now - t.lookStart < 350) {
            if (this.game.interaction.touchAction(false) === 'attack') this.clicked.left = true;
            else this.clicked.right = true;
          }
          t.holding = null;
          t.lookId = null;
          ui.touchRing(0, 0, 'hide');
        }
      }
    }
  }

  // Appelé à chaque image : appui long et attaques répétées sur une créature
  updateTouch() {
    const t = this.touch;
    const g = this.game;
    g.ui.updateTouchUi();
    if (t.lookId === null || g.state !== 'playing' || g.ui.screenOpen()) return;
    const now = performance.now();
    if (!t.holding && now - t.stillSince > 350) {
      t.holding = g.interaction.touchAction(true);
      if (t.holding === 'use') { this.mouse.right = true; this.clicked.right = true; }
      else { this.mouse.left = true; this.clicked.left = true; t.lastHit = now; }
      g.ui.touchRing(t.lx, t.ly, 'hold');
      try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* facultatif */ }
    }
    // doigt maintenu sur une créature : un coup toutes les 0,5 s
    if (t.holding === 'break' && g.targetEntity && now - t.lastHit > 500) { this.clicked.left = true; t.lastHit = now; }
  }
}
