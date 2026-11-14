function PixelCheck({ ok, warn, label, detail }) {
  const state = ok ? 'on' : warn ? 'warn' : 'off';
  return (
    <div className="check-row">
      <span className={`pxdot-lg ${state}`} style={{
        background: ok ? 'var(--lime)' : warn ? 'var(--orange)' : 'var(--red)'
      }} />
      <div>
        <div className="check-label">{label}</div>
        <div className="check-detail">{detail}</div>
      </div>
    </div>
  );
}

export default function Diagnostics({ tracking, bridge, actions, events }) {
  const streaming = bridge.online && bridge.connected && tracking.staleMs < 500;
  const bias = bridge.deviceBias;
  const udpErrors = bridge.udpErrors ?? 0;
  const badChecksum = bridge.badChecksum ?? 0;

  const onCalibrate = () => {
    if (window.confirm('Keep the glasses completely still for 10 seconds. Continue?')) {
      actions.calibrate();
    }
  };

  return (
    <div className="diag-grid">
      {/* Left column */}
      <div>
        <div className="px-panel">
          <div className="px-panel-header">
            <h2 className="px-title">Connection</h2>
          </div>
          <PixelCheck
            ok={bridge.online}
            label="Bridge"
            detail={bridge.online ? 'Running on this PC' : 'Start read_bridge.js'}
          />
          <PixelCheck
            ok={bridge.connected}
            label="ESP32 serial link"
            detail={bridge.port ? `${bridge.port} at 115200 baud` : '\u2014'}
          />
          <PixelCheck
            ok={streaming}
            warn={bridge.connected && !streaming}
            label="Tracking stream"
            detail={`${tracking.rate} Hz, last frame ${tracking.staleMs} ms ago`}
          />
          <PixelCheck
            ok={badChecksum === 0}
            label="Frame checksums"
            detail={`${badChecksum} bad frames`}
          />
          <PixelCheck
            ok={bridge.sent > 0 && udpErrors === 0}
            warn={udpErrors > 0}
            label="OpenTrack output"
            detail={`${bridge.sent ?? 0} packets sent, ${udpErrors} errors`}
          />
        </div>

        {/* Events */}
        <div className="px-panel" style={{ marginTop: 20 }}>
          <div className="px-panel-header">
            <h2 className="px-title">Events</h2>
          </div>
          <div className="events-box">
            {(!events || events.length === 0)
              ? <p className="hint-text">No events yet.</p>
              : events.map((e, i) => (
                  <div key={i} className="event-item" style={{ color: i === 0 ? '#4FC3E8' : '#9BCB3C' }}>{e}</div>
                ))
            }
          </div>
        </div>
      </div>

      {/* Right column */}
      <div>
        <div className="px-panel">
          <div className="px-panel-header">
            <h2 className="px-title">Sensor</h2>
          </div>
          <dl className="data-grid">
            <dt>Gyro bias gx</dt><dd>{bias ? `${bias.gx.toFixed(2)} dps` : '\u2014'}</dd>
            <dt>Gyro bias gy</dt><dd>{bias ? `${bias.gy.toFixed(2)} dps` : '\u2014'}</dd>
            <dt>Gyro bias gz</dt><dd>{bias ? `${bias.gz.toFixed(2)} dps` : '\u2014'}</dd>
            <dt>Chip temp</dt><dd>{bias && bias.tempC != null ? `${bias.tempC.toFixed(1)} \u00b0C` : '\u2014'}</dd>
          </dl>
          <div className="mono-box">{bridge.lastDeviceLine || 'No device messages yet'}</div>
          <button
            className="px-primary"
            style={{ marginTop: 16, width: '100%' }}
            onClick={onCalibrate}
            disabled={!bridge.connected}
          >
            Calibrate sensor
          </button>
          <p className="hint-text" style={{ marginTop: 10 }}>
            Keep the glasses still on the desk for 10 s. Look straight ahead when done.
          </p>
        </div>

        <div className="px-panel" style={{ marginTop: 20 }}>
          <div className="px-panel-header">
            <h2 className="px-title">OpenTrack</h2>
          </div>
          <ol className="steps-list">
            <li>Input: UDP over network</li>
            <li>Output: freetrack 2.0 Enhanced</li>
            <li>Tracking started (Start button)</li>
          </ol>
          <p className="opentrack-note">
            The bridge sends packets to 127.0.0.1:4242. Check OpenTrack's raw tracker data
            panel to confirm it moves when you move your head.
          </p>
        </div>
      </div>
    </div>
  );
}
