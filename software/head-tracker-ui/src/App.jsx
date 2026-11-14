import { useState } from 'react';
import { useTracker } from './useTracker';
import Head3D from './Head3D';
import Settings from './Settings';
import Diagnostics from './Diagnostics';

const RANGE = 90;

function PixelAxis({ label, value }) {
  const pct = Math.max(-1, Math.min(1, value / RANGE)) * 50;
  return (
    <div className="axis">
      <div className="axis-head">
        <span className="axis-label">{label}</span>
        <span className="axis-value">{value >= 0 ? '+' : ''}{value.toFixed(1)}°</span>
      </div>
      <div className="px-track">
        <div className="px-center" />
        <div
          className="px-fill"
          style={{
            left: pct < 0 ? `${50 + pct}%` : '50%',
            width: `${Math.abs(pct)}%`,
          }}
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
  let statusLabel = 'Bridge offline';
  if (bridge.online && !deviceLive) { state = 'warn'; statusLabel = 'Device disconnected'; }
  if (deviceLive && !fresh) { state = 'warn'; statusLabel = 'Stale data'; }
  if (fresh) { state = 'on'; statusLabel = 'Live'; }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">HEAD TRACKER <span>[STUDIO]</span></div>
        <nav className="tabs">
          <button
            className={view === 'studio' ? 'tab active' : 'tab'}
            onClick={() => setView('studio')}
          >STUDIO</button>
          <button
            className={view === 'diag' ? 'tab active' : 'tab'}
            onClick={() => setView('diag')}
          >DIAGNOSTICS</button>
        </nav>
        <div className="status">
          <span className={`pxdot ${state}`} />
          <span style={{ fontFamily: "'Silkscreen', monospace", fontSize: 12 }}>{statusLabel}</span>
        </div>
      </header>

      {view === 'studio' ? (
        <main className="layout">
          {/* 3D Stage */}
          <div className="stage-wrap" style={{ height: 680 }}>
            <div className="stage-grid" />
            <div className="stage-canvas" style={{ height: '100%' }}>
              <Head3D yaw={tracking.yaw} pitch={tracking.pitch} roll={tracking.roll} />
            </div>
          </div>

          {/* Right column */}
          <div className="side">
            {/* Orientation */}
            <div className="px-panel">
              <div className="px-panel-header">
                <h2 className="px-title">Orientation</h2>
                <span className={`px-badge ${state}`}>{statusLabel}</span>
              </div>
              <PixelAxis label="Yaw" value={tracking.yaw} />
              <PixelAxis label="Pitch" value={tracking.pitch} />
              <PixelAxis label="Roll" value={tracking.roll} />
              <button className="px-primary" onClick={actions.recenter} disabled={!fresh}>
                Recenter
              </button>
              <p className="hint-text" style={{ marginTop: 10 }}>Look straight ahead, then press Recenter.</p>
            </div>

            {/* Device */}
            <div className="px-panel">
              <div className="px-panel-header">
                <h2 className="px-title">Device</h2>
              </div>
              <dl className="data-grid">
                <dt>Port</dt><dd>{bridge.port || '—'}</dd>
                <dt>Rate</dt><dd>{tracking.rate} Hz</dd>
                <dt>Frames</dt><dd>{bridge.frames ?? 0}</dd>
                <dt>Sent to OpenTrack</dt><dd>{bridge.sent ?? 0}</dd>
                <dt>Bad checksums</dt><dd>{bridge.badChecksum ?? 0}</dd>
              </dl>
            </div>

            <Settings config={config} profiles={profiles} actions={actions} />

            {/* Events */}
            <div className="px-panel">
              <div className="px-panel-header">
                <h2 className="px-title">Events</h2>
              </div>
              <div className="events-box">
                {events.length === 0
                  ? <p className="hint-text">No events yet.</p>
                  : events.map((e, i) => (
                      <div key={i} className="event-item" style={{ color: i === 0 ? '#4FC3E8' : '#9BCB3C' }}>{e}</div>
                    ))
                }
              </div>
            </div>
          </div>
        </main>
      ) : (
        <Diagnostics tracking={tracking} bridge={bridge} actions={actions} events={events} />
      )}
    </div>
  );
}
