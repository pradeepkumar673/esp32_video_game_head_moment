const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { WebSocketServer } = require('ws');

const PORT_PATH = process.argv[2] || 'COM6';
const UDP_HOST = '127.0.0.1';
const UDP_PORT = 4242;
const WS_PORT = 8787;
const RECONNECT_MS = 2000;
const BROADCAST_MS = 50;
const STATUS_MS = 1000;

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PROFILE_DIR = path.join(__dirname, 'profiles');
fs.mkdirSync(PROFILE_DIR, { recursive: true });

const DEFAULTS = {
  autoCenter: false,
  deadZoneDeg: 5,
  centerRate: 0.2,
  stillRangeDeg: 0.5,
  yawGain: 1.0,
  pitchGain: 1.0,
  rollGain: 1.0,
};

const LIMITS = {
  deadZoneDeg: [0, 20],
  centerRate: [0, 1],
  stillRangeDeg: [0.1, 3],
  yawGain: [0.5, 3],
  pitchGain: [0.5, 3],
  rollGain: [0.5, 3],
};

let cfg = { ...DEFAULTS };
try {
  const user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg = { ...DEFAULTS, ...user };
  console.log('Loaded config.json');
} catch (e) {
  console.log('No valid config.json found, using defaults');
}
console.log('Settings:', JSON.stringify(cfg));

const udp = dgram.createSocket('udp4');
const wss = new WebSocketServer({ port: WS_PORT });

let center = null;
let history = [];
let lastRaw = null;
let out = { yaw: 0, pitch: 0, roll: 0 };
let frames = 0, sent = 0, badChecksum = 0, udpErrors = 0;
let lastFrameAt = 0;
let rate = 0, rateCount = 0;
let connected = false;
let retryPending = false;
let serial = null;
let deviceBias = null;      // { gx, gy, gz, tempC } from the ESP32
let lastDeviceLine = '';

function log(msg) { console.log(msg); }

// ---------- Settings ----------
function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function applyValues(values) {
  if (typeof values.autoCenter === 'boolean') cfg.autoCenter = values.autoCenter;
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const v = values[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      cfg[key] = Math.min(max, Math.max(min, v));
    }
  }
  saveConfig();
  broadcast({ type: 'config', cfg });
}

// ---------- Profiles ----------
function profilePath(name) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) return null;
  return path.join(PROFILE_DIR, name + '.json');
}

function listProfiles() {
  return fs.readdirSync(PROFILE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

function sendProfiles() {
  broadcast({ type: 'profiles', names: listProfiles() });
}

// ---------- WebSocket to the browser ----------
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function statusMessage() {
  return {
    type: 'status',
    connected,
    port: PORT_PATH,
    frames,
    sent,
    badChecksum,
    udpErrors,
    deviceBias,
    lastDeviceLine,
  };
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'config', cfg }));
  ws.send(JSON.stringify(statusMessage()));
  ws.send(JSON.stringify({ type: 'profiles', names: listProfiles() }));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }

    try {
      switch (msg.type) {
        case 'command':
          if (msg.name === 'recenter') recenter();
          if (msg.name === 'calibrate') calibrateDevice();
          break;

        case 'setConfig':
          applyValues(msg.values || {});
          break;

        case 'resetDefaults':
          cfg = { ...DEFAULTS };
          saveConfig();
          broadcast({ type: 'config', cfg });
          broadcast({ type: 'event', text: 'Settings reset to defaults' });
          break;

        case 'saveProfile': {
          const p = profilePath(msg.name || '');
          if (!p) {
            broadcast({ type: 'event', text: 'Profile names: letters, numbers, - and _ only' });
            break;
          }
          fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
          sendProfiles();
          broadcast({ type: 'event', text: `Saved profile "${msg.name}"` });
          break;
        }

        case 'loadProfile': {
          const p = profilePath(msg.name || '');
          if (!p || !fs.existsSync(p)) {
            broadcast({ type: 'event', text: `Profile not found: ${msg.name}` });
            break;
          }
          applyValues(JSON.parse(fs.readFileSync(p, 'utf8')));
          broadcast({ type: 'event', text: `Loaded profile "${msg.name}"` });
          break;
        }

        case 'listProfiles':
          sendProfiles();
          break;
      }
    } catch (err) {
      broadcast({ type: 'event', text: 'Command failed: ' + err.message });
    }
  });
});

setInterval(() => {
  if (!lastRaw) return;
  broadcast({
    type: 'tracking',
    yaw: out.yaw,
    pitch: out.pitch,
    roll: out.roll,
    rate,
    staleMs: Date.now() - lastFrameAt,
    connected,
  });
}, BROADCAST_MS);

setInterval(() => broadcast(statusMessage()), STATUS_MS);

// ---------- OpenTrack output ----------
function sendToOpenTrack(yaw, pitch, roll) {
  const buf = Buffer.alloc(48);
  buf.writeDoubleLE(0, 0);
  buf.writeDoubleLE(0, 8);
  buf.writeDoubleLE(0, 16);
  buf.writeDoubleLE(yaw, 24);
  buf.writeDoubleLE(pitch, 32);
  buf.writeDoubleLE(roll, 40);
  udp.send(buf, UDP_PORT, UDP_HOST, (err) => {
    if (err) {
      udpErrors++;
      log('UDP error: ' + err.message);
    }
  });
  sent++;
}

