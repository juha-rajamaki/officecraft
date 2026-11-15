// World storage + generation. Data is column-major: index = (z*W + x)*H + y
// The world is four maps of R x R blocks in a 2x2 grid, joined by bridges where sea lies between them.
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, SNOW, BEDROCK,
  COAL_ORE, IRON_ORE, GOLD_ORE, DIAMOND_ORE, GRAVEL, SOLID, COBBLE, PLANKS, GLASS, BRICK, BLOCKS,
} from './blocks.js';
import { makeNoise2D, makeNoise3D, fbm2, mulberry32 } from './noise.js';

export const R = 512;                       // size of one map
export const W = R * 2, D = R * 2, H = 96, CS = 16, WATER_LEVEL = 32;

// the four maps; ox/oz = corner of the map in world blocks
export const REGIONS = [
  { name: 'Green Hills', kind: 'hills', ox: 0, oz: 0 },
  { name: 'Flatlands', kind: 'flat', ox: R, oz: 0 },
  { name: 'Archipelago', kind: 'islands', ox: 0, oz: R },
  { name: 'Desert', kind: 'desert', ox: R, oz: R },
];
/** which map a world position is on */
export const regionAt = (x, z) => REGIONS[(z >= R ? 2 : 0) + (x >= R ? 1 : 0)];

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

export class World {
  constructor() {
    this.data = new Uint8Array(W * D * H);
    this.tops = new Uint8Array(W * D); // highest non-air y per column (may be stale-high)
    this.edits = new Map();  // voxel index -> block id, every change the player made (for saving)
    this.lights = new Set(); // voxel indices of light-emitting blocks (lamps)
    this.lightChunks = new Map(); // chunk key (cz * W/CS + cx) -> Set of lamp indices in that chunk
    this.chests = new Map(); // voxel index -> array of CHEST_SIZE slots
  }

  get(x, y, z) {
    if (x < 0 || z < 0 || x >= W || z >= D || y >= H) return AIR;
    if (y < 0) return BEDROCK;
    return this.data[(z * W + x) * H + y];
  }

  isSolid(x, y, z) {
    if (x < 0 || z < 0 || x >= W || z >= D || y < 0) return true; // invisible walls
    if (y >= H) return false;
    return SOLID[this.data[(z * W + x) * H + y]] === 1;
  }

  set(x, y, z, b) {
    if (x < 0 || z < 0 || x >= W || z >= D || y < 0 || y >= H) return;
    const i = (z * W + x) * H + y;
    this.data[i] = b;
    this.edits.set(i, b);
    const ck = Math.floor(z / CS) * (W / CS) + Math.floor(x / CS);
    if (BLOCKS[b]?.light) {
      this.lights.add(i);
      if (!this.lightChunks.has(ck)) this.lightChunks.set(ck, new Set());
      this.lightChunks.get(ck).add(i);
    } else if (this.lights.delete(i)) {
      const set = this.lightChunks.get(ck);
      set.delete(i);
      if (!set.size) this.lightChunks.delete(ck);
    }
    if (b !== AIR && y > this.tops[z * W + x]) this.tops[z * W + x] = y;
  }

  /** re-apply saved player edits on top of a freshly generated world; pairs = [[index, id], ...] */
  applyEdits(pairs) {
    for (const [i, b] of pairs) {
      const { x, y, z } = World.coords(i);
      this.set(x, y, z, b);
    }
  }

  /** decode a voxel index back to coordinates */
  static coords(i) {
    const y = i % H, col = (i - y) / H;
    return { x: col % W, y, z: Math.floor(col / W) };
  }

