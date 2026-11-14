// Crafting recipes: turn mined coal and iron into lamps and better tools.
import { LAMP, COAL, IRON, IRON_SWORD, IRON_PICKAXE } from './blocks.js';
import * as inv from './inventory.js';

export const RECIPES = [
  { out: [LAMP, 4], in: [[COAL, 1]] },
  { out: [IRON_PICKAXE, 1], in: [[IRON, 3]] },
  { out: [IRON_SWORD, 1], in: [[IRON, 3]] },
];

export function canCraft(r) {
  return r.in.every(([id, n]) => inv.countItem(id) >= n) && inv.roomFor(r.out[0]) >= r.out[1];
}

/** craft one batch; returns true on success */
export function craft(r) {
  if (!canCraft(r)) return false;
  for (const [id, n] of r.in) inv.removeItem(id, n);
  inv.addItem(r.out[0], r.out[1]);
  return true;
}
