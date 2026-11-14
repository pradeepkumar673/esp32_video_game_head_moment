const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8787');
let count = 0;
ws.on('message', (data) => {
  console.log(data.toString());
  if (++count >= 20) process.exit(0);
});
ws.on('error', (err) => console.log('Error:', err.message));

