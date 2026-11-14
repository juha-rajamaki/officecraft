import { useStore, setSensitivity, setPostfx, setVolume } from '../store.js';

export function Volume() {
  const value = useStore((s) => s.volume);
  return (
    <label className="sens" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <span>Sound volume</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
      />
      <b>{value === 0 ? 'OFF' : `${Math.round(value * 100)}%`}</b>
    </label>
  );
}

export function PostFxToggle() {
  const on = useStore((s) => s.postfx);
  return (
    <label className="sens" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <span>Bloom &amp; color grading</span>
      <input type="checkbox" checked={on} onChange={(e) => setPostfx(e.target.checked)} />
      <b>{on ? 'ON' : 'OFF'}</b>
    </label>
  );
}

export function Sensitivity() {
  const value = useStore((s) => s.sensitivity);
  return (
    // stopPropagation so dragging the slider doesn't trigger "click to play"
    <label className="sens" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <span>Mouse sensitivity</span>
      <input
        type="range"
        min="0.2"
        max="3"
        step="0.05"
        value={value}
        onChange={(e) => setSensitivity(parseFloat(e.target.value))}
      />
      <b>{Math.round(value * 100)}%</b>
    </label>
  );
}
