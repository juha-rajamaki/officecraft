import { useEffect, useRef, useState } from 'react';
import { REGIONS, W, D, regionAt } from '../game/world.js';

// Full-screen map of all four maps (M to open and close)
export function MapView({ game }) {
  const canvas = useRef(null);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    setInfo(game.current.drawMap(canvas.current));
  }, [game]);

  const pct = (v, size) => `${(v / size) * 100}%`;
  const here = info && regionAt(info.player.x, info.player.z);
  return (
    <div className="screen map-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) game.current.closeMap(true); }}>
      <div className="panel map-panel">
        <div className="inv-head">
          <h2>Map{here ? ` · ${here.name}` : ''}</h2>
          <span className="hint">Walk or swim between the maps; bridges cross the sea · M or Esc: close</span>
        </div>
        <div className="map-wrap">
          <canvas ref={canvas} className="map-canvas" />
          {REGIONS.map((r) => (
            <div
              key={r.name}
              className={`map-label${here === r ? ' here' : ''}`}
              style={{ left: pct(r.ox + 256, W), top: pct(r.oz + 40, D) }}
            >
              {r.name}
            </div>
          ))}
          {info && (
            <>
              <div className="map-spawn" title="Respawn point" style={{ left: pct(info.spawn.x, W), top: pct(info.spawn.z, D) }} />
              <div
                className="map-player"
                title="You"
                style={{ left: pct(info.player.x, W), top: pct(info.player.z, D), transform: `translate(-50%, -50%) rotate(${-info.yaw}rad)` }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
