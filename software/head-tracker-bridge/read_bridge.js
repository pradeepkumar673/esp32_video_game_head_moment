const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const PORT_PATH = process.argv[2] || 'COM6';
const UDP_HOST = '127.0.0.1';
const UDP_PORT = 4242;

const DEFAULTS = {
  autoCenter: true,
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
const serial = new SerialPort({ path: PORT_PATH, baudRate: 115200 });
const parser = serial.pipe(new ReadlineParser({ delimiter: '\n' }));

let center = null;     // the head position the bridge treats as "forward"
let history = [];      // last 50 frames (one second)
let lastRaw = null;
let frames = 0, sent = 0, badChecksum = 0;

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

function sendToOpenTrack(yaw, pitch, roll) {
  const buf = Buffer.alloc(48);
  buf.writeDoubleLE(0, 0);   // X
  buf.writeDoubleLE(0, 8);   // Y
  buf.writeDoubleLE(0, 16);  // Z
  buf.writeDoubleLE(yaw, 24);
  buf.writeDoubleLE(pitch, 32);
  buf.writeDoubleLE(roll, 40);
  udp.send(buf, UDP_PORT, UDP_HOST);
  sent++;
}

function isStill() {
  return ['yaw', 'pitch', 'roll'].every((k) => {
    const vals = history.map((f) => f[k]);
    return Math.max(...vals) - Math.min(...vals) <= cfg.stillRangeDeg;
  });
}

function onFrame(raw) {
  lastRaw = raw;
  if (center === null) center = { ...raw };

  history.push(raw);
  if (history.length > 50) history.shift();
  frames++;

  // Once per second: if the head is still and close to center, move center toward it
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

  const yaw = raw.yaw - center.yaw;
  const pitch = raw.pitch - center.pitch;
  const roll = raw.roll - center.roll;
  sendToOpenTrack(yaw, pitch, roll);

  if (frames % 50 === 0) {
    console.log(
      `out yaw=${yaw.toFixed(1).padStart(7)}  pitch=${pitch.toFixed(1).padStart(7)}  ` +
      `roll=${roll.toFixed(1).padStart(7)}  sent=${sent}  badChecksum=${badChecksum}`
    );
  }
}

serial.on('open', () => {
  console.log(`Connected to ${PORT_PATH}. Sending to OpenTrack on UDP ${UDP_PORT}.`);
  console.log("Type 'r' and press Enter to recenter. Press Ctrl+C to stop.\n");
});

serial.on('error', (err) => {
  console.error('Serial error:', err.message);
  process.exit(1);
});

parser.on('data', (raw) => {
  const line = raw.trim();
  if (line.startsWith('#')) {
    console.log(line);
    return;
  }
  if (!line.startsWith('$')) return;

  const d = parseFrame(line);
  if (!d) {
    badChecksum++;
    return;
  }
  onFrame(d);
});

// Typing 'r' + Enter recenters on the bridge side
process.stdin.on('data', (chunk) => {
  if (chunk.toString().trim().toLowerCase() === 'r' && lastRaw) {
    center = { ...lastRaw };
    console.log('Recentered.');
  }
});

process.on('SIGINT', () => {
  udp.close();
  serial.close();
  process.exit(0);
});
