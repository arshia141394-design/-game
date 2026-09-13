// ============ GEOMETRY FIGHTERS SERVER ============
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// HTTP Server (برای Render)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Geometry Fighters Server is running! 🎮');
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

// ============ ROOMS ============
const rooms = {}; // { roomCode: { host: ws, guest: ws, hostId, guestId } }

// تولید کد اتاق ۶ رقمی
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون I,O,0,1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// تولید ID یونیک برای بازیکن
function generatePlayerId() {
  return 'p_' + Math.random().toString(36).substring(2, 10);
}

// ============ WebSocket Connection ============
wss.on('connection', (ws) => {
  console.log('🔌 بازیکن وصل شد');
  
  ws.playerId = generatePlayerId();
  ws.roomCode = null;
  ws.isAlive = true;
  
  ws.on('pong', () => { ws.isAlive = true; });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      handleMessage(ws, msg);
    } catch(e) {
      console.error('❌ پیام نامعتبر:', e);
    }
  });
  
  ws.on('close', () => {
    console.log('❌ بازیکن قطع شد:', ws.playerId);
    handleDisconnect(ws);
  });
  
  ws.on('error', (err) => {
    console.error('⚠️ خطا:', err);
  });
});

// ============ Handle Messages ============
function handleMessage(ws, msg) {
  switch(msg.type) {
    case 'create_room':
      createRoom(ws, msg);
      break;
    case 'join_room':
      joinRoom(ws, msg);
      break;
    case 'player_update':
      relayToOpponent(ws, {
        type: 'opponent_update',
        x: msg.x,
        y: msg.y,
        hp: msg.hp,
        facing: msg.facing,
        action: msg.action,
        animState: msg.animState
      });
      break;
    case 'player_attack':
      relayToOpponent(ws, {
        type: 'opponent_attack',
        attackType: msg.attackType,
        damage: msg.damage,
        x: msg.x,
        y: msg.y
      });
      break;
    case 'player_damage':
      relayToOpponent(ws, {
        type: 'opponent_damage',
        damage: msg.damage,
        newHp: msg.newHp
      });
      break;
    case 'game_start':
      relayToOpponent(ws, { type: 'game_start' });
      break;
    case 'player_leave':
      handleDisconnect(ws);
      break;
    case 'chat':
      relayToOpponent(ws, { type: 'chat', text: msg.text });
      break;
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', time: msg.time }));
      break;
  }
}

// ============ Room Functions ============
function createRoom(ws, msg) {
  let code;
  do {
    code = generateRoomCode();
  } while (rooms[code]);
  
  rooms[code] = {
    host: ws,
    guest: null,
    hostId: ws.playerId,
    guestId: null,
    createdAt: Date.now(),
    hostData: {
      charIndex: msg.charIndex,
      charName: msg.charName,
      mapIndex: msg.mapIndex,
      difficulty: msg.difficulty
    }
  };
  
  ws.roomCode = code;
  ws.isHost = true;
  
  ws.send(JSON.stringify({
    type: 'room_created',
    code: code,
    playerId: ws.playerId
  }));
  
  console.log(`🏠 اتاق ساخته شد: ${code}`);
}

function joinRoom(ws, msg) {
  const code = msg.code.toUpperCase();
  const room = rooms[code];
  
  if (!room) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'اتاق پیدا نشد!'
    }));
    return;
  }
  
  if (room.guest) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'اتاق پره!'
    }));
    return;
  }
  
  room.guest = ws;
  room.guestId = ws.playerId;
  room.guestData = {
    charIndex: msg.charIndex,
    charName: msg.charName
  };
  
  ws.roomCode = code;
  ws.isHost = false;
  
  // به هر دو اطلاع بده
  ws.send(JSON.stringify({
    type: 'room_joined',
    code: code,
    playerId: ws.playerId,
    hostData: room.hostData
  }));
  
  if (room.host && room.host.readyState === WebSocket.OPEN) {
    room.host.send(JSON.stringify({
      type: 'guest_joined',
      guestData: room.guestData,
      guestId: room.guestId
    }));
  }
  
  console.log(`👥 بازیکن به اتاق ${code} پیوست`);
}

function relayToOpponent(ws, msg) {
  if (!ws.roomCode) return;
  const room = rooms[ws.roomCode];
  if (!room) return;
  
  const opponent = ws.isHost ? room.guest : room.host;
  if (opponent && opponent.readyState === WebSocket.OPEN) {
    opponent.send(JSON.stringify(msg));
  }
}

function handleDisconnect(ws) {
  if (!ws.roomCode) return;
  const room = rooms[ws.roomCode];
  if (!room) return;
  
  const opponent = ws.isHost ? room.guest : room.host;
  if (opponent && opponent.readyState === WebSocket.OPEN) {
    opponent.send(JSON.stringify({
      type: 'opponent_left',
      message: 'حریفت از بازی خارج شد!'
    }));
  }
  
  delete rooms[ws.roomCode];
  console.log(`🗑 اتاق ${ws.roomCode} پاک شد`);
}

// ============ Heartbeat ============
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ============ Start Server ============
server.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
  console.log(`🌐 http://localhost:${PORT}`);
});
