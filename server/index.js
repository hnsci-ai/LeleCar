import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { CARS, TRACKS, RACE_STATES, BOT_NAMES } from '../shared/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const familyV4 = typeof net.family === 'string' ? net.family === 'IPv4' : net.family === 4;
      if (familyV4 && !net.internal) {
        addresses.push({ interface: name, address: net.address, url: `http://${net.address}:${PORT}` });
      }
    }
  }
  return addresses;
}

app.get('/api/info', (req, res) => {
  const lan = getLanAddresses();
  res.json({
    name: 'APEX HORIZON LAN Server',
    port: PORT,
    hostname: os.hostname(),
    lan,
    rooms: Array.from(rooms.values()).map(serializeRoomSummary)
  });
});

app.use(express.static(DIST_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map();
let nextClientId = 1;

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(code) {
  const room = {
    code,
    hostId: null,
    trackId: TRACKS[0].id,
    laps: 3,
    botCount: 3,
    state: RACE_STATES.LOBBY,
    countdownEndsAt: 0,
    raceStartedAt: 0,
    players: new Map(), // id -> playerObj
    bots: [],           // generated on race start
    countdownTimer: null
  };
  rooms.set(code, room);
  return room;
}

// Always keep a default LAN room available
createRoom('LAN1');

function serializeRoomSummary(room) {
  return {
    code: room.code,
    players: room.players.size,
    trackId: room.trackId,
    laps: room.laps,
    state: room.state
  };
}

function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    carId: p.carId,
    ready: p.ready,
    isHost: p.isHost,
    inRace: p.inRace,
    gridIndex: p.gridIndex,
    ping: p.ping,
    finished: p.finished,
    finishTime: p.finishTime,
    bestLap: p.bestLap,
    lap: p.lap,
    progress: p.progress
  };
}

function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    trackId: room.trackId,
    laps: room.laps,
    botCount: room.botCount,
    state: room.state,
    countdownEndsAt: room.countdownEndsAt,
    raceStartedAt: room.raceStartedAt,
    players: Array.from(room.players.values()).map(serializePlayer),
    bots: room.bots
  };
}

function broadcastRoom(room, payload, excludeId = null) {
  const msg = JSON.stringify(payload);
  for (const p of room.players.values()) {
    if (excludeId && p.id === excludeId) continue;
    if (p.ws.readyState === 1) {
      p.ws.send(msg);
    }
  }
}

function broadcastRoomListToAll() {
  const summary = Array.from(rooms.values()).map(serializeRoomSummary);
  const msg = JSON.stringify({ type: 'room_list', rooms: summary });
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function broadcastRoomUpdate(room) {
  broadcastRoom(room, { type: 'room_update', room: serializeRoom(room) });
  broadcastRoomListToAll();
}

function resetRoomToLobby(room, notifyClients = true) {
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }
  room.state = RACE_STATES.LOBBY;
  room.bots = [];
  room.countdownEndsAt = 0;
  room.raceStartedAt = 0;
  for (const p of room.players.values()) {
    p.inRace = false;
    p.finished = false;
    p.finishTime = 0;
    p.bestLap = 0;
    p.lap = 1;
    p.progress = 0;
    p.state = null;
    p.ready = p.isHost;
  }
  if (notifyClients) {
    broadcastRoom(room, { type: 'returned_lobby', room: serializeRoom(room) });
  }
  broadcastRoomListToAll();
}

function syncRoomStateFromActiveRacers(room) {
  if (room.state === RACE_STATES.LOBBY) return;
  const activeRacers = Array.from(room.players.values()).filter((p) => p.inRace);
  // If nobody is actually racing anymore (everyone exited or left), auto-reset room to LOBBY!
  if (activeRacers.length === 0) {
    resetRoomToLobby(room, false);
    broadcastRoomUpdate(room);
  }
}

