// Block + item definitions. Block ids < 100, item ids >= 100.
export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, COBBLE = 4, SAND = 5, LOG = 6,
  LEAVES = 7, WATER = 8, PLANKS = 9, GLASS = 10, BRICK = 11, SNOW = 12, BEDROCK = 13,
  COAL_ORE = 14, IRON_ORE = 15, GRAVEL = 16, LAMP = 19;
export const PICKAXE = 100;
export const SWORD = 101;
export const COAL = 102, IRON = 103, IRON_SWORD = 104, IRON_PICKAXE = 105;
export const NT = 32; // tiles in the texture atlas strip

// tex = [top, side, bottom] tile indices in the atlas; hardness = seconds to mine with a stone-age pickaxe
export const BLOCKS = [];
function def(id, name, tex, opts = {}) {
  BLOCKS[id] = { id, name, tex: Array.isArray(tex) ? tex : [tex, tex, tex], hardness: 0.5, ...opts };
}
def(GRASS, 'Grass Block', [0, 1, 2], { drop: DIRT, hardness: 0.35 });
def(DIRT, 'Dirt', 2, { hardness: 0.35 });
def(STONE, 'Stone', 3, { drop: COBBLE, hardness: 0.9 });
def(COBBLE, 'Cobblestone', 4, { hardness: 0.9 });
def(SAND, 'Sand', 5, { hardness: 0.35 });
def(LOG, 'Log', [7, 6, 7], { hardness: 0.6 });
def(LEAVES, 'Leaves', 8, { cutout: true, hardness: 0.2 });
def(WATER, 'Water', 9, { liquid: true });
def(PLANKS, 'Planks', 10, { hardness: 0.6 });
def(GLASS, 'Glass', 11, { cutout: true, hardness: 0.2 });
def(BRICK, 'Bricks', 12, { hardness: 0.9 });
def(SNOW, 'Snowy Grass', [13, 14, 2], { drop: DIRT, hardness: 0.35 });
def(BEDROCK, 'Bedrock', 15, { unbreakable: true });
def(COAL_ORE, 'Coal Ore', 16, { drop: COAL, hardness: 1.1 });
def(IRON_ORE, 'Iron Ore', 17, { drop: IRON, hardness: 1.1 });
def(GRAVEL, 'Gravel', 18, { hardness: 0.35 });
def(LAMP, 'Lamp', 19, { hardness: 0.3, light: true });

// Fast lookup tables
export const OPAQUE = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const CUTOUT = new Uint8Array(256);
for (const b of BLOCKS) {
  if (!b) continue;
  CUTOUT[b.id] = b.cutout ? 1 : 0;
  OPAQUE[b.id] = !b.cutout && !b.liquid ? 1 : 0;
  SOLID[b.id] = b.liquid ? 0 : 1;
}

// mineMult: multiplier on block hardness (lower = faster); damage: sword hit points
export const ITEMS = {
  [PICKAXE]: { id: PICKAXE, name: 'Pickaxe', tool: true, maxStack: 1, mineMult: 1 },
  [SWORD]: { id: SWORD, name: 'Sword', tool: true, maxStack: 1, damage: 4 },
  [COAL]: { id: COAL, name: 'Coal', maxStack: 64 },
  [IRON]: { id: IRON, name: 'Iron', maxStack: 64 },
  [IRON_SWORD]: { id: IRON_SWORD, name: 'Iron Sword', tool: true, maxStack: 1, damage: 7 },
  [IRON_PICKAXE]: { id: IRON_PICKAXE, name: 'Iron Pickaxe', tool: true, maxStack: 1, mineMult: 0.5 },
};

// integer-only, so ids from a loaded save can't be strings/arrays that slip past ===
export const isBlock = (id) => Number.isInteger(id) && id > 0 && id < 100 && !!BLOCKS[id] && !BLOCKS[id].liquid;
export const isItem = (id) => isBlock(id) || (Number.isInteger(id) && !!ITEMS[id]);
export const isSword = (id) => !!ITEMS[id]?.damage;
export const isPickaxe = (id) => !!ITEMS[id]?.mineMult;
export const itemName = (id) => (id >= 100 ? ITEMS[id]?.name ?? '?' : BLOCKS[id]?.name ?? '?');
export const maxStack = (id) => (id >= 100 ? ITEMS[id]?.maxStack ?? 1 : 64);
