// systems/hud.js — DOM overlay HUD (TECH.md: DOM, not canvas): growth
// progress bar at the bottom, stage banner on evolve, red flash on damage.
// Boot overlays (title/paused/dead/debug) stay in main.js.

import { on } from '../core/events.js';
import { STAGES } from '../data/stages.js';
import { stageProgress } from '../entities/player.js';

export function createHud(root) {
  const growth = document.createElement('div');
  growth.id = 'growth';
  const fill = document.createElement('div');
  fill.id = 'growth-fill';
  const label = document.createElement('span');
  label.id = 'growth-label';
  growth.append(fill, label);

  const banner = document.createElement('div');
  banner.id = 'stage-banner';

  const flash = document.createElement('div');
  flash.id = 'damage-flash';

  // Sprint bar + HP pips stacked above the growth bar
  const sprint = document.createElement('div');
  sprint.id = 'sprint';
  const sprintFill = document.createElement('div');
  sprintFill.id = 'sprint-fill';
  sprint.appendChild(sprintFill);

  const hp = document.createElement('div');
  hp.id = 'hp';
  const hpFill = document.createElement('div');
  hpFill.id = 'hp-fill';
  hp.appendChild(hpFill);

  const gobble = document.createElement('div');
  gobble.id = 'gobble';
  gobble.textContent = '0';

  root.append(flash, growth, sprint, hp, gobble, banner);

  function showBanner(text) {
    banner.textContent = text;
    banner.classList.remove('show');
    void banner.offsetWidth; // restart the CSS animation
    banner.classList.add('show');
  }

  on('player:evolve', ({ stage }) => showBanner(`STAGE ${stage} — ${STAGES[stage - 1].name.toUpperCase()}`));
  on('player:devolve', ({ stage }) => showBanner(`SHRUNK TO ${STAGES[stage - 1].name.toUpperCase()}`));
  on('player:damage', () => {
    flash.classList.remove('show');
    void flash.offsetWidth;
    flash.classList.add('show');
  });

  let lastFill = '', lastLabel = '', lastStam = '', lastHp = -1, lastMaxHp = -1, lastGobble = -1;
  return {
    update(player) {
      const t = stageProgress(player);
      const fillW = (t * 100).toFixed(1) + '%';
      if (fillW !== lastFill) { lastFill = fillW; fill.style.width = fillW; }
      const st = STAGES[player.stage - 1];
      const labelText =
        player.stage < STAGES.length
          ? `${st.name.toUpperCase()}  ${Math.floor(player.mass)} / ${STAGES[player.stage].mass}`
          : `${st.name.toUpperCase()}  ${Math.floor(player.mass)}`;
      if (labelText !== lastLabel) { lastLabel = labelText; label.textContent = labelText; }
      const stamW = (player.stamina * 100).toFixed(1) + '%';
      if (stamW !== lastStam) {
        lastStam = stamW;
        sprintFill.style.width = stamW;
        sprint.classList.toggle('low', player.stamina < 0.3);
      }
      if (player.hp !== lastHp || player.maxHp !== lastMaxHp) {
        lastHp = player.hp;
        lastMaxHp = player.maxHp;
        hpFill.style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
      }
      const g = player.gobbled ?? 0;
      if (g !== lastGobble) {
        lastGobble = g;
        gobble.textContent = String(g);
        gobble.classList.remove('pop');
        void gobble.offsetWidth;
        gobble.classList.add('pop');
      }
    },
    setVisible(v) {
      growth.classList.toggle('hidden', !v);
    },
  };
}