  // Voxel DDA raycast. Returns first non-air, non-water block hit.
  raycast(ox, oy, oz, dx, dy, dz, maxD) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = dx ? Math.abs(1 / dx) : Infinity;
    const tdy = dy ? Math.abs(1 / dy) : Infinity;
    const tdz = dz ? Math.abs(1 / dz) : Infinity;
    let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxD) {
      const b = this.get(x, y, z);
      if (b !== AIR && b !== WATER) return { x, y, z, nx, ny, nz, id: b };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  async generate(seed, onProgress) {
    this.data.fill(0);
    this.edits.clear();
    this.lights.clear();
    this.lightChunks.clear();
    this.chests.clear();
    const heights = new Int16Array(W * D);
    const gen = new RegionGen();
    for (let r = 0; r < REGIONS.length; r++) {
      const reg = REGIONS[r];
      const report = (f, msg) => onProgress?.(((r + Math.min(1, f)) / REGIONS.length) * 0.9, `${reg.name}: ${msg}`);
      gen.data.fill(0);
      if (reg.kind === 'hills') await gen.hills(seed, report);
      else await gen.custom(seed + 1000 * r, reg, report);
      // copy the map into its place in the world
      for (let z = 0; z < R; z++) for (let x = 0; x < R; x++) {
        const src = (z * R + x) * H;
        this.data.set(gen.data.subarray(src, src + H), ((reg.oz + z) * W + reg.ox + x) * H);
        heights[(reg.oz + z) * W + reg.ox + x] = gen.heights[z * R + x];
      }
    }

    onProgress?.(0.92, 'Building bridges…');
    await yieldFrame();
    const c = R / 2;
    this.bridge(heights, c, c, R + c, c);         // Green Hills - Flatlands
    this.bridge(heights, c, c, c, R + c);         // Green Hills - Archipelago
    this.bridge(heights, c, R + c, R + c, R + c); // Archipelago - Desert
    this.bridge(heights, R + c, c, R + c, R + c); // Flatlands - Desert

    // --- column tops for the mesher ---
    for (let i = 0; i < W * D; i++) {
      let y = H - 1;
      const col = i * H;
      while (y > 0 && this.data[col + y] === AIR) y--;
      this.tops[i] = y;
    }
    this.heights = heights;
    onProgress?.(0.95, 'Almost there…');
  }

  /** a 3-wide plank bridge on cobblestone posts over every stretch of water on the straight line a -> b,
   *  with steps cut into the shore wherever the land is more than a jump above the deck */
  bridge(heights, ax, az, bx, bz) {
    const deck = WATER_LEVEL + 2;
    const len = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const px = Math.round(-dz), pz = Math.round(dx); // sideways (bridges run along x or z)
    const pts = [];
    for (let i = 0; i <= len; i++) pts.push([Math.round(ax + dx * i), Math.round(az + dz * i)]);
    const wet = pts.map(([x, z]) => heights[z * W + x] <= WATER_LEVEL);

    let run = 0;
    pts.forEach(([cx, cz], i) => {
      if (!wet[i]) { run = 0; return; }
      run++;
      for (let s = -1; s <= 1; s++) {
        const col = ((cz + pz * s) * W + cx + px * s) * H;
        this.data[col + deck] = PLANKS;
        for (let y = deck + 1; y <= deck + 3; y++) this.data[col + y] = AIR;
        if (s !== 0 && run % 8 === 4) {
          for (let y = deck - 1; y > 0 && (this.data[col + y] === WATER || this.data[col + y] === AIR); y--) this.data[col + y] = COBBLE;
          this.data[col + deck + 1] = LOG; // a railing post
        }
      }
    });

    // cut a staircase into a shore that is too high to step onto
    const steps = (from, dir) => {
      let level = deck;
      for (let j = from; j >= 0 && j < pts.length && !wet[j]; j += dir) {
        const [cx, cz] = pts[j];
        const hh = heights[cz * W + cx];
        if (hh <= level + 1) return;
        level++;
        for (let s = -1; s <= 1; s++) {
          const col = ((cz + pz * s) * W + cx + px * s) * H;
          this.data[col + level] = COBBLE;
          for (let y = level + 1; y <= Math.max(hh, level + 3) && y < H; y++) this.data[col + y] = AIR;
        }
      }
    };
    for (let i = 1; i < pts.length; i++) {
      if (wet[i - 1] && !wet[i]) steps(i, 1);
      if (!wet[i - 1] && wet[i]) steps(i - 1, -1);
    }
  }

  /** a grassy spot near the middle of the Green Hills (the same place older versions used) */
  findSpawn() {
    const cx = R / 2, cz = R / 2;
    for (let r = 0; r < R / 2; r += 2) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = Math.floor(cx + Math.cos(a) * r), z = Math.floor(cz + Math.sin(a) * r);
        const y = this.tops[z * W + x];
        if (this.get(x, y, z) === GRASS) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
      }
    }
    return { x: cx + 0.5, y: H - 4, z: cz + 0.5 };
  }
}


