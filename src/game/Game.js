// The engine: rendering, chunk streaming, input, mining/placing, day/night.
import * as THREE from 'three';
import { World, W, D, H, CS, WATER_LEVEL, REGIONS, regionAt } from './world.js';
import { buildChunk, LIGHT_RADIUS } from './mesher.js';
import { Player, EYE, PW, PH } from './player.js';
import {
  makeAtlasTexture, makeCrackTextures, makeSunTexture, makeMoonTexture, makeCloudTexture, blockColors,
} from './textures.js';
import {
  AIR, WATER, BLOCKS, ITEMS, SOLID, LEAVES, CHEST, BED, APPLE, DOOR, DOOR_B, DOOR_T, DOOR_B_OPEN, DOOR_T_OPEN,
  isBlock, isSword, isTool, isFood, isArmor,
} from './blocks.js';
import { hashString } from './noise.js';
import { store, toast } from '../store.js';
import * as inv from './inventory.js';
import { Hand } from './hand.js';
import { Mobs } from './mobs.js';
import { Enemies } from './enemies.js';
import { Sound } from './sound.js';
import { writeSave, downloadSave } from './save.js';
import { createTerrainMaterials, createSky, GradeShader } from './shaders.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const RD = 8;              // render distance in chunks
const DAY_LEN = 600;       // seconds per full day
const REACH = 5;
const CX = W / CS, CZ = D / CS;
const MAX_HP = 20;         // 10 hearts
const MAX_FOOD = 20;       // 10 drumsticks
const HUNGER_EVERY = 45;   // seconds of normal play per half-drumstick (sprinting burns 3x faster)
const REGEN_MIN_FOOD = 6;  // natural healing needs at least 3 drumsticks
const TOOL_NAME = { 2: 'an iron', 3: 'a diamond' };
const SWORD_COOLDOWN = 0.35;

// Time-of-day palette (THREE.Color hex = sRGB, converted to linear automatically)
const HOR_DAY = new THREE.Color(0xb9dcff), HOR_SET = new THREE.Color(0xf6a86e), HOR_NIGHT = new THREE.Color(0x0c1430);
const ZEN_DAY = new THREE.Color(0x3f86e6), ZEN_NIGHT = new THREE.Color(0x02040d);
const SUN_DAY = new THREE.Color(0xfff1da).multiplyScalar(0.78), SUN_SET = new THREE.Color(0xff9447).multiplyScalar(0.9);
const MOON = new THREE.Color().setRGB(0.16, 0.2, 0.34);
const AMB_DAY = new THREE.Color(0xa9c1e4).multiplyScalar(0.62), AMB_SET = new THREE.Color(0x8c7ba6).multiplyScalar(0.6);
const AMB_NIGHT = new THREE.Color().setRGB(0.1, 0.13, 0.23);
const GLOW = new THREE.Color(0xffc58a);
const WATER_FOG = new THREE.Color(0x1d3f8a);

