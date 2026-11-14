// Saving: the world is regenerated from its seed, so a save only holds the seed plus every
// block the player changed, the inventory and the player state. Stored in IndexedDB, which is
// browser-local and works on a static host such as GitHub Pages (no server needed).
import { W, D, H } from './world.js';
import { isBlock, isItem, maxStack, AIR, LAMP, PLANKS, COBBLE, GLASS, BRICK } from './blocks.js';
import { SIZE, HOTBAR } from './inventory.js';

const DB = 'officecraft-save'; // unique: all Pages projects on one github.io domain share storage
const STORE = 'saves';
const KEY = 'world';
const VERSION = 1;
const VOXELS = W * D * H;
const MAX_EDITS = 500_000; // far beyond normal play; keeps a hostile import from exhausting memory
const MAX_LAMPS = 5000;     // lamp light is baked per chunk; bound the work a save can cause
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

/** Check a save object field by field. Returns a clean copy, or null if anything is off. */
export function validateSave(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
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
    if (!int(i, 0, VOXELS - 1)) return null;
    if (!(id === AIR || isBlock(id))) return null;
    if (id === LAMP && ++lamps > MAX_LAMPS) return null;
    edits.push([i, id]);
  }

  if (!Array.isArray(raw.slots) || raw.slots.length !== SIZE) return null;
  const slots = [];
  for (const s of raw.slots) {
    if (s === null) { slots.push(null); continue; }
    if (!s || typeof s !== 'object' || !isItem(s.id) || !int(s.count, 1, maxStack(s.id))) return null;
    const slot = { id: s.id, count: s.count };
    if (s.inf === true && INF_BLOCKS.has(s.id)) slot.inf = true;
    slots.push(slot);
  }

  const p = (v) => ({ x: v.x, y: v.y, z: v.z });
  return {
    v: VERSION, seed: raw.seed, edits, slots, selected: raw.selected,
    pos: p(raw.pos), spawn: p(raw.spawn), yaw: raw.yaw, pitch: raw.pitch,
    time: raw.time, health: raw.health, savedAt: num(raw.savedAt, 0, 1e15) ? raw.savedAt : 0,
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
