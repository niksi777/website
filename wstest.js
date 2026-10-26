const WebSocket = require('ws');
const ws = new WebSocket('wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false');
ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: 'chatrooms.36479996.v2' } }));
  console.log('Subscribed to chatroom 36479996');
});
ws.on('message', (raw) => {
  const p = JSON.parse(raw.toString());
  console.log('[event]', p.event, JSON.stringify(p).slice(0,120));
});
ws.on('error', e => console.error('WS error:', e.message));
setTimeout(() => { console.log('Done listening'); process.exit(0); }, 25000);
