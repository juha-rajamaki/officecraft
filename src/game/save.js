// Saving: the world is regenerated from its seed, so a save only holds the seed plus every
// block the player changed, the inventory and the player state. Stored in IndexedDB, which is
// browser-local and works on a static host such as GitHub Pages (no server needed).
import { W, D, H, R } from './world.js';
import { isBlock, isItem, isArmor, maxStack, AIR, LAMP, TORCH, PLANKS, COBBLE, GLASS, BRICK } from './blocks.js';
import { SIZE, HOTBAR, CHEST_SIZE } from './inventory.js';

const DB = 'officecraft-save'; // unique: all Pages projects on one github.io domain share storage
const STORE = 'saves';
const KEY = 'world';
const VERSION = 2;       // v2: the world grew from one 512x512 map to four (1024x1024)
const VOXELS = W * D * H;
const V1_VOXELS = R * R * H;
/** a v1 voxel index (one 512-wide map) -> the same block in today's world; the old map is the Green Hills at 0,0 */
const fromV1 = (i) => { const y = i % H, col = (i - y) / H; return ((Math.floor(col / R) * W) + (col % R)) * H + y; };
const MAX_EDITS = 500_000; // far beyond normal play; keeps a hostile import from exhausting memory
const MAX_LAMPS = 5000;     // lamp/torch light is baked per chunk; bound the work a save can cause
const MAX_CHESTS = 4000;
const INF_BLOCKS = new Set([PLANKS, COBBLE, GLASS, BRICK]); // the only infinite stacks a new world has

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
// stay off the world edges: outside x/z 0..W and below y=0 counts as solid wall, which would trap the player
const vec = (p) => p && typeof p === 'object' && num(p.x, 1, W - 1) && num(p.y, 1, H + 60) && num(p.z, 1, D - 1);

/** a validated copy of a slot array of exactly n entries, or null; allowInf = starter infinite stacks */
function slotList(arr, n, allowInf) {
  if (!Array.isArray(arr) || arr.length !== n) return null;
  const out = [];
  for (const s of arr) {
    if (s === null) { out.push(null); continue; }
    if (!s || typeof s !== 'object' || !isItem(s.id) || !int(s.count, 1, maxStack(s.id))) return null;
    const slot = { id: s.id, count: s.count };
    if (allowInf && s.inf === true && INF_BLOCKS.has(s.id)) slot.inf = true;
    out.push(slot);
  }
  return out;
}

/** Check a save object field by field. Returns a clean copy, or null if anything is off. */
export function validateSave(raw) {
  if (!raw || typeof raw !== 'object' || (raw.v !== VERSION && raw.v !== 1)) return null;
  const v1 = raw.v === 1;
  const maxIndex = (v1 ? V1_VOXELS : VOXELS) - 1;
  const index = (i) => (v1 ? fromV1(i) : i);
  if (!int(raw.seed, -(2 ** 31), 2 ** 32)) return null;
  if (!vec(raw.pos) || !vec(raw.spawn)) return null;
  if (!num(raw.yaw, -1e6, 1e6) || !num(raw.pitch, -Math.PI, Math.PI)) return null;
  if (!num(raw.time, 0, 1) || !int(raw.health, 1, 20) || !int(raw.selected, 0, HOTBAR - 1)) return null;

  if (!Array.isArray(raw.edits) || raw.edits.length > MAX_EDITS) return null;
  const edits = [];
  let lamps = 0;
  for (const e of raw.edits) {
    if (!Array.isArray(e) || e.length !== 2) return null;
    const [i, id] = e;
    if (!int(i, 0, maxIndex)) return null;
    if (!(id === AIR || isBlock(id))) return null;
    if ((id === LAMP || id === TORCH) && ++lamps > MAX_LAMPS) return null;
    edits.push([index(i), id]);
  }

  const slots = slotList(raw.slots, SIZE, true);
  if (!slots) return null;

  // added later: older saves have no hunger, armor or chests
  const hunger = raw.hunger === undefined ? 20 : raw.hunger;
  if (!int(hunger, 0, 20)) return null;
  let armor = null;
  if (raw.armor != null) {
    if (typeof raw.armor !== 'object' || !isArmor(raw.armor.id) || raw.armor.count !== 1) return null;
    armor = { id: raw.armor.id, count: 1 };
  }
  const chests = [];
  if (raw.chests !== undefined) {
    if (!Array.isArray(raw.chests) || raw.chests.length > MAX_CHESTS) return null;
    const seen = new Set();
    for (const c of raw.chests) {
      if (!Array.isArray(c) || c.length !== 2 || !int(c[0], 0, maxIndex) || seen.has(c[0])) return null;
      const cs = slotList(c[1], CHEST_SIZE, false);
      if (!cs) return null;
      seen.add(c[0]);
      chests.push([index(c[0]), cs]);
    }
  }

  const p = (v) => ({ x: v.x, y: v.y, z: v.z });
  return {
    v: VERSION, seed: raw.seed, edits, slots, selected: raw.selected,
    pos: p(raw.pos), spawn: p(raw.spawn), yaw: raw.yaw, pitch: raw.pitch,
    time: raw.time, health: raw.health, hunger, armor, chests, savedAt: num(raw.savedAt, 0, 1e15) ? raw.savedAt : 0,
  };
}

/** the stored save (already validated), or null */
export async function readSave() {
  try {
    return validateSave(await run('readonly', (s) => s.get(KEY)));
  } catch {
    return null;
  }
}

/** returns true if it was written */
export async function writeSave(save) {
  try {
    await run('readwrite', (s) => s.put(save, KEY));
    return true;
  } catch {
    return false;
  }
}

/** download a save as a .json file */
export function downloadSave(save) {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'officecraft-save.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

/** read a user-chosen file; resolves to a validated save or rejects with a readable message */
export function readSaveFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('No file chosen')); return; }
    if (file.size > MAX_IMPORT_BYTES) { reject(new Error('File is too large to be a save')); return; }
    const r = new FileReader();
    r.onload = () => {
      let parsed;
      try { parsed = JSON.parse(r.result); } catch { reject(new Error('Not a valid save file')); return; }
      const save = validateSave(parsed);
      if (save) resolve(save);
      else reject(new Error('Not a valid OfficeCraft save'));
    };
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsText(file);
  });
}
