import { useEffect, useState } from 'react';
import { useStore, toast } from '../store.js';
import { itemName } from '../game/blocks.js';
import { itemIcon } from '../game/textures.js';
import { Slot } from './Slot.jsx';
import { Inventory } from './Inventory.jsx';
import { MapView } from './MapView.jsx';
import { Controls } from './Controls.jsx';
import { Sensitivity, PostFxToggle, Volume, MonstersToggle } from './Sensitivity.jsx';

function Hotbar() {
  const slots = useStore((s) => s.slots);
  const selected = useStore((s) => s.selected);
  return (
    <div className="hotbar">
      {slots.slice(0, 9).map((it, i) => (
        <Slot key={i} item={it} selected={i === selected} />
      ))}
    </div>
  );
}

function HeldName() {
  const selected = useStore((s) => s.selected);
  const id = useStore((s) => s.slots[s.selected]?.id);
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!id) { setShown(null); return; }
    setShown({ text: itemName(id), key: `${selected}-${id}-${Date.now()}` });
  }, [selected, id]);
  if (!shown) return null;
  return <div key={shown.key} className="held-name">{shown.text}</div>;
}

// 8x7 pixel heart: [y, xStart, xEnd]
const HEART_ROWS = [[0, 1, 2], [0, 5, 6], [1, 0, 7], [2, 0, 7], [3, 1, 6], [4, 2, 5], [5, 3, 4]];
const HEART_PX = HEART_ROWS.flatMap(([y, a, b]) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, y]));

function Heart({ fill }) {
  // fill: 0 empty, 1 half, 2 full
  return (
    <svg className="heart" viewBox="-0.5 -1 9 8" shapeRendering="crispEdges">
      {HEART_PX.map(([x, y]) => {
        const on = fill === 2 || (fill === 1 && x < 4);
        const shine = on && x === 1 && y === 1;
        return <rect key={`${x},${y}`} x={x} y={y} width="1.02" height="1.02" fill={shine ? '#ffc2c6' : on ? '#e8333f' : '#3a1216'} />;
      })}
    </svg>
  );
}

function Hearts() {
  const hp = useStore((s) => s.health);
  const hurtId = useStore((s) => s.hurtId);
  return (
    <div key={hurtId} className={`hearts${hp <= 4 ? ' low' : ''}${hurtId ? ' shake' : ''}`}>
      {Array.from({ length: 10 }, (_, i) => (
        <Heart key={i} fill={Math.max(0, Math.min(2, hp - i * 2))} />
      ))}
    </div>
  );
}

// 8x8 pixel drumstick: [x, y, colour]
const MEAT = [[4, 0], [5, 0], [3, 1], [4, 1], [5, 1], [6, 1], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3],
  [3, 4], [4, 4], [5, 4]];
const BONE = [[2, 5], [1, 6], [2, 6], [0, 7], [1, 7]];

function Drumstick({ fill }) {
  // fill: 0 empty, 1 half, 2 full (the right half empties first, like the hearts)
  return (
    <svg className="heart" viewBox="-0.5 -0.5 8 8.5" shapeRendering="crispEdges">
      {MEAT.map(([x, y]) => {
        const on = fill === 2 || (fill === 1 && x < 4);
        return <rect key={`m${x},${y}`} x={x} y={y} width="1.02" height="1.02" fill={on ? (x === 3 && y === 1 ? '#f0b080' : '#b8642c') : '#3a2416'} />;
      })}
      {BONE.map(([x, y]) => <rect key={`b${x},${y}`} x={x} y={y} width="1.02" height="1.02" fill={fill ? '#f2ead8' : '#4a4038'} />)}
    </svg>
  );
}

function Hunger() {
  const food = useStore((s) => s.hunger);
  const armor = useStore((s) => s.armor);
  return (
    <div className={`hunger${food <= 4 ? ' low' : ''}`}>
      {armor && <img className="armor-icon" src={itemIcon(armor.id)} alt="" title={itemName(armor.id)} />}
      {Array.from({ length: 10 }, (_, i) => (
        <Drumstick key={i} fill={Math.max(0, Math.min(2, food - (9 - i) * 2))} />
      ))}
    </div>
  );
}

function DamageFlash() {
  const hurtId = useStore((s) => s.hurtId);
  if (!hurtId) return null;
  return <div key={hurtId} className="damage-flash" />;
}

function Death({ game }) {
  return (
    <div className="screen death">
      <div className="death-box">
        <h1>You died!</h1>
        <p>Watch out for the Gloom at night, and keep your belly full…</p>
        <button className="btn" onClick={() => game.current.respawn()}>Respawn</button>
      </div>
    </div>
  );
}

function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return <div key={t.id} className="toast">{t.text}</div>;
}

function Debug() {
  const d = useStore((s) => s.debug);
  const flying = useStore((s) => s.flying);
  if (!d) return null;
  return (
    <div className="debug">
      <b>OfficeCraft</b> · {d.fps} fps · {d.chunks} chunks{flying ? ' · ✈ flying' : ''}{'\n'}
      XYZ {d.x} / {d.y} / {d.z}{'\n'}
      Time {d.clock}{d.target ? `\nLooking at: ${d.target}` : ''}
    </div>
  );
}

function Pause({ game }) {
  return (
    <div className="screen pause" onClick={() => game.current.lock()}>
      <div className="panel">
        <h2>Paused</h2>
        <p className="click">Click to play</p>
        <Sensitivity />
        <Volume />
        <PostFxToggle />
        <MonstersToggle />
        <div className="save-row" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <button className="btn small secondary" onClick={() => { game.current.save(); toast('Game saved'); }}>Save now</button>
          <button className="btn small secondary" onClick={() => game.current.exportSave()}>Export save</button>
        </div>
        <Controls />
      </div>
    </div>
  );
}

export function Hud({ game }) {
  const locked = useStore((s) => s.locked);
  const open = useStore((s) => s.inventoryOpen);
  const underwater = useStore((s) => s.underwater);
  const dead = useStore((s) => s.dead);
  const mapOpen = useStore((s) => s.mapOpen);
  return (
    <>
      {underwater && <div className="underwater" />}
      <DamageFlash />
      <div className="crosshair" />
      <Debug />
      <Toast />
      <HeldName />
      <Hearts />
      <Hunger />
      <Hotbar />
      {open && <Inventory game={game} />}
      {dead && <Death game={game} />}
      {mapOpen && <MapView game={game} />}
      {!locked && !open && !dead && !mapOpen && <Pause game={game} />}
    </>
  );
}
