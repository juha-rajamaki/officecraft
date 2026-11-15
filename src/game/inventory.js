// Inventory rules: 36 slots, stacks of 64, a few infinite stacks, tools stack to 1.
// Also an armor slot and, while one is open, a chest's 27 slots.
import { store } from '../store.js';
import { PICKAXE, SWORD, PLANKS, COBBLE, GLASS, BRICK, APPLE, maxStack, isArmor } from './blocks.js';

export const HOTBAR = 9;
export const SIZE = 36;
export const CHEST_SIZE = 27;

export function defaultSlots() {
  const s = Array(SIZE).fill(null);
  s[0] = { id: PICKAXE, count: 1 };
  s[1] = { id: SWORD, count: 1 };
  s[2] = { id: PLANKS, count: 1, inf: true };
  s[3] = { id: COBBLE, count: 1, inf: true };
  s[4] = { id: GLASS, count: 1, inf: true };
  s[5] = { id: BRICK, count: 1, inf: true };
  s[6] = { id: APPLE, count: 3 };
  return s;
}

const stackable = (a, b) => a && b && a.id === b.id && !a.inf && !b.inf && maxStack(a.id) > 1;

/** Adds items, returns how many didn't fit. */
export function addItem(id, n = 1) {
  const slots = store.get().slots.slice();
  let left = n;
  const max = maxStack(id);
  for (let i = 0; i < SIZE && left; i++) {
    const s = slots[i];
    if (s && s.id === id && !s.inf && s.count < max) {
      const add = Math.min(left, max - s.count);
      slots[i] = { ...s, count: s.count + add };
      left -= add;
    }
  }
  for (let i = 0; i < SIZE && left; i++) {
    if (!slots[i]) {
      const add = Math.min(left, max);
      slots[i] = { id, count: add };
      left -= add;
    }
  }
  store.set({ slots });
  return left;
}

/** how many of an item the player owns (infinite stacks don't count) */
export function countItem(id) {
  let n = 0;
  for (const s of store.get().slots) if (s && s.id === id && !s.inf) n += s.count;
  return n;
}

/** removes up to n of an item (never from infinite stacks); returns how many were removed */
export function removeItem(id, n) {
  const slots = store.get().slots.slice();
  let left = n;
  for (let i = SIZE - 1; i >= 0 && left; i--) {
    const s = slots[i];
    if (!s || s.id !== id || s.inf) continue;
    const take = Math.min(left, s.count);
    slots[i] = s.count > take ? { ...s, count: s.count - take } : null;
    left -= take;
  }
  store.set({ slots });
  return n - left;
}

/** how many of this item would still fit in the inventory */
export function roomFor(id) {
  const max = maxStack(id);
  let room = 0;
  for (const s of store.get().slots) {
    if (!s) room += max;
    else if (s.id === id && !s.inf) room += max - s.count;
  }
  return room;
}

export function consumeSelected() {
  const { slots, selected } = store.get();
  const s = slots[selected];
  if (!s || s.inf) return;
  const ns = slots.slice();
  ns[selected] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
  store.set({ slots: ns });
}

/** move as much of item as fits into arr[a..b), stacking first; returns what is left (count 0 = all moved) */
function moveInto(arr, a, b, item) {
  item = { ...item };
  for (let j = a; j < b && item.count > 0; j++) {
    const t = arr[j];
    if (stackable(t, item) && t.count < maxStack(t.id)) {
      const add = Math.min(item.count, maxStack(t.id) - t.count);
      arr[j] = { ...t, count: t.count + add };
      item.count -= add;
    }
  }
  for (let j = a; j < b && item.count > 0; j++) {
    if (!arr[j]) { arr[j] = item; item = { ...item, count: 0 }; }
  }
  return item;
}

