function Check({ ok, warn, label, detail }) {
  const state = ok ? 'on' : warn ? 'warn' : 'off';
  return (
    <div className="check">
      <span className={`dot ${state}`} />
      <div>
        <div className="check-label">{label}</div>
        <div className="hint">{detail}</div>
      </div>
    </div>
  );
}

export default function Diagnostics({ tracking, bridge, actions }) {
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
    <div className="diag">
      <section className="panel">
        <h2>Connection checks</h2>
        <Check
          ok={bridge.online}
          label="Bridge"
          detail={bridge.online ? 'Running on this PC' : 'Start read_bridge.js'}
        />
        <Check
          ok={bridge.connected}
          label="ESP32 serial link"
          detail={bridge.port ? `${bridge.port} at 115200 baud` : '—'}
        />
        <Check
          ok={streaming}
          warn={bridge.connected && !streaming}
          label="Tracking stream"
          detail={`${tracking.rate} Hz, last frame ${tracking.staleMs} ms ago`}
        />
        <Check
          ok={badChecksum === 0}
          label="Frame checksums"
          detail={`${badChecksum} bad frames`}
        />
        <Check
          ok={bridge.sent > 0 && udpErrors === 0}
          warn={udpErrors > 0}
          label="OpenTrack output"
          detail={`${bridge.sent ?? 0} packets sent, ${udpErrors} errors`}
        />
      </section>

      <section className="panel">
        <h2>Sensor</h2>
        <dl>
          <dt>Gyro bias gx</dt><dd>{bias ? `${bias.gx.toFixed(2)} dps` : '—'}</dd>
          <dt>Gyro bias gy</dt><dd>{bias ? `${bias.gy.toFixed(2)} dps` : '—'}</dd>
          <dt>Gyro bias gz</dt><dd>{bias ? `${bias.gz.toFixed(2)} dps` : '—'}</dd>
          <dt>Chip temperature</dt>
          <dd>{bias && bias.tempC != null ? `${bias.tempC.toFixed(1)} °C` : '—'}</dd>
        </dl>
        <p className="hint mono">{bridge.lastDeviceLine || 'No device messages yet'}</p>
        <button className="primary" onClick={onCalibrate} disabled={!bridge.connected}>
          Calibrate sensor
        </button>
        <p className="hint">
          Keep the glasses still on the desk for 10 seconds. The view re-centers afterward, so
          look straight ahead when calibration finishes.
        </p>
      </section>

      <section className="panel">
        <h2>OpenTrack</h2>
        <p className="hint">
          The bridge sends packets to OpenTrack on UDP port 4242. This page confirms that packets
          are sent without errors. It cannot confirm that OpenTrack reads them, so check OpenTrack's
          own window: Raw tracker data should move when you move your head.
        </p>
        <ol className="steps">
          <li>Input: UDP over network</li>
          <li>Output: freetrack 2.0 Enhanced</li>
          <li>Tracking started (Start button)</li>
        </ol>
      </section>
    </div>
  );
}

