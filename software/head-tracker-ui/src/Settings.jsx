import { useState } from 'react';

const FIELDS = [
  {
    key: 'deadZoneDeg', label: 'Dead zone', unit: '°', min: 0, max: 20, step: 0.5,
    hint: 'How far from center the view may sit and still be pulled back. Used only with auto-center on.',
  },
  {
    key: 'centerRate', label: 'Centering speed', unit: '', min: 0, max: 1, step: 0.05,
    hint: 'How quickly the center moves toward your head when still. Used only with auto-center on.',
  },
  {
    key: 'stillRangeDeg', label: 'Still tolerance', unit: '°', min: 0.1, max: 3, step: 0.1,
    hint: 'How much your head may move in one second and still count as still.',
  },
];

export default function Settings({ config, profiles, actions }) {
  const [name, setName] = useState('');

  if (!config) {
    return (
      <section className="panel">
        <h2>Settings</h2>
        <p className="hint">Waiting for the bridge...</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Settings</h2>

      <label className="toggle">
        <input
          type="checkbox"
          checked={config.autoCenter}
          onChange={(e) => actions.setConfig({ autoCenter: e.target.checked })}
        />
        <span>Auto-center <em>(experimental)</em></span>
      </label>

      {FIELDS.map((f) => (
        <div className="field" key={f.key}>
          <div className="field-head">
            <span className="label">{f.label}</span>
            <span className="value small">{config[f.key]}{f.unit}</span>
          </div>
          <input
            type="range"
            min={f.min}
            max={f.max}
            step={f.step}
            value={config[f.key]}
            onChange={(e) => actions.setConfig({ [f.key]: parseFloat(e.target.value) })}
          />
          <p className="hint">{f.hint}</p>
        </div>
      ))}

      <button className="ghost" onClick={actions.resetDefaults}>Reset to defaults</button>

      <h2 className="sub">Profiles</h2>
      <div className="profile-save">
        <input
          placeholder="profile name"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="primary small"
          disabled={!name.trim()}
          onClick={() => { actions.saveProfile(name.trim()); setName(''); }}
        >
          Save
        </button>
      </div>

      {profiles.length === 0 && <p className="hint">No saved profiles yet.</p>}
      <ul className="profiles">
        {profiles.map((p) => (
          <li key={p}>
            <span>{p}</span>
            <button className="ghost small" onClick={() => actions.loadProfile(p)}>Load</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

