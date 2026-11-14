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

const DEFAULTS = {
  autoCenter: false,
  deadZoneDeg: 5,
  centerRate: 0.2,
  stillRangeDeg: 0.5,
};

let cfg = { ...DEFAULTS };
try {
  const user = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
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
let frames = 0, sent = 0, badChecksum = 0;
let lastFrameAt = 0;
let rate = 0, rateCount = 0;
let connected = false;
let retryPending = false;
let serial = null;

function log(msg) { console.log(msg); }

// ---------- WebSocket to the browser ----------
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function statusMessage() {
  return { type: 'status', connected, port: PORT_PATH, frames, sent, badChecksum };
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'config', cfg }));
  ws.send(JSON.stringify(statusMessage()));

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (msg.type === 'command' && msg.name === 'recenter') recenter();
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
    if (err) log('UDP error: ' + err.message);
  });
  sent++;
}

// ---------- Tracking math (unchanged from the verified version) ----------
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
    yaw: raw.yaw - center.yaw,
    pitch: raw.pitch - center.pitch,
    roll: raw.roll - center.roll,
  };
  sendToOpenTrack(out.yaw, out.pitch, out.roll);
  lastFrameAt = Date.now();

  if (frames % 50 === 0) {
    log(
      `out yaw=${out.yaw.toFixed(1).padStart(7)}  pitch=${pitch.toFixed(1).padStart(7)}  ` +
      `roll=${out.roll.toFixed(1).padStart(7)}  sent=${sent}  badChecksum=${badChecksum}`
    );
  }
}

setInterval(() => {
  rate = rateCount;
  rateCount = 0;
}, 1000);

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
