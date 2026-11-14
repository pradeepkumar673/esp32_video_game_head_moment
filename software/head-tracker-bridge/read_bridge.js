const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const dgram = require('dgram');

const PORT_PATH = process.argv[2] || 'COM6';
const UDP_HOST = '127.0.0.1';
const UDP_PORT = 4242;   // OpenTrack's default UDP input port

const udp = dgram.createSocket('udp4');
udp.on('error', (err) => console.error('UDP error:', err.message));

const serial = new SerialPort({ path: PORT_PATH, baudRate: 115200 });
const parser = serial.pipe(new ReadlineParser({ delimiter: '\n' }));

let frames = 0, badChecksum = 0, sent = 0;

// OpenTrack UDP packet: six little-endian doubles in this order:
// X, Y, Z, Yaw, Pitch, Roll (48 bytes total)
function sendToOpenTrack(yaw, pitch, roll) {
  const buf = Buffer.alloc(48);
  buf.writeDoubleLE(0, 0);      // X
  buf.writeDoubleLE(0, 8);      // Y
  buf.writeDoubleLE(0, 16);     // Z
  buf.writeDoubleLE(yaw, 24);
  buf.writeDoubleLE(pitch, 32);
  buf.writeDoubleLE(roll, 40);
  udp.send(buf, UDP_PORT, UDP_HOST);
  sent++;
}

function parseFrame(line) {
  const star = line.lastIndexOf('*');
  const body = line.slice(1, star);
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  if (cs !== parseInt(line.slice(star + 1), 16)) return null;
  const f = body.split(',');
  if (f.length !== 6 || f[0] !== 'HT') return null;
  return {
    seq: parseInt(f[1], 10),
    yaw: parseFloat(f[2]),
    pitch: parseFloat(f[3]),
    roll: parseFloat(f[4]),
  };
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

  sendToOpenTrack(d.yaw, d.pitch, d.roll);
  frames++;

  if (frames % 50 === 0) {
    console.log(
      `seq=${String(d.seq).padStart(6)}  yaw=${d.yaw.toFixed(1).padStart(7)}  ` +
      `pitch=${d.pitch.toFixed(1).padStart(7)}  roll=${d.roll.toFixed(1).padStart(7)}  ` +
      `sent=${sent}  badChecksum=${badChecksum}`
    );
  }
});

// Typing 'r' + Enter sends the recenter command to the ESP32
process.stdin.on('data', (chunk) => {
  if (chunk.toString().trim().toLowerCase() === 'r') serial.write('r');
});

process.on('SIGINT', () => {
  udp.close();
  serial.close();
  process.exit(0);
});

