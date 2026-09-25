// Touches configurables : action -> code physique (KeyboardEvent.code ou « MouseN »)

export const KEY_ACTIONS = [
  { cat: 'Déplacement', list: [
    ['forward', 'Avancer', 'KeyW'], ['back', 'Reculer', 'KeyS'], ['left', 'Aller à gauche', 'KeyA'], ['right', 'Aller à droite', 'KeyD'],
    ['jump', 'Sauter / nager / monter', 'Space'], ['sneak', 'S\'accroupir / descendre', 'ShiftLeft'], ['sprint', 'Sprinter', 'ControlLeft'],
  ] },
  { cat: 'Actions', list: [
    ['attack', 'Attaquer / miner', 'Mouse0'], ['use', 'Utiliser / poser', 'Mouse2'], ['pickBlock', 'Choisir le bloc visé', 'Mouse1'],
    ['drop', 'Jeter l\'objet', 'KeyQ'], ['inventory', 'Inventaire', 'KeyE'], ['zoom', 'Zoom', 'KeyC'],
  ] },
  { cat: 'Interface', list: [
    ['chat', 'Ouvrir le chat', 'KeyT'], ['command', 'Taper une commande', 'Slash'], ['advancements', 'Progrès', 'KeyL'],
    ['hideHud', 'Masquer l\'interface', 'F1'], ['screenshot', 'Capture d\'écran', 'F2'], ['debug', 'Informations de débogage', 'F3'], ['perspective', 'Changer de vue', 'F5'],
  ] },
  { cat: 'Barre d\'action', list: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ['hotbar' + i, 'Emplacement ' + i, 'Digit' + i]) },
];

export const DEFAULT_KEYS = {};
export const ACTION_LABEL = {};
for (const c of KEY_ACTIONS) for (const [a, label, code] of c.list) { DEFAULT_KEYS[a] = code; ACTION_LABEL[a] = label; }

const NAMES = {
  Space: 'Espace', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droit',
  AltLeft: 'Alt', AltRight: 'Alt Gr', MetaLeft: 'Méta', MetaRight: 'Méta', Tab: 'Tab', CapsLock: 'Verr. Maj', Enter: 'Entrée',
  Backspace: 'Retour arrière', Escape: 'Échap', ArrowUp: 'Flèche haut', ArrowDown: 'Flèche bas', ArrowLeft: 'Flèche gauche', ArrowRight: 'Flèche droite',
  Slash: '/', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: '\'', Backslash: '\\',
  Comma: ',', Period: '.', IntlBackslash: '<', Insert: 'Inser', Delete: 'Suppr', Home: 'Début', End: 'Fin', PageUp: 'Pg préc', PageDown: 'Pg suiv',
  Mouse0: 'Clic gauche', Mouse1: 'Clic molette', Mouse2: 'Clic droit', Mouse3: 'Bouton souris 4', Mouse4: 'Bouton souris 5',
  NumpadEnter: 'Entrée (pavé)', NumpadAdd: '+ (pavé)', NumpadSubtract: '- (pavé)', NumpadMultiply: '* (pavé)', NumpadDivide: '/ (pavé)',
};

// Libellés réels selon la disposition du clavier (API Keyboard, si disponible)
let layout = null;
try {
  if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then((m) => { layout = m; }).catch(() => {});
} catch (e) { /* indisponible */ }

export function keyName(code) {
  if (!code) return 'Aucune';
  if (layout && layout.get(code)) {
    const k = layout.get(code);
    if (k.trim()) return k.length === 1 ? k.toUpperCase() : k;
  }
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return code.slice(6) + ' (pavé)';
  return code;
}

// Fusionne les touches enregistrées avec les valeurs par défaut
export function loadKeys(saved) {
  const k = Object.assign({}, DEFAULT_KEYS);
  if (saved && typeof saved === 'object') for (const a of Object.keys(DEFAULT_KEYS)) if (typeof saved[a] === 'string') k[a] = saved[a];
  return k;
}

// Actions partageant la même touche (conflits affichés en rouge)
export function conflicts(keys) {
  const by = {};
  for (const [a, c] of Object.entries(keys)) if (c) (by[c] = by[c] || []).push(a);
  const out = new Set();
  for (const list of Object.values(by)) if (list.length > 1) for (const a of list) out.add(a);
  return out;
}
