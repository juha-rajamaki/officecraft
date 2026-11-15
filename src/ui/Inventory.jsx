import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { clickSlot, clickChest, clickArmor, HOTBAR, SIZE, CHEST_SIZE } from '../game/inventory.js';
import { itemName, ITEMS } from '../game/blocks.js';
import { Slot, ItemStack } from './Slot.jsx';
import { RECIPES, canCraft, craft } from '../game/crafting.js';

function Crafting({ game }) {
  useStore((s) => s.slots); // re-render when the inventory changes
  return (
    <div className="crafting">
      <h3>Crafting</h3>
      {RECIPES.map((r) => {
        const ok = canCraft(r);
        return (
          <div key={r.out[0]} className={`recipe${ok ? '' : ' off'}`}>
            {r.in.map(([id, n]) => (
              <div key={id} className="slot small" title={itemName(id)}><ItemStack item={{ id, count: n }} /></div>
            ))}
            <span className="arrow">→</span>
            <div className="slot small" title={itemName(r.out[0])}><ItemStack item={{ id: r.out[0], count: r.out[1] }} /></div>
            <button
              className="craft-btn"
              disabled={!ok}
              title={ok ? `Craft ${itemName(r.out[0])}` : 'Not enough materials or no room'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { if (craft(r)) game.current.sound.craft(); }}
            >
              Craft
            </button>
          </div>
        );
      })}
      <p className="hint">Logs come from trees, apples from leaves. Gold and diamond lie deep and need an iron pickaxe.</p>
    </div>
  );
}

export function Inventory({ game }) {
  const slots = useStore((s) => s.slots);
  const cursor = useStore((s) => s.cursor);
  const chest = useStore((s) => s.chest);
  const armor = useStore((s) => s.armor);
  const [mouse, setMouse] = useState({ x: -100, y: -100 });

  useEffect(() => {
    const move = (e) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  const slotProps = (i) => ({
    item: slots[i],
    title: slots[i] ? itemName(slots[i].id) : undefined,
    onMouseDown: (e) => { e.preventDefault(); clickSlot(i, e.button, e.shiftKey); },
  });

  const backpack = [];
  for (let i = HOTBAR; i < SIZE; i++) backpack.push(<Slot key={i} {...slotProps(i)} />);

  return (
    <div className="screen inventory-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) game.current.closeInventory(true); }}>
      <div className="panel inventory">
        <div className="inv-head">
          <h2>{chest ? 'Chest' : 'Inventory'}</h2>
          <span className="hint">Click: pick up / drop · Right click: split · Shift click: quick move · E: close</span>
        </div>
        <div className="inv-body">
          <div>
            {chest && (
              <div className="grid chest-grid">
                {Array.from({ length: CHEST_SIZE }, (_, i) => (
                  <Slot
                    key={i}
                    item={chest.slots[i]}
                    title={chest.slots[i] ? itemName(chest.slots[i].id) : undefined}
                    onMouseDown={(e) => { e.preventDefault(); clickChest(i, e.button, e.shiftKey); }}
                  />
                ))}
              </div>
            )}
            <div className="armor-row">
              <Slot
                item={armor}
                title={armor ? `Wearing ${itemName(armor.id)}` : 'Armor slot'}
                onMouseDown={(e) => { e.preventDefault(); clickArmor(e.shiftKey); }}
              />
              <span className="hint">{armor ? `Armor: blocks ${Math.round(ITEMS[armor.id].armor * 100)}% of damage` : 'Armor slot: put armor here'}</span>
            </div>
            <div className="grid">{backpack}</div>
            <div className="grid hotrow">
              {Array.from({ length: HOTBAR }, (_, i) => <Slot key={i} {...slotProps(i)} />)}
            </div>
          </div>
          <Crafting game={game} />
        </div>
      </div>
      {cursor && (
        <div className="cursor-item" style={{ left: mouse.x, top: mouse.y }}>
          <ItemStack item={cursor} />
        </div>
      )}
    </div>
  );
}
