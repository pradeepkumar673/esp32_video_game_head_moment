import { useState } from 'react';

const FIELDS = [
  {
    key: 'deadZoneDeg', label: 'Dead zone', unit: '\u00b0', min: 0, max: 20, step: 0.5,
    hint: 'How far from center the view may sit and still be pulled back. Used only with auto-center on.',
  },
  {
    key: 'centerRate', label: 'Centering speed', unit: '', min: 0, max: 1, step: 0.05,
    hint: 'How quickly the center moves toward your head when still. Used only with auto-center on.',
  },
  {
    key: 'stillRangeDeg', label: 'Still tolerance', unit: '\u00b0', min: 0.1, max: 3, step: 0.1,
    hint: 'How much your head may move in one second and still count as still.',
  },
];

export default function Settings({ config, profiles, actions }) {
  const [name, setName] = useState('');

  if (!config) {
    return (
      <div className="px-panel">
        <div className="px-panel-header">
          <h2 className="px-title">Settings</h2>
        </div>
        <p className="hint-text">Waiting for the bridge...</p>
      </div>
    );
  }

  return (
    <div className="px-panel">
      <div className="px-panel-header">
        <h2 className="px-title">Settings</h2>
      </div>

      <label className="px-checkbox">
        <input
          type="checkbox"
          checked={config.autoCenter}
          onChange={(e) => actions.setConfig({ autoCenter: e.target.checked })}
        />
        <span>Auto-center <em>(experimental)</em></span>
      </label>

      {FIELDS.map((f) => (
        <div className="px-field" key={f.key}>
          <div className="px-field-head">
            <span className="axis-label">{f.label}</span>
            <span className="axis-value">{config[f.key]}{f.unit}</span>
          </div>
          <input
            type="range"
            className="px-slider"
            min={f.min}
            max={f.max}
            step={f.step}
            value={config[f.key]}
            onChange={(e) => actions.setConfig({ [f.key]: parseFloat(e.target.value) })}
          />
          <p className="hint-text">{f.hint}</p>
        </div>
      ))}

      <button className="px-ghost" onClick={actions.resetDefaults}>Reset to defaults</button>

      <h3 className="px-subtitle">Profiles</h3>
      <div className="profile-row">
        <input
          className="px-input"
          placeholder="profile name"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="px-primary"
          disabled={!name.trim()}
          onClick={() => { actions.saveProfile(name.trim()); setName(''); }}
        >
          Save
        </button>
      </div>

      {profiles.length === 0 && <p className="hint-text">No saved profiles yet.</p>}
      <ul className="profiles-list">
        {profiles.map((p) => (
          <li key={p}>
            <span style={{ fontFamily: "'Silkscreen', monospace", fontSize: 12 }}>{p}</span>
            <button className="px-ghost" style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => actions.loadProfile(p)}>Load</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
