// Point d'entrée
import { Game } from './game/game.js';
import { textureURL } from './ui/icons.js';

function fatal(msg) {
  const d = document.createElement('div');
  d.className = 'fatal';
  d.innerHTML = '<h1>Impossible de lancer le jeu</h1><p></p><p>Minecraft JS nécessite un navigateur récent compatible WebGL2 (Chrome, Firefox, Edge, Safari 15+).</p>';
  d.querySelector('p').textContent = msg;
  document.body.appendChild(d);
}

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  const ui = document.getElementById('ui');
  try {
    const game = new Game(canvas, ui);
    window.game = game;
    // fond « terre » des menus
    document.documentElement.style.setProperty('--dirt', `url(${textureURL('dirt', 4)})`);
    document.documentElement.style.setProperty('--stone', `url(${textureURL('stone', 4)})`);
  } catch (e) {
    console.error(e);
    fatal(e.message);
  }
});