// Generates one R x R map into its own buffer; World.generate copies it into place.
class RegionGen {
  constructor() {
    this.data = new Uint8Array(R * R * H);
    this.heights = new Int16Array(R * R);
  }

  /** the original island: kept exactly as it was, so older saves line up with their world */
  async hills(seed, onProgress) {
    const d = this.data;
    const n1 = makeNoise2D(seed), n2 = makeNoise2D(seed + 11), n3 = makeNoise2D(seed + 23);
    const n4 = makeNoise2D(seed + 37), n5 = makeNoise2D(seed + 41);
    const c1 = makeNoise3D(seed + 51), c2 = makeNoise3D(seed + 67);
    const rnd = mulberry32(seed ^ 0x9e3779b9);
    const heights = new Int16Array(R * R);

    for (let z = 0; z < R; z++) {
      for (let x = 0; x < R; x++) {
        // --- height ---
        const e = Math.min(x, z, R - 1 - x, R - 1 - z);
        const t = Math.min(1, e / 64);
        const edge = t * t * (3 - 2 * t); // smoothstep falloff -> island
        const base = fbm2(n1, x / 110, z / 110, 4);
        const hills = fbm2(n2, x / 36, z / 36, 3);
        const m = fbm2(n3, x / 170, z / 170, 3);
        let h = WATER_LEVEL + 3 + base * 16 + hills * 5 + Math.pow(Math.max(0, m + 0.05), 1.5) * 85;
        const seabed = WATER_LEVEL - 14;
        h = seabed + (h - seabed) * edge;
        h = Math.max(4, Math.min(H - 16, Math.floor(h)));
        heights[z * R + x] = h;

        // --- layers ---
        const col = (z * R + x) * H;
        const beach = h <= WATER_LEVEL + 1;
        const deep = h < WATER_LEVEL - 5;
        const snowLine = 66 + Math.floor(n4(x / 12, z / 12) * 5);
        const rocky = !beach && h >= 58;
        const sub = beach ? (deep ? GRAVEL : SAND) : rocky ? STONE : DIRT;
        const top = beach ? (deep ? GRAVEL : SAND) : h >= snowLine ? SNOW : rocky ? STONE : GRASS;
        const dirtDepth = 3 + Math.floor((n4(x / 7 + 50, z / 7) + 1) * 1.5);
        const maxY = Math.max(h, WATER_LEVEL);
        for (let y = 0; y <= maxY; y++) {
          let b;
          if (y === 0 || (y < 3 && rnd() < 0.5)) b = BEDROCK;
          else if (y < h - dirtDepth) b = STONE;
          else if (y < h) b = sub;
          else if (y === h) b = top;
          else b = WATER;
          d[col + y] = b;
        }

        // --- spaghetti caves: where two 3D noise fields are both near zero ---
        const caveTop = beach ? h - 7 : h;
        for (let y = 4; y <= caveTop; y++) {
          const a = c1(x / 34, y / 20, z / 34);
          const b = c2(x / 34, y / 20, z / 34);
          if (a * a + b * b < 0.0055) d[col + y] = AIR;
        }
      }
      if ((z & 15) === 15) {
        onProgress?.((z / R) * 0.85, 'Shaping the land…');
        await yieldFrame();
      }
    }

    // --- ores ---
    onProgress?.(0.86, 'Burying ores…');
    await yieldFrame();
    for (let i = 0; i < 14000; i++) {
      let x = Math.floor(rnd() * R), z = Math.floor(rnd() * R), y = 3 + Math.floor(rnd() * 55);
      const ore = y < 28 && rnd() < 0.35 ? IRON_ORE : COAL_ORE;
      const n = 3 + Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) {
        if (x >= 0 && z >= 0 && x < R && z < R && y > 0 && y < H && d[(z * R + x) * H + y] === STONE)
          d[(z * R + x) * H + y] = ore;
        const dir = Math.floor(rnd() * 3);
        const s = rnd() < 0.5 ? -1 : 1;
        if (dir === 0) x += s; else if (dir === 1) y += s; else z += s;
      }
    }

