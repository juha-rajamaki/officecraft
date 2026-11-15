// Block + item definitions. Block ids < 100, item ids >= 100.
export const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, COBBLE = 4, SAND = 5, LOG = 6,
  LEAVES = 7, WATER = 8, PLANKS = 9, GLASS = 10, BRICK = 11, SNOW = 12, BEDROCK = 13,
  COAL_ORE = 14, IRON_ORE = 15, GRAVEL = 16, LAMP = 19, TORCH = 20, CHEST = 21, GOLD_ORE = 22,
  DIAMOND_ORE = 23, BED = 24, DOOR_B = 25, DOOR_T = 26, DOOR_B_OPEN = 27, DOOR_T_OPEN = 28, LADDER = 29;
export const PICKAXE = 100;
export const SWORD = 101;
export const COAL = 102, IRON = 103, IRON_SWORD = 104, IRON_PICKAXE = 105;
export const AXE = 106, SHOVEL = 107, IRON_AXE = 108, IRON_SHOVEL = 109;
export const DIAMOND_PICKAXE = 110, DIAMOND_SWORD = 111, DIAMOND_AXE = 112, DIAMOND_SHOVEL = 113;
export const GOLD = 114, DIAMOND = 115, APPLE = 116, GOLDEN_APPLE = 117, DOOR = 118;
export const IRON_ARMOR = 119, GOLD_ARMOR = 120, DIAMOND_ARMOR = 121;
export const NT = 32; // tiles in the texture atlas strip

// tex = [top, side, bottom] tile indices in the atlas; hardness = seconds to mine with the right stone-age tool
// tool = which tool mines it fast (pick/axe/shovel); tier = pickaxe tier needed (2 = iron, 3 = diamond)
// solid: false = walk through; cross = drawn as two crossed quads; height < 1 = a low block (bed)
export const BLOCKS = [];
function def(id, name, tex, opts = {}) {
  BLOCKS[id] = { id, name, tex: Array.isArray(tex) ? tex : [tex, tex, tex], hardness: 0.5, ...opts };
}
def(GRASS, 'Grass Block', [0, 1, 2], { drop: DIRT, hardness: 0.35, tool: 'shovel' });
def(DIRT, 'Dirt', 2, { hardness: 0.35, tool: 'shovel' });
def(STONE, 'Stone', 3, { drop: COBBLE, hardness: 0.9, tool: 'pick' });
def(COBBLE, 'Cobblestone', 4, { hardness: 0.9, tool: 'pick' });
def(SAND, 'Sand', 5, { hardness: 0.35, tool: 'shovel' });
def(LOG, 'Log', [7, 6, 7], { hardness: 0.6, tool: 'axe' });
def(LEAVES, 'Leaves', 8, { cutout: true, hardness: 0.2 });
def(WATER, 'Water', 9, { liquid: true });
def(PLANKS, 'Planks', 10, { hardness: 0.6, tool: 'axe' });
def(GLASS, 'Glass', 11, { cutout: true, hardness: 0.2 });
def(BRICK, 'Bricks', 12, { hardness: 0.9, tool: 'pick' });
def(SNOW, 'Snowy Grass', [13, 14, 2], { drop: DIRT, hardness: 0.35, tool: 'shovel' });
def(BEDROCK, 'Bedrock', 15, { unbreakable: true });
def(COAL_ORE, 'Coal Ore', 16, { drop: COAL, hardness: 1.1, tool: 'pick' });
def(IRON_ORE, 'Iron Ore', 17, { drop: IRON, hardness: 1.1, tool: 'pick' });
def(GRAVEL, 'Gravel', 18, { hardness: 0.35, tool: 'shovel' });
def(LAMP, 'Lamp', 19, { hardness: 0.3, light: true });
def(TORCH, 'Torch', 20, { hardness: 0.05, light: true, cutout: true, solid: false, cross: true, flatIcon: true });
def(CHEST, 'Chest', [22, 21, 22], { hardness: 0.6, tool: 'axe' });
def(GOLD_ORE, 'Gold Ore', 23, { drop: GOLD, hardness: 1.4, tool: 'pick', tier: 2 });
def(DIAMOND_ORE, 'Diamond Ore', 24, { drop: DIAMOND, hardness: 1.8, tool: 'pick', tier: 2 });
def(BED, 'Bed', [25, 26, 10], { hardness: 0.3, cutout: true, height: 0.5625 });
def(DOOR_B, 'Door', [10, 27, 10], { hardness: 0.5, tool: 'axe', cutout: true, drop: DOOR, door: true, flatIcon: true });
def(DOOR_T, 'Door', [10, 28, 10], { hardness: 0.5, tool: 'axe', cutout: true, drop: DOOR, door: true });
def(DOOR_B_OPEN, 'Door', 29, { hardness: 0.5, tool: 'axe', cutout: true, solid: false, drop: DOOR, door: true, noCaps: true });
def(DOOR_T_OPEN, 'Door', 29, { hardness: 0.5, tool: 'axe', cutout: true, solid: false, drop: DOOR, door: true, noCaps: true });
def(LADDER, 'Ladder', 30, { hardness: 0.3, tool: 'axe', cutout: true, solid: false, climb: true, flatIcon: true, noCaps: true });

