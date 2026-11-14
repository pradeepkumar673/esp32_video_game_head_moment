const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const PORT_PATH = process.argv[2] || 'COM6';
const RUN_SECONDS = 30;

let frames = 0, badChecksum = 0, malformed = 0, dropped = 0;
let lastSeq = null, lastI2CErrors = 0;
let secFrames = 0;
const startTime = Date.now();

function checkFrame(line) {
    const star = line.lastIndexOf('*');
    const body = line.slice(1, star);
    let cs = 0;
    for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
    const given = parseInt(line.slice(star + 1).trim(), 16);
    return { body, valid: cs === given };
}

const port = new SerialPort({ path: PORT_PATH, baudRate: 115200 });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

port.on('error', (err) => {
    console.error('Serial error:', err.message);
    process.exit(1);
});

port.on('open', () => {
    console.log(`Connected to ${PORT_PATH}. Listening for ${RUN_SECONDS} seconds...`);
    console.log('Move your head and watch the values. Press Ctrl+C to stop early.\n');
});

parser.on('data', (raw) => {
    const line = raw.trim();

    if (line.startsWith('#')) {
        console.log(line);
        return;
    }
    if (!line.startsWith('$') || line.indexOf('*') < 0) {
        malformed++;
        return;
    }

    const { body, valid } = checkFrame(line);
    if (!valid) {
        badChecksum++;
        return;
    }

    const fields = body.split(',');
    if (fields.length !== 6 || fields[0] !== 'HT') {
        malformed++;
        return;
    }

    const seq = parseInt(fields[1], 10);
    const yaw = parseFloat(fields[2]);
    const pitch = parseFloat(fields[3]);
    const roll = parseFloat(fields[4]);
    lastI2CErrors = parseInt(fields[5], 10);

    if (lastSeq !== null && seq > lastSeq + 1) {
        dropped += seq - lastSeq - 1;
    }
    lastSeq = seq;
    frames++;
    secFrames++;

    if (frames % 50 === 0) {
        console.log(
            `seq=${String(seq).padStart(6)}  yaw=${yaw.toFixed(1).padStart(7)}  ` +
            `pitch=${pitch.toFixed(1).padStart(7)}  roll=${roll.toFixed(1).padStart(7)}  ` +
            `rate=${secFrames}/s`
        );
        secFrames = 0;
    }
});

setTimeout(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    console.log('\n===== STAGE 3 LINK TEST =====');
    console.log(`elapsed_s=${elapsed.toFixed(1)}`);
    console.log(`frames=${frames}`);
    console.log(`avg_rate_hz=${(frames / elapsed).toFixed(1)}`);
    console.log(`dropped=${dropped}`);
    console.log(`bad_checksum=${badChecksum}`);
    console.log(`malformed=${malformed}`);
    console.log(`last_i2c_errors=${lastI2CErrors}`);
    console.log('=============================');
    process.exit(0);
}, RUN_SECONDS * 1000);