    // --- rare deep ores: their own random stream, so older worlds keep the same trees and buildings ---
    const rare = mulberry32(seed ^ 0x51ed270b);
    for (let i = 0; i < 2600; i++) {
      let x = Math.floor(rare() * R), z = Math.floor(rare() * R);
      const diamond = rare() < 0.35;
      let y = 3 + Math.floor(rare() * (diamond ? 14 : 24));
      const ore = diamond ? DIAMOND_ORE : GOLD_ORE;
      const n = 2 + Math.floor(rare() * (diamond ? 3 : 5));
      for (let k = 0; k < n; k++) {
        if (x >= 0 && z >= 0 && x < R && z < R && y > 0 && y < H && d[(z * R + x) * H + y] === STONE)
          d[(z * R + x) * H + y] = ore;
        const dir = Math.floor(rare() * 3);
        const s = rare() < 0.5 ? -1 : 1;
        if (dir === 0) x += s; else if (dir === 1) y += s; else z += s;
      }
    }

    // --- trees (denser in forest patches) ---
    onProgress?.(0.9, 'Planting trees…');
    await yieldFrame();
    for (let z = 3; z < R - 3; z++) {
      for (let x = 3; x < R - 3; x++) {
        const h = heights[z * R + x];
        if (d[(z * R + x) * H + h] !== GRASS || d[(z * R + x) * H + h + 1] !== AIR) continue;
        const forest = Math.max(0, fbm2(n5, x / 70, z / 70, 2));
        if (rnd() < 0.002 + forest * 0.06) this.placeTree(x, h, z, rnd);
      }
    }

    // --- structures: cottages + ruined towers ---
    onProgress?.(0.93, 'Building villages…');
    await yieldFrame();
    this.placeStructures(heights, rnd);