// Fast lookup tables
export const OPAQUE = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const CUTOUT = new Uint8Array(256);
export const HEIGHT = new Float32Array(256).fill(1); // collision height of each block
export const CLIMB = new Uint8Array(256);            // ladders
for (const b of BLOCKS) {
  if (!b) continue;
  HEIGHT[b.id] = b.height ?? 1;
  CLIMB[b.id] = b.climb ? 1 : 0;
  CUTOUT[b.id] = b.cutout ? 1 : 0;
  OPAQUE[b.id] = !b.cutout && !b.liquid ? 1 : 0;
  SOLID[b.id] = b.liquid || b.solid === false ? 0 : 1;
}

// kind: pick/axe/shovel; mineMult: multiplier on block hardness (lower = faster); tier: 1 stone, 2 iron, 3 diamond
// damage: sword hit points; food: hunger points restored (heal = extra health); armor: share of damage blocked
export const ITEMS = {};
function item(id, name, opts = {}) { ITEMS[id] = { id, name, maxStack: 64, ...opts }; }
const tool = (kind, mineMult, tier) => ({ tool: true, maxStack: 1, kind, mineMult, tier });
item(PICKAXE, 'Pickaxe', tool('pick', 1, 1));
item(IRON_PICKAXE, 'Iron Pickaxe', tool('pick', 0.5, 2));
item(DIAMOND_PICKAXE, 'Diamond Pickaxe', tool('pick', 0.3, 3));
item(AXE, 'Axe', tool('axe', 1, 1));
item(IRON_AXE, 'Iron Axe', tool('axe', 0.5, 2));
item(DIAMOND_AXE, 'Diamond Axe', tool('axe', 0.3, 3));
item(SHOVEL, 'Shovel', tool('shovel', 1, 1));
item(IRON_SHOVEL, 'Iron Shovel', tool('shovel', 0.5, 2));
item(DIAMOND_SHOVEL, 'Diamond Shovel', tool('shovel', 0.3, 3));
item(SWORD, 'Sword', { tool: true, maxStack: 1, damage: 4 });
item(IRON_SWORD, 'Iron Sword', { tool: true, maxStack: 1, damage: 7 });
item(DIAMOND_SWORD, 'Diamond Sword', { tool: true, maxStack: 1, damage: 10 });
item(COAL, 'Coal');
item(IRON, 'Iron');
item(GOLD, 'Gold');
item(DIAMOND, 'Diamond');
item(APPLE, 'Apple', { food: 4 });
item(GOLDEN_APPLE, 'Golden Apple', { food: 8, heal: 8 });
item(DOOR, 'Door', { maxStack: 16 });
item(IRON_ARMOR, 'Iron Armor', { maxStack: 1, armor: 0.3 });
item(GOLD_ARMOR, 'Gold Armor', { maxStack: 1, armor: 0.2 });
item(DIAMOND_ARMOR, 'Diamond Armor', { maxStack: 1, armor: 0.5 });

// integer-only, so ids from a loaded save can't be strings/arrays that slip past ===
export const isBlock = (id) => Number.isInteger(id) && id > 0 && id < 100 && !!BLOCKS[id] && !BLOCKS[id].liquid;
export const isItem = (id) => isBlock(id) || (Number.isInteger(id) && !!ITEMS[id]);
export const isSword = (id) => !!ITEMS[id]?.damage;
export const isTool = (id) => !!ITEMS[id]?.mineMult; // anything that mines: pickaxe, axe, shovel
export const isFood = (id) => !!ITEMS[id]?.food;
export const isArmor = (id) => !!ITEMS[id]?.armor;
export const itemName = (id) => (id >= 100 ? ITEMS[id]?.name ?? '?' : BLOCKS[id]?.name ?? '?');
export const maxStack = (id) => (id >= 100 ? ITEMS[id]?.maxStack ?? 1 : 64);
