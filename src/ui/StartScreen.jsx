import { useEffect, useRef, useState } from 'react';
import { Controls } from './Controls.jsx';
import { Sensitivity, MonstersToggle } from './Sensitivity.jsx';
import { readSave, writeSave, downloadSave, readSaveFile } from '../game/save.js';

function savedWhen(t) {
  if (!t) return '';
  try { return ` · saved ${new Date(t).toLocaleString()}`; } catch { return ''; }
}

export function StartScreen({ onPlay, onContinue }) {
  const [seed, setSeed] = useState('');
  const [save, setSave] = useState(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    readSave().then((s) => { if (alive) setSave(s); });
    return () => { alive = false; };
  }, []);

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    if (save && !window.confirm('Importing replaces your current saved world. Continue?')) return;
    try {
      const s = await readSaveFile(file);
      if (!(await writeSave(s))) throw new Error('Could not store the save (browser storage blocked?)');
      setSave(s);
      setMsg('Save imported. Press Continue.');
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div className="screen start">
      <div className="start-hills" aria-hidden />
      <div className="panel start-panel">
        <h1 className="logo">OFFICECRAFT</h1>
        <p className="tagline">dig · build · survive the night</p>
        {save && (
          <>
            <button className="btn" onClick={() => onContinue(save)} autoFocus>
              Continue
            </button>
            <p className="continue-seed">
              {save.edits.length} block changes{savedWhen(save.savedAt)}
            </p>
          </>
        )}
        <label className="seed">
          <span>World seed (optional)</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="random"
            onKeyDown={(e) => e.key === 'Enter' && onPlay(seed.trim())}
          />
        </label>
        <button className={`btn${save ? ' secondary' : ''}`} onClick={() => onPlay(seed.trim())} autoFocus={!save}>
          {save ? 'New world (replaces your save)' : 'Play'}
        </button>
        <div className="save-row">
          <button className="btn small secondary" onClick={() => fileRef.current?.click()}>Import save</button>
          {save && <button className="btn small secondary" onClick={() => downloadSave(save)}>Export save</button>}
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
        </div>
        {msg && <p className="continue-seed">{msg}</p>}
        <MonstersToggle />
        <Sensitivity />
        <Controls />
        <p className="credits">Built by Leevi · improved by borre</p>
      </div>
    </div>
  );
}
