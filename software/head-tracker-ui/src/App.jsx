import { useState } from 'react';
import { useTracker } from './useTracker';
import Head3D from './Head3D';
import Settings from './Settings';
import Diagnostics from './Diagnostics';

const RANGE = 90;

function Axis({ label, value }) {
  const pct = Math.max(-1, Math.min(1, value / RANGE)) * 50;
  return (
    <div className="axis">
      <div className="axis-head">
        <span className="label">{label}</span>
        <span className="value">{value >= 0 ? '+' : ''}{value.toFixed(1)}°</span>
      </div>
      <div className="track">
        <div className="center" />
        <div
          className="fill"
          style={{ left: pct < 0 ? `${50 + pct}%` : '50%', width: `${Math.abs(pct)}%` }}
        />
      </div>
    </div>
  );
}

export default function App() {
  const { tracking, bridge, events, config, profiles, actions } = useTracker();
  const [view, setView] = useState('studio');

  const deviceLive = bridge.online && tracking.connected;
  const fresh = deviceLive && tracking.staleMs < 500;

  let state = 'off';
  let label = 'Bridge offline';
  if (bridge.online && !deviceLive) { state = 'warn'; label = 'Device disconnected'; }
  if (deviceLive && !fresh) { state = 'warn'; label = 'Stale data'; }
  if (fresh) { state = 'on'; label = 'Live'; }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Head Tracker <span>studio</span></div>
        <nav className="tabs">
          <button
            className={view === 'studio' ? 'tab active' : 'tab'}
            onClick={() => setView('studio')}
          >
            Studio
          </button>
          <button
            className={view === 'diag' ? 'tab active' : 'tab'}
            onClick={() => setView('diag')}
          >
            Diagnostics
          </button>
        </nav>
        <div className="status">
          <span className={`dot ${state}`} />
          {label}
        </div>
      </header>

      {view === 'studio' ? (
        <main className="layout">
          <section className="panel stage">
            <Head3D yaw={tracking.yaw} pitch={tracking.pitch} roll={tracking.roll} />
          </section>

          <div className="side">
            <section className="panel">
              <h2>Orientation</h2>
              <Axis label="Yaw" value={tracking.yaw} />
              <Axis label="Pitch" value={tracking.pitch} />
              <Axis label="Roll" value={tracking.roll} />
              <button className="primary" onClick={actions.recenter} disabled={!fresh}>
                Recenter
              </button>
              <p className="hint">Look straight ahead, then press Recenter to set that as the center.</p>
            </section>

            <section className="panel">
              <h2>Device</h2>
              <dl>
                <dt>Port</dt><dd>{bridge.port || '—'}</dd>
                <dt>Rate</dt><dd>{tracking.rate} Hz</dd>
                <dt>Frames</dt><dd>{bridge.frames ?? 0}</dd>
                <dt>Sent to OpenTrack</dt><dd>{bridge.sent ?? 0}</dd>
                <dt>Bad checksums</dt><dd>{bridge.badChecksum ?? 0}</dd>
              </dl>
            </section>

            <Settings config={config} profiles={profiles} actions={actions} />

            <section className="panel">
              <h2>Events</h2>
              {events.length === 0 && <p className="hint">No events yet.</p>}
              <ul>
                {events.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </section>
          </div>
        </main>
      ) : (
        <main className="layout-diag">
          <Diagnostics tracking={tracking} bridge={bridge} actions={actions} />
          <section className="panel">
            <h2>Events</h2>
            {events.length === 0 && <p className="hint">No events yet.</p>}
            <ul>
              {events.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </section>
        </main>
      )}
    </div>
  );
}