    this.heights = heights;
  }

  placeTree(x, y, z, rnd) {
    const d = this.data;
    const th = 4 + Math.floor(rnd() * 3);
    if (y + th + 2 >= H) return;
    // don't grow into another tree's trunk
    for (let i = 1; i <= th + 1; i++) if (d[(z * R + x) * H + y + i] !== AIR && d[(z * R + x) * H + y + i] !== LEAVES) return;
    for (let i = 1; i <= th; i++) d[(z * R + x) * H + y + i] = LOG;
    const top = y + th;
    for (let dy = -2; dy <= 1; dy++) {
      const rad = dy <= -1 ? 2 : 1;
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) === rad && Math.abs(dz) === rad && (dy === 1 || rnd() < 0.5)) continue;
        const i = ((z + dz) * R + (x + dx)) * H + top + dy;
        if (d[i] === AIR) d[i] = LEAVES;
      }
    }
  }

  setRaw(x, y, z, b) {
    if (x < 0 || z < 0 || x >= R || z >= R || y < 1 || y >= H) return;
    this.data[(z * R + x) * H + y] = b;
  }

  placeStructures(heights, rnd, ground = GRASS, counts = [26, 10]) {
    const placed = [];
    const tryPlace = (size, minGap) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const x0 = 24 + Math.floor(rnd() * (R - 48 - size));
        const z0 = 24 + Math.floor(rnd() * (R - 48 - size));
        const cx = x0 + (size >> 1), cz = z0 + (size >> 1);
        if (placed.some(([px, pz]) => Math.hypot(px - cx, pz - cz) < minGap)) continue;
        let lo = 999, hi = -1;
        for (let z = z0; z < z0 + size; z++) for (let x = x0; x < x0 + size; x++) {
          const h = heights[z * R + x];
          lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
        const base = heights[cz * R + cx];
        if (hi - lo > 2 || lo <= WATER_LEVEL + 1 || base > H - 20) continue;
        if (this.data[(cz * R + cx) * H + base] !== ground) continue;
        placed.push([cx, cz]);
        return { x0, z0, base };
      }
      return null;
    };

    // clear the space above and put a stone foundation under the footprint
    const prepare = (x0, z0, sx, sz, base, clearH) => {
      for (let z = z0 - 1; z <= z0 + sz; z++) for (let x = x0 - 1; x <= x0 + sx; x++) {
        const inside = x >= x0 && x < x0 + sx && z >= z0 && z < z0 + sz;
        for (let y = base + 1; y <= base + clearH; y++) this.setRaw(x, y, z, AIR);
        if (inside) for (let y = base; y > base - 6; y--) {
          const cur = this.data[(z * R + x) * H + y];
          if (y < base && cur !== AIR && cur !== WATER) break;
          this.setRaw(x, y, z, COBBLE);
        } else if (this.data[(z * R + x) * H + base] === AIR) this.setRaw(x, base, z, ground);
      }
    };

    // ---- cottages ----
    for (let i = 0; i < counts[0]; i++) {
      const s = tryPlace(7, 18);
      if (!s) break;
      const { x0, z0, base } = s;
      const S = 7;
      prepare(x0, z0, S, S, base, 10);
      for (let z = z0; z < z0 + S; z++) for (let x = x0; x < x0 + S; x++) this.setRaw(x, base, z, PLANKS);
      const doorSide = Math.floor(rnd() * 4);
      for (let y = base + 1; y <= base + 3; y++) {
        for (let k = 0; k < S; k++) {
          const ring = [[x0 + k, z0, 0], [x0 + k, z0 + S - 1, 1], [x0, z0 + k, 2], [x0 + S - 1, z0 + k, 3]];
          for (const [x, z, side] of ring) {
            const corner = (k === 0 || k === S - 1);
            let b = corner ? LOG : PLANKS;
            const mid = k === 3;
            if (!corner && y === base + 2 && (k === 1 || k === 5) && side !== doorSide) b = GLASS;
            if (mid && side === doorSide && y <= base + 2) b = AIR;
            this.setRaw(x, y, z, b);
          }
        }
      }
      // stepped brick roof with overhang
      for (let k = 0; k <= 4; k++) {
        const y = base + 4 + k;
        const a = -1 + k, b2 = S - k;
        if (a > b2) break;
        for (let z = z0 + a; z <= z0 + b2; z++) for (let x = x0 + a; x <= x0 + b2; x++) {
          const edge = x === x0 + a || x === x0 + b2 || z === z0 + a || z === z0 + b2;
          if (edge || a === b2 || b2 - a <= 1) this.setRaw(x, y, z, BRICK);
        }
      }
      // a little path of gravel out of the door
      const [ddx, ddz, dx0, dz0] = [[0, -1, x0 + 3, z0 - 1], [0, 1, x0 + 3, z0 + S], [-1, 0, x0 - 1, z0 + 3], [1, 0, x0 + S, z0 + 3]][doorSide];
      for (let k = 0; k < 4; k++) {
        const px = dx0 + ddx * k, pz = dz0 + ddz * k;
        if (px < 0 || pz < 0 || px >= R || pz >= R) break;
        const h = heights[pz * R + px];
        if (this.data[(pz * R + px) * H + h] === ground) this.setRaw(px, h, pz, GRAVEL);
      }
    }

    // ---- ruined towers ----
    for (let i = 0; i < counts[1]; i++) {
      const s = tryPlace(5, 40);
      if (!s) break;
      const { x0, z0, base } = s;
      const S = 5, TH = 10 + Math.floor(rnd() * 5);
      prepare(x0, z0, S, S, base, TH + 3);
      for (let y = base; y <= base + TH; y++) {
        const decay = Math.max(0, (y - base) / TH - 0.35) * 0.9; // crumbles toward the top
        const floor = (y - base) % 5 === 0;
        for (let z = z0; z < z0 + S; z++) for (let x = x0; x < x0 + S; x++) {
          const edge = x === x0 || x === x0 + S - 1 || z === z0 || z === z0 + S - 1;
          const corner = (x === x0 || x === x0 + S - 1) && (z === z0 || z === z0 + S - 1);
          if (edge) {
            if (rnd() < decay && !corner) continue;
            const isDoor = z === z0 && x === x0 + 2 && y > base && y <= base + 2;
            const isWindow = !corner && (y - base) % 5 === 3 && (x === x0 + 2 || z === z0 + 2);
            if (isDoor || isWindow) continue;
            this.setRaw(x, y, z, rnd() < 0.15 ? STONE : COBBLE);
          } else if (floor) this.setRaw(x, y, z, y === base ? COBBLE : PLANKS);
        }
      }
      // ladder-ish holes in floors so you can climb with jumps: open one corner
      for (let y = base + 5; y <= base + TH; y += 5) this.setRaw(x0 + 1, y, z0 + 3, AIR);
      // stairs of cobble up the inside wall (1 per level)
      for (let y = base + 1; y <= base + TH; y++) {
        const k = (y - base - 1) % 4;
        const [sx, sz] = [[x0 + 1, z0 + 1], [x0 + 3, z0 + 1], [x0 + 3, z0 + 3], [x0 + 1, z0 + 3]][k];
        this.setRaw(sx, y, sz, COBBLE);
      }
      // battlements
      const top = base + TH + 1;
      for (let k = 0; k < S; k += 2) {
        for (const [x, z] of [[x0 + k, z0], [x0 + k, z0 + S - 1], [x0, z0 + k], [x0 + S - 1, z0 + k]])
          if (rnd() > 0.3) this.setRaw(x, top, z, COBBLE);
      }
    }
    this.structures = placed.length;
  }

  /** Flatlands, Archipelago and Desert. Only edges on the outside of the world slope down into the sea. */
  async custom(seed, reg, onProgress) {
    const d = this.data;
    const kind = reg.kind;
    const n1 = makeNoise2D(seed), n2 = makeNoise2D(seed + 11), n4 = makeNoise2D(seed + 37), n5 = makeNoise2D(seed + 41);
    const c1 = makeNoise3D(seed + 51), c2 = makeNoise3D(seed + 67);
    const rnd = mulberry32(seed ^ 0x9e3779b9);
    const heights = new Int16Array(R * R);
    const west = reg.ox === 0, east = reg.ox + R === W, north = reg.oz === 0, south = reg.oz + R === D;
    const base = WATER_LEVEL + 4;

    for (let z = 0; z < R; z++) {
      for (let x = 0; x < R; x++) {
        const e = Math.min(west ? x : 1e9, east ? R - 1 - x : 1e9, north ? z : 1e9, south ? R - 1 - z : 1e9);
        const t = Math.min(1, e / 64);
        const edge = t * t * (3 - 2 * t);
        let h;
        if (kind === 'flat') h = base;
        else if (kind === 'desert') {
          // rolling dunes, flattening out toward the Flatlands in the north
          const blend = Math.min(1, z / 40);
          h = base + (fbm2(n1, x / 45, z / 45, 3) * 6 + Math.abs(fbm2(n2, x / 18, z / 18, 2)) * 3) * blend;
        } else {
          // islands: scattered bumps of noise, plus one big island in the middle for the bridges to land on
          const centre = Math.max(0, 1 - Math.hypot(x - R / 2, z - R / 2) / 110);
          const v = fbm2(n1, x / 60, z / 60, 4) + fbm2(n2, x / 22, z / 22, 2) * 0.25 + centre * 0.9;
          h = WATER_LEVEL - 9 + Math.max(0, v + 0.15) * 34;
        }
        const seabed = WATER_LEVEL - 14;
        h = seabed + (h - seabed) * edge;
        h = Math.max(4, Math.min(H - 16, Math.floor(h)));
        heights[z * R + x] = h;

        const col = (z * R + x) * H;
        const beach = h <= WATER_LEVEL + 1;
        const deep = h < WATER_LEVEL - 5;
        const sandy = kind === 'desert' || beach;
        const top = deep ? GRAVEL : sandy ? SAND : GRASS;
        const sub = deep ? GRAVEL : sandy ? SAND : DIRT;
        const subDepth = kind === 'desert' ? 5 : 3 + Math.floor((n4(x / 7 + 50, z / 7) + 1) * 1.5);
        const maxY = Math.max(h, WATER_LEVEL);
        for (let y = 0; y <= maxY; y++) {
          let b;
          if (y === 0 || (y < 3 && rnd() < 0.5)) b = BEDROCK;
          else if (y < h - subDepth) b = STONE;
          else if (y < h) b = sub;
          else if (y === h) b = top;
          else b = WATER;
          d[col + y] = b;
        }
        // caves stay underground on the flatlands, so the surface stays flat
        const caveTop = kind === 'flat' ? h - 6 : beach ? h - 7 : h;
        for (let y = 4; y <= caveTop; y++) {
          const a = c1(x / 34, y / 20, z / 34);
          const b = c2(x / 34, y / 20, z / 34);
          if (a * a + b * b < 0.0055) d[col + y] = AIR;
        }
      }
      if ((z & 15) === 15) {
        onProgress?.((z / R) * 0.85, 'Shaping the land…');
        await yieldFrame();
      }
    }

    onProgress?.(0.86, 'Burying ores…');
    await yieldFrame();
    this.ores(rnd, 14000, () => (rnd() < 0.35 ? IRON_ORE : COAL_ORE), 55);
    const rare = mulberry32(seed ^ 0x51ed270b);
    this.ores(rare, 2600, () => (rare() < 0.35 ? DIAMOND_ORE : GOLD_ORE), 20);

    onProgress?.(0.9, 'Planting trees…');
    await yieldFrame();
    if (kind !== 'desert') {
      for (let z = 3; z < R - 3; z++) for (let x = 3; x < R - 3; x++) {
        const h = heights[z * R + x];
        if (d[(z * R + x) * H + h] !== GRASS || d[(z * R + x) * H + h + 1] !== AIR) continue;
        const forest = Math.max(0, fbm2(n5, x / 70, z / 70, 2));
        const p = kind === 'flat' ? 0.001 + forest * 0.02 : 0.004 + forest * 0.05;
        if (rnd() < p) this.placeTree(x, h, z, rnd);
      }
    }

    onProgress?.(0.95, 'Building villages…');
    await yieldFrame();
    if (kind === 'flat') this.placeStructures(heights, rnd, GRASS, [40, 4]);
    else if (kind === 'desert') this.placeStructures(heights, rnd, SAND, [6, 14]);
    else this.placeStructures(heights, rnd, GRASS, [12, 3]);
    this.heights = heights;
  }

  /** count veins of ore in stone below maxY; pick() chooses the ore for each vein */
  ores(rnd, count, pick, maxY) {
    const d = this.data;
    for (let i = 0; i < count; i++) {
      let x = Math.floor(rnd() * R), z = Math.floor(rnd() * R), y = 3 + Math.floor(rnd() * maxY);
      const ore = pick();
      const n = 2 + Math.floor(rnd() * 6);
      for (let k = 0; k < n; k++) {
        if (x >= 0 && z >= 0 && x < R && z < R && y > 0 && y < H && d[(z * R + x) * H + y] === STONE) d[(z * R + x) * H + y] = ore;
        const dir = Math.floor(rnd() * 3);
        const s = rnd() < 0.5 ? -1 : 1;
        if (dir === 0) x += s; else if (dir === 1) y += s; else z += s;
      }
    }
  }
}