// ---------- Tracking math ----------
function isStill() {
  return ['yaw', 'pitch', 'roll'].every((k) => {
    const vals = history.map((f) => f[k]);
    return Math.max(...vals) - Math.min(...vals) <= cfg.stillRangeDeg;
  });
}

function recenter() {
  if (!lastRaw) return;
  center = { ...lastRaw };
  log('Recentered.');
  broadcast({ type: 'event', text: 'Recentered' });
}

function onFrame(raw) {
  lastRaw = raw;
  if (center === null) center = { ...raw };

  history.push(raw);
  if (history.length > 50) history.shift();
  frames++;
  rateCount++;

  if (cfg.autoCenter && frames % 50 === 0 && history.length === 50 && isStill()) {
    const dy = raw.yaw - center.yaw;
    const dp = raw.pitch - center.pitch;
    const dr = raw.roll - center.roll;
    const near =
      Math.abs(dy) < cfg.deadZoneDeg &&
      Math.abs(dp) < cfg.deadZoneDeg &&
      Math.abs(dr) < cfg.deadZoneDeg;
    if (near) {
      center.yaw += cfg.centerRate * dy;
      center.pitch += cfg.centerRate * dp;
      center.roll += cfg.centerRate * dr;
    }
  }

  out = {
    yaw: (raw.yaw - center.yaw) * cfg.yawGain,
    pitch: (raw.pitch - center.pitch) * cfg.pitchGain,
    roll: (raw.roll - center.roll) * cfg.rollGain,
  };
  sendToOpenTrack(out.yaw, out.pitch, out.roll);
  lastFrameAt = Date.now();

  if (frames % 50 === 0) {
    log(
      `out yaw=${out.yaw.toFixed(1).padStart(7)}  pitch=${out.pitch.toFixed(1).padStart(7)}  ` +
      `roll=${out.roll.toFixed(1).padStart(7)}  sent=${sent}  badChecksum=${badChecksum}`
    );
  }
}

setInterval(() => {
  rate = rateCount;
  rateCount = 0;
}, 1000);

// ---------- Device messages ----------
function parseDeviceBias(line) {
  const m = line.match(/gx=([+-]?\d+\.\d+) gy=([+-]?\d+\.\d+) gz=([+-]?\d+\.\d+)/);
  if (!m) return;
  const t = line.match(/(?:T=|temp=)([+-]?\d+\.\d+)C/);
  deviceBias = {
    gx: parseFloat(m[1]),
    gy: parseFloat(m[2]),
    gz: parseFloat(m[3]),
    tempC: t ? parseFloat(t[1]) : null,
  };
}

function calibrateDevice() {
  if (!serial || !serial.isOpen) {
    broadcast({ type: 'event', text: 'Device not connected' });
    return;
  }
  serial.write('c');
  center = null;   // re-zero on the next frame after calibration
  log('Calibration requested.');
  broadcast({ type: 'event', text: 'Calibrating. Keep the glasses still for 10 seconds.' });
}

// ---------- Frame parsing ----------
function parseFrame(line) {
  const star = line.lastIndexOf('*');
  if (star < 0) return null;
  const body = line.slice(1, star);
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  if (cs !== parseInt(line.slice(star + 1).trim(), 16)) return null;
  const f = body.split(',');
  if (f.length !== 6 || f[0] !== 'HT') return null;
  return {
    yaw: parseFloat(f[2]),
    pitch: parseFloat(f[3]),
    roll: parseFloat(f[4]),
  };
}

// ---------- Serial with automatic reconnect ----------
function scheduleReconnect() {
  if (retryPending) return;
  retryPending = true;
  setTimeout(() => {
    retryPending = false;
    openSerial();
  }, RECONNECT_MS);
}

function openSerial() {
  serial = new SerialPort({ path: PORT_PATH, baudRate: 115200, autoOpen: false });
  const parser = serial.pipe(new ReadlineParser({ delimiter: '\n' }));

  parser.on('error', (err) => {
    log('Parser error (ignored): ' + err.message);
  });

  parser.on('data', (raw) => {
    try {
      const line = raw.trim();
      if (line.startsWith('#')) {
        log(line);
        lastDeviceLine = line;
        parseDeviceBias(line);
        broadcast({ type: 'device', text: line.slice(2) });
        return;
      }
      if (!line.startsWith('$')) return;
      const d = parseFrame(line);
      if (!d) { badChecksum++; return; }
      onFrame(d);
    } catch (err) {
      log('Frame error (ignored): ' + err.message);
    }
  });

  serial.on('open', () => {
    connected = true;
    center = null;
    log(`Connected to ${PORT_PATH}. Sending to OpenTrack on UDP ${UDP_PORT}.`);
    broadcast(statusMessage());
  });

  serial.on('close', () => {
    if (connected) log('Serial disconnected. Retrying...');
    connected = false;
    broadcast(statusMessage());
    scheduleReconnect();
  });

  serial.on('error', (err) => {
    log('Serial error: ' + err.message);
  });

  serial.open((err) => {
    if (err) {
      log(`Cannot open ${PORT_PATH}: ${err.message}. Retrying...`);
      scheduleReconnect();
    }
  });
}

openSerial();

process.stdin.on('data', (chunk) => {
  if (chunk.toString().trim().toLowerCase() === 'r') recenter();
});

log(`WebSocket server on ws://localhost:${WS_PORT}`);
log("Type 'r' and press Enter to recenter. Press Ctrl+C to stop.\n");

process.on('SIGINT', () => {
  udp.close();
  if (serial && serial.isOpen) serial.close();
  wss.close();
  process.exit(0);
});
