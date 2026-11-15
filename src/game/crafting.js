// Crafting recipes: turn logs, leaves and mined ores into tools, armor, food and furniture.
// Infinite starter stacks never count as ingredients (see inventory.countItem).
import {
  LAMP, TORCH, CHEST, BED, LADDER, LOG, LEAVES, COAL, IRON, GOLD, DIAMOND, APPLE, GOLDEN_APPLE, DOOR,
  AXE, SHOVEL, IRON_PICKAXE, IRON_SWORD, IRON_AXE, IRON_SHOVEL,
  DIAMOND_PICKAXE, DIAMOND_SWORD, DIAMOND_AXE, DIAMOND_SHOVEL, IRON_ARMOR, GOLD_ARMOR, DIAMOND_ARMOR,
} from './blocks.js';
import * as inv from './inventory.js';

export const RECIPES = [
  { out: [TORCH, 4], in: [[COAL, 1], [LOG, 1]] },
  { out: [LAMP, 4], in: [[COAL, 1]] },
  { out: [AXE, 1], in: [[LOG, 3]] },
  { out: [SHOVEL, 1], in: [[LOG, 2]] },
  { out: [CHEST, 1], in: [[LOG, 4]] },
  { out: [DOOR, 1], in: [[LOG, 3]] },
  { out: [LADDER, 4], in: [[LOG, 2]] },
  { out: [BED, 1], in: [[LOG, 3], [LEAVES, 3]] },
  { out: [IRON_PICKAXE, 1], in: [[IRON, 3]] },
  { out: [IRON_SWORD, 1], in: [[IRON, 3]] },
  { out: [IRON_AXE, 1], in: [[IRON, 3]] },
  { out: [IRON_SHOVEL, 1], in: [[IRON, 2]] },
  { out: [IRON_ARMOR, 1], in: [[IRON, 5]] },
  { out: [GOLD_ARMOR, 1], in: [[GOLD, 5]] },
  { out: [GOLDEN_APPLE, 1], in: [[APPLE, 1], [GOLD, 4]] },
  { out: [DIAMOND_PICKAXE, 1], in: [[DIAMOND, 3]] },
  { out: [DIAMOND_SWORD, 1], in: [[DIAMOND, 3]] },
  { out: [DIAMOND_AXE, 1], in: [[DIAMOND, 3]] },
  { out: [DIAMOND_SHOVEL, 1], in: [[DIAMOND, 2]] },
  { out: [DIAMOND_ARMOR, 1], in: [[DIAMOND, 5]] },
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