const AUTOSAVE_EVERY = 30; // seconds of play between autosaves
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export class Game {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(window.innerWidth, window.innerHeight);
    r.autoClear = false; // we draw world, then the held item on top
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 2500);
    this.camera.rotation.order = 'YXZ';
    // scene.fog only affects the few basic-material objects (clouds, outline); terrain has its own fog
    this.fog = new THREE.Fog(HOR_DAY.clone(), RD * CS * 0.5, RD * CS * 0.95);
    this.scene.fog = this.fog;
    this.skyColor = new THREE.Color();

    const atlas = makeAtlasTexture();
    this.mats = createTerrainMaterials(atlas);
    this.u = this.mats.shared; // shared shader uniforms

    this.world = new World();
    this.player = new Player();
    this.chunks = new Map();
    this.offsets = [];
    for (let dz = -RD; dz <= RD; dz++)
      for (let dx = -RD; dx <= RD; dx++)
        if (dx * dx + dz * dz <= RD * RD) this.offsets.push([dx, dz]);
    this.offsets.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2));

    this.buildHelpers();
    this.buildSky();
    this.hand = new Hand(atlas);
    this.mobs = new Mobs(this.scene, this.world);
    this.mobTarget = null;
    this.enemies = new Enemies(this.scene, this.world);
    this.enemyTarget = null;
    this.sound = new Sound(store.get().volume);
    this.mobs.sfx = this.sound;
    this.enemies.sfx = this.sound;
    this.unsubVolume = store.subscribe(() => {
      const v = store.get().volume;
      if (v !== this.sound.volume) this.sound.setVolume(v);
    });
    this.stepDist = 0;
    this.wasOnGround = true;
    this.wasInWater = false;
    this.swimT = 0;
    this.mineStage = -1;
    this.saveTimer = 0;
    this.health = MAX_HP;
    this.sinceHurt = 0;
    this.regenTimer = 0;
    this.hunger = MAX_FOOD;
    this.hungerT = 0;
    this.starveT = 0;
    this.attackCooldown = 0;
    this.dead = false;
    this.light = 1;
    this.dayAmt = 1;
    this.buildComposer();
    this.clockTime = 0;
    this._dir = new THREE.Vector3();    // scratch vectors, reused every frame
    this._sunDir = new THREE.Vector3();

    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.locked = false;
    this.started = false;
    this.time = 0.04;          // 0 = sunrise, 0.25 = noon, 0.5 = sunset
    this.mining = null;
    this.placeCooldown = 0;
    this.warned = false;
    this.target = null;
    this.debugTimer = 0;
    this.frames = 0;
    this.fps = 0;
    this.underwater = false;

    this.bindEvents();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------- setup ----------------
  buildHelpers() {
    const box = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
    );
    this.outline.visible = false;
    this.scene.add(this.outline);

    this.cracks = makeCrackTextures();
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({
        map: this.cracks[0], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }),
    );
    this.crack.visible = false;
    this.scene.add(this.crack);

    // ocean planes surrounding the island, using the water shader (opaque variant)
    const big = 3000, y = WATER_LEVEL + 0.88;
    const strips = [
      [-big / 2, D / 2, big, D + big * 2],
      [W + big / 2, D / 2, big, D + big * 2],
      [W / 2, -big / 2, W, big],
      [W / 2, D + big / 2, W, big],
    ];
    const waterU = (9.5) / 32; // centre of the water tile in the atlas
    for (const [cx, cz, sw, sd] of strips) {
      const g = new THREE.PlaneGeometry(sw, sd, Math.ceil(sw / 64), Math.ceil(sd / 64));
      g.rotateX(-Math.PI / 2);
      g.translate(cx, y, cz);
      const n = g.attributes.position.count;
      const uv = g.attributes.uv;
      const data = [];
      for (let i = 0; i < n; i++) { uv.setXY(i, waterU, 0.5); data.push(1, 3, 2); }
      g.setAttribute('aData', new THREE.Float32BufferAttribute(data, 3));
      g.setAttribute('aLight', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
      this.scene.add(new THREE.Mesh(g, this.mats.ocean));
    }
  }

  buildComposer() {
    const c = (this.composer = new EffectComposer(this.renderer));
    c.setPixelRatio(this.renderer.getPixelRatio());
    c.setSize(window.innerWidth, window.innerHeight);
    c.addPass(new RenderPass(this.scene, this.camera));
    const handPass = new RenderPass(this.hand.scene, this.hand.camera);
    handPass.clear = false;
    handPass.clearDepth = true;
    c.addPass(handPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.55, 0.95);
    c.addPass(this.bloom);
    c.addPass(new ShaderPass(GradeShader));
    c.addPass(new OutputPass());
  }

  buildSky() {
    const mk = (tex) => new THREE.Mesh(
      new THREE.PlaneGeometry(70, 70),
      new THREE.MeshBasicMaterial({ map: tex, fog: false, transparent: true }),
    );
    this.sun = mk(makeSunTexture());
    this.sun.material.color.setScalar(4); // over-bright so bloom makes it glow
    this.moon = mk(makeMoonTexture());
    this.moon.material.color.setScalar(1.6);
    this.moon.scale.setScalar(0.7);
    this.scene.add(this.sun, this.moon);

    this.sky = createSky(this.u.uSunDir);
    this.scene.add(this.sky.mesh);

    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5)
        .normalize().multiplyScalar(900);
      pts.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false,
    }));
    this.scene.add(this.stars);

    const cloudTex = makeCloudTexture();
    cloudTex.repeat.set(12, 12);
    this.cloudTex = cloudTex;
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 6, D * 6),
      new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.set(W / 2, H + 20, D / 2);
    this.scene.add(this.clouds);
  }

  bindEvents() {
    this.onResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.hand.resize();
      this.composer.setSize(window.innerWidth, window.innerHeight);
    };
    this.onKeyDown = (e) => {
      if (store.get().screen !== 'game') return;
      this.sound.unlock();
      if (e.code === 'KeyM' && !store.get().inventoryOpen) { this.toggleMap(); return; }
      if (store.get().mapOpen) {
        if (e.code === 'Escape') this.closeMap(false);
        return;
      }
      if (e.code === 'KeyE') { this.toggleInventory(); return; }
      if (store.get().inventoryOpen) {
        if (e.code === 'Escape') this.closeInventory(false);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.onSpaceTap();
      }
      this.keys.add(e.code);
      if (/^Digit[1-9]$/.test(e.code)) this.select(Number(e.code.slice(5)) - 1);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onMouseMove = (e) => {
      if (!this.locked) return;
      const sens = 0.0022 * store.get().sensitivity;
      this.player.yaw -= e.movementX * sens;
      this.player.pitch -= e.movementY * sens;
      this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.player.pitch));
    };
    this.onMouseDown = (e) => {
      if (store.get().screen === 'game') this.sound.unlock();
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; this.placeCooldown = 0; }
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) { this.mouse.left = false; this.warned = false; }
      if (e.button === 2) this.mouse.right = false;
    };
    this.onWheel = (e) => {
      if (!this.locked) return;
      const s = store.get().selected;
      this.select((s + (e.deltaY > 0 ? 1 : -1) + 9) % 9);
    };
    this.onContext = (e) => e.preventDefault();
    this.onVisibility = () => {
      if (document.hidden) { this.sound.suspend(); this.save(); }
      else this.sound.resume();
    };
    this.onLockChange = () => {
      this.locked = document.pointerLockElement === this.renderer.domElement;
      if (!this.locked) {
        this.keys.clear(); this.mouse.left = this.mouse.right = false;
        if (!store.get().inventoryOpen) this.save(); // paused: a good moment to save
      }
      store.set({ locked: this.locked });
    };

    window.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('contextmenu', this.onContext);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('contextmenu', this.onContext);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.unsubVolume();
    this.sound.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------- public API ----------------
  /** start a new world ({ seedText }) or continue a validated save ({ save }) */
  async start({ seedText, save } = {}) {
    this.sound.unlock(); // called from the Play click, so audio is allowed
    const seed = save ? save.seed : seedText ? hashString(seedText) : (Math.random() * 2 ** 31) | 0;
    this.seed = seed;
    store.set({ screen: 'loading', progress: 0, status: 'Shaping the land…' });
    await nextFrame();
    await this.world.generate(seed, (progress, status) => store.set({ progress, status }));
    if (save) {
      store.set({ status: 'Restoring your changes…' });
      this.world.applyEdits(save.edits);
      for (const [k, slots] of save.chests) {
        const { x, y, z } = World.coords(k);
        if (this.world.get(x, y, z) === CHEST) this.world.chests.set(k, slots);
      }
    }

    const s = save ? save.pos : this.world.findSpawn();
    this.spawnPoint = save ? { ...save.spawn } : { ...s };
    Object.assign(this.player.pos, s);
    this.player.vel.x = this.player.vel.y = this.player.vel.z = 0;
    this.player.airMaxY = s.y;
    this.health = save ? save.health : MAX_HP;
    this.hunger = save ? save.hunger : MAX_FOOD;
    this.hungerT = this.starveT = 0;
    this.dead = false;
    store.set({ health: this.health, hunger: this.hunger, dead: false });
    this.player.yaw = save ? save.yaw : Math.random() * Math.PI * 2;
    this.player.pitch = save ? save.pitch : 0;
    if (save) this.time = save.time;
    if (save) {
      this.unstick(this.spawnPoint);
      this.unstick(this.player.pos);
      this.player.airMaxY = this.player.pos.y;
    }
    this.saveTimer = 0;
    this.updateCamera();

    store.set({ status: 'Building chunks…' });
    const pcx = Math.floor(s.x / CS), pcz = Math.floor(s.z / CS);
    const near = this.offsets.filter(([dx, dz]) => dx * dx + dz * dz <= 9);
    for (let i = 0; i < near.length; i++) {
      const cx = pcx + near[i][0], cz = pcz + near[i][1];
      if (cx >= 0 && cz >= 0 && cx < CX && cz < CZ) this.buildChunkMesh(cx, cz);
      if (i % 6 === 5) { store.set({ progress: 0.95 + (0.05 * i) / near.length }); await nextFrame(); }
    }

    store.set({
      slots: save ? save.slots : inv.defaultSlots(),
      selected: save ? save.selected : 0,
      armor: save ? save.armor : null,
      cursor: null, inventoryOpen: false, chest: null, progress: 1,
    });
    this.mobs.populate(s.x, s.z);
    this.started = true;
    this.updateSky();
    store.set({ screen: 'game' });
  }

  // ---------------- saving ----------------
  /** move a loaded position up out of solid blocks (e.g. a save whose spot got built over) */
  unstick(pos) {
    const probe = new Player();
    Object.assign(probe.pos, pos);
    while (probe.collides(this.world) && probe.pos.y < H + 2) probe.pos.y = Math.floor(probe.pos.y) + 1;
    pos.y = probe.pos.y;
  }

  /** a snapshot of everything needed to restore this world */
  snapshot() {
    const st = store.get();
    // an item held by the mouse in the inventory belongs in the save too
    const slots = st.slots.slice();
    if (st.cursor) { const j = slots.indexOf(null); if (j >= 0) slots[j] = st.cursor; }
    const p = this.player.pos;
    return {
      v: 2, seed: this.seed, savedAt: Date.now(),
      edits: [...this.world.edits],
      slots, selected: st.selected,
      pos: { x: p.x, y: Math.max(-16, Math.min(H + 60, p.y)), z: p.z }, spawn: { ...this.spawnPoint },
      yaw: this.player.yaw % (Math.PI * 2), pitch: this.player.pitch,
      time: this.time, health: Math.max(1, Math.round(this.health)),
      hunger: Math.round(this.hunger), armor: st.armor,
      chests: [...this.chestsWithOpen()].filter(([, s]) => s.some(Boolean)),
    };
  }

  /** every chest's contents, including the one open right now */
  chestsWithOpen() {
    const m = new Map(this.world.chests);
    const c = store.get().chest;
    if (c) m.set(c.key, c.slots);
    return m;
  }

  save() {
    if (!this.started || this.dead) return; // a dead player is saved after respawning
    const st = store.get();
    if (st.cursor && !st.slots.includes(null)) return; // held stack wouldn't fit in the save; try later
    this.saveTimer = 0;
    writeSave(this.snapshot()).then((ok) => { if (!ok && !this.saveWarned) { this.saveWarned = true; toast('Could not save (browser storage blocked?)'); } });
  }

  exportSave() {
    if (this.started) downloadSave(this.snapshot());
  }

  lock() {
    this.sound.unlock();
    const p = this.renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }

  select(i) {
    if (i !== store.get().selected) this.sound.click();
    store.set({ selected: i });
  }

  // three quick Space taps toggle flying
  onSpaceTap() {
    const now = performance.now();
    this.spaceTaps = (this.spaceTaps || []).filter((t) => now - t < 600);
    this.spaceTaps.push(now);
    if (this.spaceTaps.length >= 3) {
      this.spaceTaps = [];
      const p = this.player;
      p.flying = !p.flying;
      p.vel.y = p.flying ? 0 : p.vel.y;
      store.set({ flying: p.flying });
      this.sound.fly(p.flying);
      toast(p.flying ? 'Flying ON  (Space up · Shift down)' : 'Flying OFF');
    }
  }

  toggleInventory() {
    if (store.get().inventoryOpen) this.closeInventory(true);
    else if (this.locked) {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
      store.set({ inventoryOpen: true });
      this.sound.invOpen();
      document.exitPointerLock();
    }
  }

  toggleMap() {
    if (store.get().mapOpen) this.closeMap(true);
    else if (this.locked) {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
      store.set({ mapOpen: true });
      this.sound.invOpen();
      document.exitPointerLock();
    }
  }

  closeMap(relock) {
    store.set({ mapOpen: false });
    this.sound.invClose();
    if (relock) this.lock();
  }

  /** paint the whole world, seen from above, into a canvas (one pixel per `scale` blocks) */
  drawMap(canvas, scale = 2) {
    const n = W / scale;
    canvas.width = canvas.height = n;
    const g = canvas.getContext('2d');
    const img = g.createImageData(n, n);
    const cols = blockColors();
    const w = this.world;
    for (let mz = 0; mz < n; mz++) for (let mx = 0; mx < n; mx++) {
      const x = mx * scale, z = mz * scale;
      const top = w.tops[z * W + x];
      let y = top;
      while (y > 0 && w.data[(z * W + x) * H + y] === AIR) y--;
      const id = w.data[(z * W + x) * H + y];
      const c = cols[id] || [255, 0, 255];
      let k;
      if (id === WATER) {
        // deeper water is darker
        let b = y;
        while (b > 0 && w.data[(z * W + x) * H + b] === WATER) b--;
        k = 1.15 - Math.min(0.55, (y - b) * 0.04);
      } else {
        // light from the north-west: slopes facing it are brighter
        const nz = Math.max(0, z - scale), nx = Math.max(0, x - scale);
        k = 0.92 + Math.max(-0.3, Math.min(0.3, (y - w.tops[nz * W + nx]) * 0.08)) + (y - WATER_LEVEL) * 0.004;
      }
      const o = (mz * n + mx) * 4;
      img.data[o] = c[0] * k; img.data[o + 1] = c[1] * k; img.data[o + 2] = c[2] * k; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // borders between the maps
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(n / 2, 0); g.lineTo(n / 2, n); g.moveTo(0, n / 2); g.lineTo(n, n / 2);
    g.stroke();
    return { size: W, player: { ...this.player.pos }, yaw: this.player.yaw, spawn: { ...this.spawnPoint } };
  }

  closeInventory(relock) {
    this.returnCursorSafely();
    this.storeChest();
    store.set({ inventoryOpen: false, chest: null });
    this.sound.invClose();
    if (relock) this.lock();
  }

  // ---------------- chests ----------------
  openChest(t) {
    const key = (t.z * W + t.x) * H + t.y;
    const slots = this.world.chests.get(key) ?? Array(inv.CHEST_SIZE).fill(null);
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
    store.set({ inventoryOpen: true, chest: { key, slots: slots.slice() } });
    this.sound.invOpen();
    document.exitPointerLock();
  }

  /** put the stack held by the mouse back; what doesn't fit in the inventory goes into the open chest */
  returnCursorSafely() {
    const { cursor, chest } = store.get();
    if (!cursor) return;
    const left = inv.returnCursor();
    if (left && chest) {
      const cs = chest.slots.slice();
      const rest = inv.moveIntoChest(cs, left);
      store.set({ chest: { ...chest, slots: cs } });
      if (rest) toast('Inventory full: some items were lost');
    } else if (left) toast('Inventory full: some items were lost');
  }

  /** copy the open chest's slots back into the world */
  storeChest() {
    const c = store.get().chest;
    if (!c) return;
    const { x, y, z } = World.coords(c.key);
    if (this.world.get(x, y, z) === CHEST) this.world.chests.set(c.key, c.slots.slice());
  }

  // ---------------- chunks ----------------
  buildChunkMesh(cx, cz) {
    const key = cz * CX + cx;
    const old = this.chunks.get(key);
    if (old) this.disposeChunk(old);
    const data = buildChunk(this.world, cx, cz);
    const meshes = [];
    for (const t of ['o', 'c', 'w']) {
      const b = data[t];
      if (!b.i.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('aData', new THREE.Float32BufferAttribute(b.d, 3));
      geo.setAttribute('aLight', new THREE.Float32BufferAttribute(b.l, 1));
      geo.setIndex(b.i);
      const m = new THREE.Mesh(geo, this.mats[t]);
      m.matrixAutoUpdate = false;
      this.scene.add(m);
      meshes.push(m);
    }
    this.chunks.set(key, { cx, cz, meshes });
  }

  disposeChunk(c) {
    for (const m of c.meshes) { this.scene.remove(m); m.geometry.dispose(); }
  }

  updateChunks() {
    const p = this.player.pos;
    const pcx = Math.floor(p.x / CS), pcz = Math.floor(p.z / CS);
    if (pcx !== this.lastPcx || pcz !== this.lastPcz) {
      this.lastPcx = pcx; this.lastPcz = pcz;
      const lim = (RD + 2) ** 2;
      for (const [k, c] of this.chunks) {
        if ((c.cx - pcx) ** 2 + (c.cz - pcz) ** 2 > lim) { this.disposeChunk(c); this.chunks.delete(k); }
      }
    }
    const t0 = performance.now();
    for (const [dx, dz] of this.offsets) {
      const cx = pcx + dx, cz = pcz + dz;
      if (cx < 0 || cz < 0 || cx >= CX || cz >= CZ) continue;
      if (this.chunks.has(cz * CX + cx)) continue;
      this.buildChunkMesh(cx, cz);
      if (performance.now() - t0 > 6) break;
    }
  }

  /** rebuild after a block change; lamps light a wider area, so rebuild every chunk they reach */
  rebuildFor(x, z, id) {
    if (!BLOCKS[id]?.light) { this.rebuildAround(x, z); return; }
    const r = LIGHT_RADIUS + 1;
    for (let cz = Math.floor((z - r) / CS); cz <= Math.floor((z + r) / CS); cz++)
      for (let cx = Math.floor((x - r) / CS); cx <= Math.floor((x + r) / CS); cx++)
        if (this.chunks.has(cz * CX + cx)) this.buildChunkMesh(cx, cz);
  }

  rebuildAround(x, z) {
    const done = new Set();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = Math.floor((x + dx) / CS), cz = Math.floor((z + dz) / CS);
      const key = cz * CX + cx;
      if (done.has(key) || !this.chunks.has(key)) continue;
      done.add(key);
      this.buildChunkMesh(cx, cz);
    }
  }

  // ---------------- game loop ----------------
  frame = (now) => {
    this.raf = requestAnimationFrame(this.frame);
    const rawDt = (now - this.last) / 1000;
    const dt = Math.min(0.05, rawDt); // clamped for stable physics
    this.last = now;
    if (this.started) {
      const st = store.get();
      const paused = (!this.locked && !st.inventoryOpen) || this.dead;
      if (!paused) this.tick(dt);
      this.updateAmbience(dt, paused);
      this.updateChunks();
      this.updateHand(dt);
    }
    this.clockTime += dt;
    this.u.uTime.value = this.clockTime;
    this.u.uCamPos.value.copy(this.camera.position);
    this.sky.mesh.position.copy(this.camera.position);

    if (this.started && store.get().postfx) {
      this.composer.render(dt);
    } else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      if (this.started) {
        this.renderer.clearDepth();
        this.renderer.render(this.hand.scene, this.hand.camera);
      }
    }

    this.frames++;
    this.debugTimer += rawDt; // real elapsed time, so the FPS counter can show below 20
    if (this.debugTimer >= 0.25 && this.started) {
      this.fps = Math.round(this.frames / this.debugTimer);
      this.frames = 0; this.debugTimer = 0;
      const p = this.player.pos;
      const hours = (this.time * 24 + 6) % 24;
      store.set({
        debug: {
          fps: this.fps,
          x: p.x.toFixed(1), y: p.y.toFixed(1), z: p.z.toFixed(1),
          clock: `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`,
          target: this.enemyTarget ? `Gloom 👁 (${Math.max(0, this.enemyTarget.hp)} HP)`
            : this.mobTarget ? 'Mossling 🌱' : this.target ? BLOCKS[this.target.id].name : null,
          chunks: this.chunks.size,
        },
      });
    }
  };

  tick(dt) {
    this.saveTimer += dt;
    if (this.saveTimer >= AUTOSAVE_EVERY) this.save();
    const k = this.keys;
    const input = this.locked
      ? {
          forward: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
          strafe: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
          jump: k.has('Space'),
          sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
        }
      : { forward: 0, strafe: 0, jump: false, sprint: false };
    const inWater = this.player.update(dt, input, this.world);
    this.updateCamera();
    this.sound.setListener(this.player.pos, EYE, this.player.yaw);
    this.movementSounds(dt, input, inWater);

    // say so when walking onto another map
    const reg = regionAt(this.player.pos.x, this.player.pos.z);
    if (reg !== this.region) {
      if (this.region) toast(`Entering ${reg.name}`);
      this.region = reg;
    }

    // fall damage: 1 HP per block beyond 3
    if (this.player.lastFall > 3.5) this.hurt(Math.floor(this.player.lastFall - 3), null);

    // hunger: drains over time, faster while sprinting
    const moving = Math.hypot(this.player.vel.x, this.player.vel.z) > 1;
    this.hungerT += dt * (input.sprint && moving && !this.player.flying ? 3 : 1);
    if (this.hungerT >= HUNGER_EVERY) { this.hungerT = 0; this.setHunger(this.hunger - 1); }
    if (this.hunger <= 0) {
      this.starveT += dt;
      if (this.starveT >= 4) { this.starveT = 0; if (this.health > 1) this.hurt(1, null, true); }
    } else this.starveT = 0;

    // natural regeneration after 6 s without damage, while not too hungry (healing makes you hungrier)
    this.sinceHurt += dt;
    if (this.sinceHurt > 6 && this.health < MAX_HP && this.hunger >= REGEN_MIN_FOOD) {
      this.regenTimer += dt;
      if (this.regenTimer >= 2.5) { this.regenTimer = 0; this.setHealth(this.health + 1); this.hungerT += 6; }
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    // what are we looking at?
    const dir = this.camera.getWorldDirection(this._dir);
    const c = this.camera.position;
    this.target = this.world.raycast(c.x, c.y, c.z, dir.x, dir.y, dir.z, REACH);

    // creatures in front of the block take priority
    const t = this.target;
    let nearest = t ? Math.hypot(t.x + 0.5 - c.x, t.y + 0.5 - c.y, t.z + 0.5 - c.z) - 0.5 : Infinity;
    const mobHit = this.mobs.raycast(c, dir, REACH);
    const enemyHit = this.enemies.raycast(c, dir, REACH);
    this.mobTarget = null;
    this.enemyTarget = null;
    if (enemyHit && enemyHit.dist < nearest) { this.enemyTarget = enemyHit.enemy; nearest = enemyHit.dist; this.target = null; }
    if (mobHit && mobHit.dist < nearest) { this.mobTarget = mobHit.mob; this.enemyTarget = null; this.target = null; }

    const st0 = store.get();
    const heldId = st0.slots[st0.selected]?.id;
    if (this.mouse.leftPressed) {
      if (this.enemyTarget) {
        if (isSword(heldId)) {
          if (this.attackCooldown <= 0) {
            this.attackCooldown = SWORD_COOLDOWN;
            this.hand.swing = 1;
            const e = this.enemyTarget, ep = { x: e.body.pos.x, y: e.body.pos.y + 1, z: e.body.pos.z };
            this.sound.swing();
            if (this.enemies.damage(e, ITEMS[heldId].damage, this.player.pos)) {
              this.sound.enemyDie(ep);
              toast('Gloom defeated!');
            } else this.sound.hitEnemy(ep);
          }
        } else {
          this.hand.swing = 1;
          this.sound.swing();
          toast('Only a sword can hurt the Gloom!');
        }
      } else if (this.mobTarget) {
        this.mobs.bonk(this.mobTarget, this.player.pos);
        this.sound.bonk(this.mobTarget.pos);
        this.hand.swing = 1;
      } else if (isSword(heldId) && this.attackCooldown <= 0) {
        this.attackCooldown = SWORD_COOLDOWN;
        this.sound.swing(); // swing at thin air
      }
    }
    this.mouse.leftPressed = false;
    this.mobs.update(dt, this.player, heldId, this.light, 1 - this.dayAmt);
    if (store.get().monsters) this.enemies.update(dt, this.player, this.dayAmt, (dmg, from) => this.hurt(dmg, from));
    else if (this.enemies.list.length) { this.enemies.clear(); this.enemyTarget = null; } // peaceful: no Glooms

    // hold T to fast-forward time (handy for reaching the night)
    if (this.keys.has('KeyT')) this.time = (this.time + (dt * 40) / DAY_LEN) % 1;

    if (this.target) {
      this.outline.visible = true;
      this.outline.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else this.outline.visible = false;

    this.updateMining(dt);
    this.updateUse();
    this.updatePlacing(dt);

    this.time = (this.time + dt / DAY_LEN) % 1;
    this.cloudTex.offset.x += dt * 0.0006;
    this.updateSky();
  }

  // ---------------- health ----------------
  setHealth(hp) {
    this.health = Math.max(0, Math.min(MAX_HP, hp));
    store.set({ health: this.health });
  }

  setHunger(v) {
    this.hunger = Math.max(0, Math.min(MAX_FOOD, v));
    store.set({ hunger: this.hunger });
  }

  /** pierce = ignores armor (starving) */
  hurt(dmg, from, pierce = false) {
    if (this.dead || dmg <= 0) return;
    const armor = store.get().armor;
    if (armor && !pierce) dmg = Math.max(1, Math.round(dmg * (1 - ITEMS[armor.id].armor)));
    this.setHealth(this.health - dmg);
    this.sinceHurt = 0;
    this.regenTimer = 0;
    store.set({ hurtId: (store.get().hurtId || 0) + 1 });
    this.sound.hurt();
    if (from) {
      const p = this.player.pos;
      const dx = p.x - from.x, dz = p.z - from.z, l = Math.hypot(dx, dz) || 1;
      this.player.vel.x = (dx / l) * 7;
      this.player.vel.z = (dz / l) * 7;
      this.player.vel.y = 5.5;
    }
    if (this.health <= 0) this.die();
  }

  die() {
    this.dead = true;
    this.sound.death();
    this.mouse.left = this.mouse.right = false;
    this.keys.clear();
    this.returnCursorSafely();
    this.storeChest();
    store.set({ dead: true, inventoryOpen: false, chest: null });
    document.exitPointerLock();
  }

  respawn() {
    const s = this.spawnPoint;
    Object.assign(this.player.pos, s);
    this.player.vel.x = this.player.vel.y = this.player.vel.z = 0;
    this.player.airMaxY = s.y;
    this.player.flying = false;
    this.enemies.clear();
    this.dead = false;
    this.sinceHurt = 0;
    this.setHealth(MAX_HP);
    this.setHunger(MAX_FOOD);
    this.hungerT = this.starveT = 0;
    store.set({ dead: false, flying: false });
    this.sound.respawn();
    this.updateCamera();
    this.save();
    this.lock();
  }

  updateHand(dt) {
    const st = store.get();
    this.hand.setItem(st.slots[st.selected]?.id ?? null);
    const v = this.player.vel;
    this.hand.update(dt, {
      speed: Math.hypot(v.x, v.z),
      onGround: this.player.onGround,
      swinging: this.mouse.left && this.locked,
      light: this.light,
    });
  }

  updateCamera() {
    const p = this.player.pos;
    this.camera.position.set(p.x, p.y + EYE, p.z);
    this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
  }

  updateMining(dt) {
    const st = store.get();
    const held = st.slots[st.selected];
    const t = this.target;
    if (this.mouse.left && this.locked && t) {
      const def = BLOCKS[t.id], tool = ITEMS[held?.id];
      if (!isTool(held?.id)) {
        this.mining = null;
        if (!this.warned) { toast('You need a tool to mine! (pickaxe, axe or shovel)'); this.warned = true; }
      } else if (def.unbreakable) {
        this.mining = null;
        if (!this.warned) { toast('Bedrock is unbreakable'); this.warned = true; }
      } else if (def.tier && (tool.kind !== 'pick' || tool.tier < def.tier)) {
        this.mining = null;
        if (!this.warned) { toast(`${def.name} needs ${TOOL_NAME[def.tier]} pickaxe or better`); this.warned = true; }
      } else {
        const m = this.mining;
        if (!m || m.x !== t.x || m.y !== t.y || m.z !== t.z) { this.mining = { x: t.x, y: t.y, z: t.z, t: 0 }; this.mineStage = -1; }
        // block hardness x tool speed; the wrong kind of tool is slow
        const right = !def.tool || def.tool === tool.kind;
        this.mining.need = def.hardness * (right ? tool.mineMult : 2.5);
        this.mining.t += dt;
        // a knock on every other crack stage: 4 hits per block
        const knock = Math.floor((this.mining.t / this.mining.need) * 4);
        if (knock !== this.mineStage && knock < 4) { this.mineStage = knock; this.sound.mineHit(t.id); }
        if (this.mining.t >= this.mining.need) {
          if (t.id === CHEST && !this.roomForChest(t)) {
            this.mining = null;
            if (!this.warned) { toast('Inventory full: empty the chest first'); this.warned = true; }
          } else { this.breakBlock(t); this.mining = null; }
        }
      }
    } else this.mining = null;

    if (this.mining) {
      const stage = Math.min(7, Math.floor((this.mining.t / this.mining.need) * 8));
      this.crack.material.map = this.cracks[stage];
      this.crack.position.set(this.mining.x + 0.5, this.mining.y + 0.5, this.mining.z + 0.5);
      this.crack.visible = true;
    } else this.crack.visible = false;
  }

  breakBlock(t) {
    const def = BLOCKS[t.id];
    this.world.set(t.x, t.y, t.z, AIR);
    if (def.door) { // the other half of the door goes too
      const oy = t.id === DOOR_B || t.id === DOOR_B_OPEN ? t.y + 1 : t.y - 1;
      if (BLOCKS[this.world.get(t.x, oy, t.z)]?.door) this.world.set(t.x, oy, t.z, AIR);
    }
    this.rebuildFor(t.x, t.z, t.id);
    this.sound.breakBlock(t.id);
    const drops = [[def.drop ?? t.id, 1]];
    if (t.id === LEAVES && Math.random() < 0.1) drops.push([APPLE, 1]);
    if (t.id === CHEST) {
      const key = (t.z * W + t.x) * H + t.y;
      for (const s of this.world.chests.get(key) ?? []) if (s) drops.push([s.id, s.count]);
      this.world.chests.delete(key);
    }
    let lost = 0;
    for (const [id, n] of drops) lost += inv.addItem(id, n);
    if (lost > 0) toast('Inventory full!');
    else this.sound.pickup();
  }

  /** would everything in this chest (and the chest itself) fit in the inventory? */
  roomForChest(t) {
    const items = [[CHEST, 1], ...(this.world.chests.get((t.z * W + t.x) * H + t.y) ?? []).filter(Boolean).map((s) => [s.id, s.count])];
    const slots = store.get().slots.map((s) => (s ? { ...s } : null));
    for (const [id, n] of items) {
      let left = n;
      const max = ITEMS[id]?.maxStack ?? 64;
      for (const s of slots) if (left && s && s.id === id && !s.inf && s.count < max) { const a = Math.min(left, max - s.count); s.count += a; left -= a; }
      for (let i = 0; i < slots.length && left; i++) if (!slots[i]) { const a = Math.min(left, max); slots[i] = { id, count: a, inf: false }; left -= a; }
      if (left) return false;
    }
    return true;
  }

  /** right click on a chest, door or bed, or with food or armor in hand (once per click) */
  updateUse() {
    const pressed = this.mouse.rightPressed;
    this.mouse.rightPressed = false;
    if (!pressed || !this.locked) return;
    const t = this.target;
    const st = store.get();
    const held = st.slots[st.selected];
    if (t && t.id === CHEST) { this.openChest(t); this.mouse.right = false; return; }
    if (t && BLOCKS[t.id].door) { this.toggleDoor(t); this.mouse.right = false; return; }
    if (t && t.id === BED) { this.sleep(t); this.mouse.right = false; return; }
    if (held && isFood(held.id)) { this.eat(held.id); this.mouse.right = false; return; }
    if (held && isArmor(held.id)) {
      const old = st.armor;
      const slots = st.slots.slice();
      slots[st.selected] = old;
      store.set({ slots, armor: held });
      this.sound.craft();
      toast(`Wearing ${ITEMS[held.id].name}`);
      this.mouse.right = false;
    }
  }

  eat(id) {
    const f = ITEMS[id];
    if (this.hunger >= MAX_FOOD && (!f.heal || this.health >= MAX_HP)) { toast("You're not hungry"); return; }
    inv.consumeSelected();
    this.setHunger(this.hunger + f.food);
    if (f.heal) this.setHealth(this.health + f.heal);
    this.sound.eat();
    this.hand.swing = 1;
  }

  toggleDoor(t) {
    const bottom = t.id === DOOR_B || t.id === DOOR_B_OPEN;
    const by = bottom ? t.y : t.y - 1;
    if (!BLOCKS[this.world.get(t.x, by, t.z)]?.door) return; // a lone top half: nothing to swing
    const open = t.id === DOOR_B_OPEN || t.id === DOOR_T_OPEN;
    if (open && this.playerOverlaps(t.x, by, t.z, 2)) return; // don't shut the door on yourself
    this.world.set(t.x, by, t.z, open ? DOOR_B : DOOR_B_OPEN);
    if (BLOCKS[this.world.get(t.x, by + 1, t.z)]?.door) this.world.set(t.x, by + 1, t.z, open ? DOOR_T : DOOR_T_OPEN);
    this.rebuildAround(t.x, t.z);
    this.sound.door(open);
    this.hand.swing = 1;
  }

  sleep(t) {
    this.spawnPoint = { x: t.x + 0.5, y: t.y + 0.6, z: t.z + 0.5 };
    if (this.dayAmt > 0.35) { toast('Respawn point set. You can only sleep at night.'); return; }
    const p = this.player.pos;
    if (this.enemies.list.some((e) => !e.dying && Math.hypot(e.body.pos.x - p.x, e.body.pos.z - p.z) < 10)) {
      toast("Respawn point set. You can't sleep with a Gloom nearby!");
      return;
    }
    this.time = 0.02; // sunrise
    this.enemies.clear();
    this.updateSky();
    this.save();
    toast('Good morning! Respawn point set.');
  }

  /** does the player's box overlap blocks (x, y..y+h-1, z)? */
  playerOverlaps(x, y, z, h = 1) {
    const p = this.player.pos;
    return p.x - PW < x + 1 && p.x + PW > x && p.y < y + h && p.y + PH > y && p.z - PW < z + 1 && p.z + PW > z;
  }

  updatePlacing(dt) {
    if (!this.mouse.right || !this.locked) return;
    this.placeCooldown -= dt;
    if (this.placeCooldown > 0) return;
    this.placeCooldown = 0.22;

    const st = store.get();
    const held = st.slots[st.selected];
    const t = this.target;
    if (!held || !t || (!isBlock(held.id) && held.id !== DOOR)) return;
    if (t.id === CHEST || t.id === BED || BLOCKS[t.id].door) return; // those are used, not built on
    const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    const free = (yy) => {
      if (x < 0 || z < 0 || x >= W || z >= D || yy < 1 || yy >= H) return false;
      const cur = this.world.get(x, yy, z);
      return cur === AIR || cur === WATER;
    };
    if (!free(y)) return;
    if (held.id === DOOR) {
      // a door is two blocks tall and stands on something solid
      if (!free(y + 1) || !SOLID[this.world.get(x, y - 1, z)] || this.playerOverlaps(x, y, z, 2)) return;
      this.world.set(x, y, z, DOOR_B);
      this.world.set(x, y + 1, z, DOOR_T);
      this.rebuildAround(x, z);
    } else {
      if (SOLID[held.id] && this.playerOverlaps(x, y, z)) return;
      this.world.set(x, y, z, held.id);
      this.rebuildFor(x, z, held.id);
    }
    inv.consumeSelected();
    this.sound.place(held.id);
    this.hand.swing = 1;
  }

  // ---------------- sound ----------------
  blockUnderFeet() {
    const p = this.player.pos;
    return this.world.get(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z));
  }

  movementSounds(dt, input, inWater) {
    const p = this.player;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.splashT = Math.max(0, (this.splashT || 0) - dt);
    // cooldown stops a splash every few frames while bobbing at the surface
    if (inWater && !this.wasInWater && this.splashT <= 0) {
      this.splashT = 0.8;
      this.sound.splash(Math.min(1.5, Math.abs(p.vel.y) / 6 + 0.3));
    }
    else if (inWater && (speed > 1 || input.jump)) {
      this.swimT -= dt;
      if (this.swimT <= 0) { this.swimT = 0.55; this.sound.swim(); }
    }
    this.wasInWater = inWater;

    if (p.onGround && !p.flying && !inWater) {
      const under = this.blockUnderFeet();
      if (!this.wasOnGround && p.lastFall > 0.8) { this.sound.land(under, p.lastFall); this.stepDist = 0; }
      this.stepDist += speed * dt;
      if (this.stepDist >= 2.1) { this.stepDist = 0; if (under) this.sound.step(under); }
    }
    this.wasOnGround = p.onGround;
  }

  updateAmbience(dt, paused) {
    const p = this.player.pos;
    // covered = the column's top block is above the head (caves, buildings, under trees)
    const x = Math.floor(p.x), z = Math.floor(p.z);
    const covered = x >= 0 && z >= 0 && x < W && z < D && this.world.tops[z * W + x] > p.y + PH + 1;
    this.sound.update(dt, {
      height: p.y,
      night: 1 - this.dayAmt,
      paused: paused || this.underwater,
      underground: covered,
    });
  }

  updateSky() {
    const a = this.time * Math.PI * 2;
    const s = Math.sin(a), c = Math.cos(a);
    const day = THREE.MathUtils.smoothstep(s, -0.18, 0.22);
    const sunset = Math.max(0, 1 - Math.abs(s) / 0.3);
    const light = 0.15 + 0.85 * day;
    this.light = light;
    this.dayAmt = day;
    const u = this.u;
    const dir = this._sunDir.set(c, s, 0.35).normalize();

    // main light: the sun by day, the moon by night (both fade to 0 at the horizon, so the swap is invisible)
    if (s > -0.02) {
      u.uSunDir.value.copy(dir);
      u.uSunColor.value.copy(SUN_DAY).lerp(SUN_SET, sunset).multiplyScalar(THREE.MathUtils.smoothstep(s, -0.02, 0.18));
    } else {
      u.uSunDir.value.copy(dir).negate();
      u.uSunColor.value.copy(MOON).multiplyScalar(THREE.MathUtils.smoothstep(-s, -0.02, 0.18));
    }
    u.uAmbient.value.copy(AMB_NIGHT).lerp(AMB_DAY, day).lerp(AMB_SET, sunset * 0.45);
    u.uNight.value = 1 - day;

    // sky
    this.skyColor.copy(HOR_NIGHT).lerp(HOR_DAY, day).lerp(HOR_SET, sunset * 0.75);
    const sk = this.sky.uniforms;
    sk.uHorizon.value.copy(this.skyColor);
    sk.uZenith.value.copy(ZEN_NIGHT).lerp(ZEN_DAY, day);
    sk.uSunGlow.value.copy(GLOW).multiplyScalar((0.25 + sunset * 1.2) * THREE.MathUtils.smoothstep(s, -0.25, 0.1));
    u.uZenith.value.copy(sk.uZenith.value);

    const cam = this.camera.position;
    const p = this.player.pos;
    const eyeBlock = this.world.get(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z));
    const underwater = eyeBlock === WATER;
    if (underwater) {
      this.fog.color.copy(WATER_FOG).multiplyScalar(0.2 + 0.8 * light);
      this.fog.near = 0.5; this.fog.far = 18;
      u.uFogSun.value.copy(this.fog.color);
    } else {
      this.fog.color.copy(this.skyColor);
      this.fog.near = RD * CS * 0.5; this.fog.far = RD * CS * 0.95;
      u.uFogSun.value.copy(this.skyColor).lerp(GLOW, (0.2 + sunset * 0.6) * day);
    }
    u.uFogColor.value.copy(this.fog.color);
    u.uFogNear.value = this.fog.near;
    u.uFogFar.value = this.fog.far;
    this.sky.mesh.visible = !underwater;
    this.renderer.setClearColor(this.fog.color);
    if (underwater !== this.underwater) {
      this.underwater = underwater;
      this.sound.setUnderwater(underwater);
      store.set({ underwater });
    }

    // clouds pick up sunset colour and darken at night
    this.clouds.material.color.setRGB(1, 1, 1).lerp(SUN_SET, sunset * 0.45).multiplyScalar(0.12 + 0.88 * day);
    this.sun.position.copy(cam).addScaledVector(dir, 600);
    this.sun.lookAt(cam);
    this.moon.position.copy(cam).addScaledVector(dir, -600);
    this.moon.lookAt(cam);
    this.stars.position.copy(cam);
    this.stars.material.opacity = Math.max(0, 1 - day * 1.3);
    this.stars.rotation.y = a * 0.15; // slow drift
  }
}