/** pick up / drop / split on one slot of an array; returns the new cursor */
function clickIn(arr, i, button, cursor) {
  const s = arr[i];
  if (button === 0) {
    if (!cursor) { if (s) { cursor = s; arr[i] = null; } }
    else if (!s) { arr[i] = cursor; cursor = null; }
    else if (stackable(s, cursor)) {
      const add = Math.min(cursor.count, maxStack(s.id) - s.count);
      arr[i] = { ...s, count: s.count + add };
      cursor = cursor.count - add > 0 ? { ...cursor, count: cursor.count - add } : null;
    } else { arr[i] = cursor; cursor = s; }
  } else if (button === 2) {
    if (!cursor) {
      if (s) {
        if (s.inf || s.count === 1) { cursor = s; arr[i] = null; }
        else {
          const half = Math.ceil(s.count / 2);
          cursor = { ...s, count: half };
          arr[i] = { ...s, count: s.count - half };
        }
      }
    } else if (!s) {
      if (cursor.inf || cursor.count === 1) { arr[i] = cursor; cursor = null; }
      else { arr[i] = { ...cursor, count: 1 }; cursor = { ...cursor, count: cursor.count - 1 }; }
    } else if (stackable(s, cursor) && s.count < maxStack(s.id)) {
      arr[i] = { ...s, count: s.count + 1 };
      cursor = cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null;
    }
  }
  return cursor;
}

export function clickSlot(i, button, shift) {
  const { cursor, chest, armor } = store.get();
  const slots = store.get().slots.slice();
  const s = slots[i];

  if (shift && s && !cursor) {
    // shift-click: into an open chest, onto the body (armor), or between hotbar and backpack
    if (chest && !s.inf) {
      const cs = chest.slots.slice();
      const left = moveInto(cs, 0, CHEST_SIZE, s);
      slots[i] = left.count > 0 ? left : null;
      store.set({ slots, chest: { ...chest, slots: cs } });
      return;
    }
    if (isArmor(s.id) && !armor) {
      slots[i] = null;
      store.set({ slots, armor: s });
      return;
    }
    const [a, b] = i < HOTBAR ? [HOTBAR, SIZE] : [0, HOTBAR];
    const left = moveInto(slots, a, b, s);
    slots[i] = left.count > 0 ? left : null;
    store.set({ slots });
    return;
  }
  const c = clickIn(slots, i, button, cursor);
  store.set({ slots, cursor: c });
}

/** a click on one of the open chest's slots */
export function clickChest(i, button, shift) {
  const { cursor, chest } = store.get();
  if (!chest) return;
  const cs = chest.slots.slice();
  if (shift && cs[i] && !cursor) {
    const slots = store.get().slots.slice();
    const left = moveInto(slots, 0, SIZE, cs[i]);
    cs[i] = left.count > 0 ? left : null;
    store.set({ slots, chest: { ...chest, slots: cs } });
    return;
  }
  if (cursor?.inf) return; // infinite stacks stay with the player
  const c = clickIn(cs, i, button, cursor);
  store.set({ chest: { ...chest, slots: cs }, cursor: c });
}

/** a click on the armor slot: swap the held armor in or take the worn one out */
export function clickArmor(shift) {
  const { cursor, armor } = store.get();
  if (shift && armor && !cursor) {
    const slots = store.get().slots.slice();
    const left = moveInto(slots, 0, SIZE, armor);
    if (left.count === 0) store.set({ slots, armor: null });
    return;
  }
  if (cursor && !isArmor(cursor.id)) return;
  store.set({ armor: cursor, cursor: armor });
}

/** Put whatever the mouse is holding back into the inventory; returns the part that didn't fit (or null). */
export function returnCursor() {
  const { cursor } = store.get();
  if (!cursor) return null;
  store.set({ cursor: null });
  if (cursor.inf || maxStack(cursor.id) === 1) {
    const slots = store.get().slots.slice();
    const j = slots.indexOf(null);
    if (j < 0) return cursor;
    slots[j] = cursor;
    store.set({ slots });
    return null;
  }
  const left = addItem(cursor.id, cursor.count);
  return left > 0 ? { ...cursor, count: left } : null;
}

/** move a stack into a chest slot array; returns true if some of it didn't fit */
export function moveIntoChest(cs, item) {
  if (item.inf) return true;
  return moveInto(cs, 0, CHEST_SIZE, item).count > 0;
}
