const ROWS = [
  ['WASD', 'Move'],
  ['Mouse', 'Look around'],
  ['Space', 'Jump / swim'],
  ['Shift', 'Sprint'],
  ['Space ×3', 'Toggle flying'],
  ['Left click', 'Mine (pickaxe, axe, shovel) / attack (sword)'],
  ['Right click', 'Place block · open chest/door · sleep in bed · eat · wear armor'],
  ['W / Space', 'Climb a ladder (Shift: hold on)'],
  ['1–9 / Wheel', 'Select hotbar slot'],
  ['E', 'Inventory'],
  ['M', 'Map of all four maps'],
  ['T (hold)', 'Fast-forward time'],
  ['Esc', 'Pause'],
];

export function Controls() {
  return (
    <div className="controls">
      {ROWS.map(([k, v]) => (
        <div key={k} className="ctl">
          <kbd>{k}</kbd>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}
