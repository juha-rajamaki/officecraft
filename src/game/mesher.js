// Builds chunk geometry: only faces touching non-opaque neighbours, with baked
// face shading + per-vertex ambient occlusion. Three buckets: opaque, cutout, water.
import { AIR, WATER, GLASS, LEAVES, BLOCKS, OPAQUE, CUTOUT, NT } from './blocks.js';
import { W, H, CS } from './world.js';

export const LIGHT_RADIUS = 8; // blocks a lamp reaches (Game.js rebuilds this far on change)

const FACES = [
  { dir: [-1, 0, 0], corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];
for (const f of FACES) {
  f.axis = f.dir.findIndex((v) => v !== 0);
  f.u = (f.axis + 1) % 3;
  f.v = (f.axis + 2) % 3;
}
const AOV = [0.45, 0.64, 0.82, 1];

// d = per-vertex shader data: [ambient occlusion, face index, kind]; l = lamp light 0..1
const newBuf = () => ({ p: [], uv: [], d: [], l: [], i: [] });

const MAX_CHUNK_LIGHTS = 48; // nearest lamps considered per chunk, so meshing cost stays bounded

// lamps close enough to light this chunk (only this and the 8 neighbouring chunks can reach it),
// as a flat [x, y, z, ...] list of block centres
function nearbyLights(world, cx, cz) {
  const x0 = cx * CS, z0 = cz * CS, r = LIGHT_RADIUS + 1, CXN = W / CS;
  let found = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const set = world.lightChunks.get((cz + dz) * CXN + (cx + dx));
    if (!set || cx + dx < 0 || cx + dx >= CXN) continue;
    for (const i of set) {
      const y = i % H, col = (i - y) / H, x = col % W, z = (col - x) / W;
      if (x >= x0 - r && x < x0 + CS + r && z >= z0 - r && z < z0 + CS + r) found.push([x + 0.5, y + 0.5, z + 0.5]);
    }
  }
  if (found.length > MAX_CHUNK_LIGHTS) {
    const mx = x0 + CS / 2, mz = z0 + CS / 2;
    found = found
      .map((p) => [p, (p[0] - mx) ** 2 + (p[2] - mz) ** 2])
      .sort((a, b) => a[1] - b[1])
      .slice(0, MAX_CHUNK_LIGHTS)
      .map((e) => e[0]);
  }
  return found.flat();
}

// no occlusion: a smooth falloff from every nearby lamp, summed and capped
function lampLight(lights, px, py, pz) {
  let sum = 0;
  for (let k = 0; k < lights.length; k += 3) {
    const d = Math.hypot(px - lights[k], py - lights[k + 1], pz - lights[k + 2]);
    if (d < LIGHT_RADIUS) { const f = 1 - d / LIGHT_RADIUS; sum += f * f; }
  }
  return Math.min(1, sum);
}

function visible(b, n) {
  if (b === WATER) return !OPAQUE[n] && n !== WATER;
  if (b === GLASS) return !OPAQUE[n] && n !== GLASS;
  return !OPAQUE[n];
}

// two crossed vertical quads (torches), each in both windings so they show from every side
const CROSS = [[0.15, 0.15, 0.85, 0.85], [0.15, 0.85, 0.85, 0.15]];
function crossQuads(buf, tile, x, y, z, kind, lights) {
  const l = lights.length ? lampLight(lights, x + 0.5, y + 0.5, z + 0.5) : 0;
  const u0 = (tile + 0.001) / NT, u1 = (tile + 0.999) / NT;
  for (const [ax, az, bx, bz] of CROSS) {
    for (const flip of [false, true]) {
      const ndx = buf.p.length / 3;
      buf.p.push(x + ax, y, z + az, x + bx, y, z + bz, x + ax, y + 1, z + az, x + bx, y + 1, z + bz);
      buf.uv.push(u0, 0, u1, 0, u0, 1, u1, 1);
      for (let k = 0; k < 4; k++) { buf.d.push(1, 4, kind); buf.l.push(l); }
      if (flip) buf.i.push(ndx, ndx + 2, ndx + 1, ndx + 1, ndx + 2, ndx + 3);
      else buf.i.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
    }
  }
}

export function buildChunk(world, cx, cz) {
  const out = { o: newBuf(), c: newBuf(), w: newBuf() };
  const x0 = cx * CS, z0 = cz * CS;
  const q = [0, 0, 0];
  const occ = (a, b, c) => OPAQUE[world.get(a, b, c)];
  const lights = nearbyLights(world, cx, cz);

  for (let z = z0; z < z0 + CS; z++) {
    for (let x = x0; x < x0 + CS; x++) {
      const top = Math.min(H - 1, world.tops[z * W + x]);
      const col = (z * W + x) * H;
      for (let y = 0; y <= top; y++) {
        const b = world.data[col + y];
        if (b === AIR) continue;
        const def = BLOCKS[b];
        const buf = b === WATER ? out.w : CUTOUT[b] ? out.c : out.o;
        const waterTop = b === WATER && world.get(x, y + 1, z) !== WATER;
        const kind = b === WATER ? 2 : b === LEAVES ? 1 : def.light ? 3 : 0;
        if (def.cross) { crossQuads(buf, def.tex[1], x, y, z, kind, lights); continue; }
        const h = def.height ?? 1;

        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          const [dx, dy, dz] = f.dir;
          const n = world.get(x + dx, y + dy, z + dz);
          if (def.noCaps && dy) continue;
          if (!visible(b, n) && !(h < 1 && dy === 1)) continue; // a low block's top is always open
          const tile = def.tex[dy === 1 ? 0 : dy === -1 ? 2 : 1];
          const ndx = buf.p.length / 3;
          const ao = [3, 3, 3, 3];
          for (let k = 0; k < 4; k++) {
            const c = f.corners[k];
            let py = y + c[1] * h;
            if (waterTop && c[1] === 1) py -= 0.12;
            buf.p.push(x + c[0], py, z + c[2]);
            buf.uv.push((tile + 0.001 + c[3] * 0.998) / NT, dy ? c[4] : c[4] * h);
            if (b !== WATER) {
              // neighbours in the layer in front of the face
              q[0] = x + dx; q[1] = y + dy; q[2] = z + dz;
              const su = c[f.u] ? 1 : -1, sv = c[f.v] ? 1 : -1;
              q[f.u] += su; const s1 = occ(q[0], q[1], q[2]);
              q[f.v] += sv; const cr = occ(q[0], q[1], q[2]);
              q[f.u] -= su; const s2 = occ(q[0], q[1], q[2]);
              ao[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            }
            buf.d.push(AOV[ao[k]], fi, kind);
            // sample light half a block out from the face, so faces aren't lit from behind walls as much
            buf.l.push(lights.length ? lampLight(lights, x + c[0] + dx * 0.5, py + dy * 0.5, z + c[2] + dz * 0.5) : 0);
          }
          if (ao[0] + ao[3] > ao[1] + ao[2]) buf.i.push(ndx, ndx + 1, ndx + 3, ndx, ndx + 3, ndx + 2);
          else buf.i.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
        }
      }
    }
  }
  return out;
}