function assignGridAndBots(room) {
  let idx = 0;
  for (const p of room.players.values()) {
    p.gridIndex = idx++;
    p.inRace = true;
    p.finished = false;
    p.finishTime = 0;
    p.bestLap = 0;
    p.lap = 1;
    p.progress = 0;
    p.state = null;
  }
  room.bots = [];
  const totalBots = Math.min(Math.max(0, room.botCount), Math.max(0, 8 - room.players.size));
  for (let i = 0; i < totalBots; i++) {
    const car = CARS[(idx + i) % CARS.length];
    room.bots.push({
      id: `bot-${i + 1}`,
      name: BOT_NAMES[i % BOT_NAMES.length],
      carId: car.id,
      gridIndex: idx + i,
      skill: 0.85 + ((i * 7) % 11) * 0.011
    });
  }
}

function startRaceCountdown(room) {
  // Allow starting cleanly from LOBBY or FINISHED (or if a stale race has no active racers)
  if (room.state === RACE_STATES.COUNTDOWN) return;
  if (room.state === RACE_STATES.RACING) {
    const activeRacers = Array.from(room.players.values()).filter((p) => p.inRace);
    if (activeRacers.length > 0) {
      // Force-reset and launch a fresh race for the whole party when host clicks Start Race
      if (room.countdownTimer) clearTimeout(room.countdownTimer);
    }
  }

  assignGridAndBots(room);
  room.state = RACE_STATES.COUNTDOWN;
  room.countdownEndsAt = Date.now() + 3600;
  room.raceStartedAt = 0;

  broadcastRoom(room, {
    type: 'race_countdown',
    room: serializeRoom(room),
    durationMs: 3600
  });
  broadcastRoomListToAll();

  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  room.countdownTimer = setTimeout(() => {
    if (room.state !== RACE_STATES.COUNTDOWN) return;
    room.state = RACE_STATES.RACING;
    room.raceStartedAt = Date.now();
    broadcastRoom(room, {
      type: 'race_start',
      raceStartedAt: room.raceStartedAt,
      room: serializeRoom(room)
    });
    broadcastRoomListToAll();
  }, 3600);
}

function checkAllFinished(room) {
  if (room.state !== RACE_STATES.RACING) return;
  const activeRacers = Array.from(room.players.values()).filter((p) => p.inRace);
  if (activeRacers.length === 0) {
    syncRoomStateFromActiveRacers(room);
    return;
  }
  if (activeRacers.every((p) => p.finished)) {
    room.state = RACE_STATES.FINISHED;
    broadcastRoom(room, {
      type: 'race_finished',
      room: serializeRoom(room)
    });
    broadcastRoomListToAll();
  }
}

function leaveCurrentRoom(client) {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;

  room.players.delete(client.id);
  if (room.players.size === 0) {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.code !== 'LAN1') {
      rooms.delete(room.code);
    } else {
      room.hostId = null;
      resetRoomToLobby(room, false);
    }
    broadcastRoomListToAll();
    return;
  }

  if (room.hostId === client.id) {
    const nextHost = room.players.values().next().value;
    room.hostId = nextHost.id;
    nextHost.isHost = true;
    nextHost.ready = true;
  }
  broadcastRoom(room, { type: 'player_left', playerId: client.id });
  syncRoomStateFromActiveRacers(room);
  broadcastRoomUpdate(room);
  checkAllFinished(room);
}

// Server-side WebSocket heartbeat to prune zombie/disconnected browser tabs automatically
const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 10000);

wss.on('close', () => clearInterval(heartbeatInterval));

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const clientId = `p-${nextClientId++}`;
  const client = {
    id: clientId,
    ws,
    roomCode: null,
    name: `RACER_${nextClientId}`,
    carId: CARS[0].id
  };

  ws.send(JSON.stringify({
    type: 'welcome',
    id: clientId,
    rooms: Array.from(rooms.values()).map(serializeRoomSummary)
  }));

  ws.on('message', (raw) => {
    ws.isAlive = true;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
      if (client.roomCode && typeof msg.ping === 'number') {
        const room = rooms.get(client.roomCode);
        const p = room?.players.get(client.id);
        if (p) p.ping = Math.round(msg.ping);
      }
      return;
    }

    if (msg.type === 'list_rooms') {
      ws.send(JSON.stringify({ type: 'room_list', rooms: Array.from(rooms.values()).map(serializeRoomSummary) }));
      return;
    }

    if (msg.type === 'join_room') {
      leaveCurrentRoom(client);
      const code = (msg.code || 'LAN1').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || makeRoomCode();
      let room = rooms.get(code);
      if (!room) {
        room = createRoom(code);
      }
      if (room.players.size >= 8) {
        ws.send(JSON.stringify({ type: 'error', message: '房间已满（最多 8 人）' }));
        return;
      }

      // Auto-heal stale non-lobby room if no active racers remain
      syncRoomStateFromActiveRacers(room);

      const name = String(msg.name || `RACER_${nextClientId}`).trim().slice(0, 16) || 'RACER';
      const carId = CARS.some((c) => c.id === msg.carId) ? msg.carId : CARS[0].id;
      const isHost = room.players.size === 0 || !room.hostId;
      if (isHost) room.hostId = client.id;

      const player = {
        id: client.id,
        ws,
        name,
        carId,
        ready: isHost,
        isHost,
        inRace: false,
        gridIndex: room.players.size,
        ping: 0,
        finished: false,
        finishTime: 0,
        bestLap: 0,
        lap: 1,
        progress: 0,
        state: null
      };

      room.players.set(client.id, player);
      client.roomCode = code;
      client.name = name;
      client.carId = carId;

      ws.send(JSON.stringify({ type: 'joined_room', playerId: client.id, room: serializeRoom(room) }));
      broadcastRoomUpdate(room);
      return;
    }

    if (msg.type === 'create_room') {
      leaveCurrentRoom(client);
      let code = makeRoomCode();
      while (rooms.has(code)) code = makeRoomCode();
      const room = createRoom(code);
      room.hostId = client.id;
      const name = String(msg.name || 'HOST').trim().slice(0, 16) || 'HOST';
      const carId = CARS.some((c) => c.id === msg.carId) ? msg.carId : CARS[0].id;
      const player = {
        id: client.id,
        ws,
        name,
        carId,
        ready: true,
        isHost: true,
        inRace: false,
        gridIndex: 0,
        ping: 0,
        finished: false,
        finishTime: 0,
        bestLap: 0,
        lap: 1,
        progress: 0,
        state: null
      };
      room.players.set(client.id, player);
      client.roomCode = code;
      ws.send(JSON.stringify({ type: 'joined_room', playerId: client.id, room: serializeRoom(room) }));
      broadcastRoomUpdate(room);
      return;
    }

    if (msg.type === 'leave_room') {
      leaveCurrentRoom(client);
      return;
    }

    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room) return;
    const player = room.players.get(client.id);
    if (!player) return;

    if (msg.type === 'update_player') {
      if (typeof msg.name === 'string' && msg.name.trim()) {
        player.name = msg.name.trim().slice(0, 16);
      }
      if (typeof msg.carId === 'string' && CARS.some((c) => c.id === msg.carId)) {
        player.carId = msg.carId;
      }
      if (typeof msg.ready === 'boolean') {
        player.ready = msg.ready;
      }
      broadcastRoomUpdate(room);
      return;
    }

    if (msg.type === 'update_settings') {
      if (room.hostId !== client.id) {
        ws.send(JSON.stringify({ type: 'error', message: '只有房主可以修改比赛设置' }));
        return;
      }
      if (typeof msg.trackId === 'string' && TRACKS.some((t) => t.id === msg.trackId)) {
        room.trackId = msg.trackId;
      }
      if (typeof msg.laps === 'number') {
        room.laps = Math.min(5, Math.max(1, Math.round(msg.laps)));
      }
      if (typeof msg.botCount === 'number') {
        room.botCount = Math.min(7, Math.max(0, Math.round(msg.botCount)));
      }
      broadcastRoomUpdate(room);
      return;
    }

    if (msg.type === 'start_race') {
      if (room.hostId !== client.id) {
        ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始比赛' }));
        return;
      }
      startRaceCountdown(room);
      return;
    }

    // Allow late-joining players to immediately drop into an active race!
    if (msg.type === 'join_live_race') {
      if (room.state !== RACE_STATES.RACING && room.state !== RACE_STATES.COUNTDOWN) {
        ws.send(JSON.stringify({ type: 'error', message: '当前没有进行中的比赛，请等待房主开始' }));
        return;
      }
      player.inRace = true;
      player.finished = false;
      player.lap = 1;
      player.progress = 0;
      player.gridIndex = Math.min(7, room.players.size - 1);
      broadcastRoom(room, { type: 'player_joined_live', player: serializePlayer(player), room: serializeRoom(room) }, client.id);
      ws.send(JSON.stringify({
        type: 'enter_live_race',
        room: serializeRoom(room),
        raceElapsedMs: room.raceStartedAt ? (Date.now() - room.raceStartedAt) : 0
      }));
      broadcastRoomUpdate(room);
      return;
    }

    // Player exits current race back to lobby (does not leave the room!)
    if (msg.type === 'exit_race') {
      player.inRace = false;
      player.finished = false;
      broadcastRoom(room, { type: 'player_left', playerId: client.id }, client.id);
      syncRoomStateFromActiveRacers(room);
      broadcastRoomUpdate(room);
      checkAllFinished(room);
      return;
    }

    if (msg.type === 'return_lobby') {
      if (room.hostId !== client.id) {
        // Non-host simply exits their own race back to lobby
        player.inRace = false;
        broadcastRoom(room, { type: 'player_left', playerId: client.id }, client.id);
        syncRoomStateFromActiveRacers(room);
        broadcastRoomUpdate(room);
        return;
      }
      resetRoomToLobby(room, true);
      return;
    }

    if (msg.type === 'car_state') {
      player.state = msg.state;
      if (typeof msg.state?.lap === 'number') player.lap = msg.state.lap;
      if (typeof msg.state?.progress === 'number') player.progress = msg.state.progress;
      broadcastRoom(
        room,
        {
          type: 'remote_state',
          id: client.id,
          t: Date.now(),
          state: msg.state
        },
        client.id
      );
      return;
    }

    if (msg.type === 'bot_states') {
      if (room.hostId !== client.id) return;
      broadcastRoom(
        room,
        {
          type: 'remote_bots',
          t: Date.now(),
          bots: msg.bots
        },
        client.id
      );
      return;
    }

    if (msg.type === 'collision_bump') {
      const target = room.players.get(msg.targetId);
      if (target && target.ws.readyState === 1) {
        target.ws.send(
          JSON.stringify({
            type: 'collision_bump',
            fromId: client.id,
            ix: msg.ix,
            iz: msg.iz
          })
        );
      }
      return;
    }

    if (msg.type === 'player_finished') {
      if (!player.finished) {
        player.finished = true;
        player.finishTime = msg.finishTime || (room.raceStartedAt ? (Date.now() - room.raceStartedAt) : 0);
        player.bestLap = msg.bestLap || 0;
        broadcastRoomUpdate(room);
        checkAllFinished(room);
      }
      return;
    }
  });

  ws.on('close', () => {
    leaveCurrentRoom(client);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = getLanAddresses();
  console.log('\n=================================================');
  console.log('  APEX HORIZON // 3D LAN RACING SERVER READY');
  console.log('=================================================');
  console.log(`  Local:   http://localhost:${PORT}`);
  if (lan.length > 0) {
    for (const item of lan) {
      console.log(`  LAN (${item.interface}): ${item.url}`);
    }
  } else {
    console.log('  LAN:     No external IPv4 interface detected');
  }
  console.log('=================================================\n');
});
