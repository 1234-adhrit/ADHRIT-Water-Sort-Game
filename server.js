const http = require("http");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const ROOM_SIZE = 2;
const DEFAULT_SETTINGS = {
  colorCount: 6,
  capacity: 4,
  extraTubes: 2
};

const palette = [
  "#ff4d6d",
  "#ffd166",
  "#06d6a0",
  "#4cc9f0",
  "#b5179e",
  "#f8961e",
  "#9b5de5",
  "#00bbf9",
  "#f15bb5",
  "#70e000"
];

const rooms = new Map();

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeName(name) {
  if (!name) return "";
  return String(name).trim().slice(0, 16);
}

function sanitizeChat(text) {
  if (!text) return "";
  return String(text).trim().slice(0, 200);
}

function formatTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function normalizeSettings(settings) {
  return {
    colorCount: clamp(Number(settings.colorCount) || DEFAULT_SETTINGS.colorCount, 3, palette.length),
    capacity: clamp(Number(settings.capacity) || DEFAULT_SETTINGS.capacity, 3, 6),
    extraTubes: clamp(Number(settings.extraTubes) || DEFAULT_SETTINGS.extraTubes, 1, 4)
  };
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i += 1) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generatePuzzle(settings = DEFAULT_SETTINGS) {
  const normalized = normalizeSettings(settings);
  const { colorCount, capacity, extraTubes } = normalized;
  const colors = palette.slice(0, colorCount);
  const units = [];
  colors.forEach(color => {
    for (let i = 0; i < capacity; i += 1) {
      units.push(color);
    }
  });
  shuffle(units);
  const tubeCount = colorCount + extraTubes;
  const tubes = Array.from({ length: tubeCount }, () => []);
  let idx = 0;
  for (let t = 0; t < colorCount; t += 1) {
    for (let i = 0; i < capacity; i += 1) {
      tubes[t].push(units[idx++]);
    }
  }
  return tubes;
}

function cloneTubes(tubes) {
  return tubes.map(tube => tube.slice());
}

function canMove(tubes, from, to, capacity) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from === to) return false;
  if (!tubes[from] || !tubes[to]) return false;
  const source = tubes[from];
  const target = tubes[to];
  if (source.length === 0) return false;
  if (target.length >= capacity) return false;
  const color = source[source.length - 1];
  const targetTop = target[target.length - 1];
  if (targetTop && targetTop !== color) return false;
  return true;
}

function checkWin(tubes, capacity) {
  return tubes.every(tube => {
    if (tube.length === 0) return true;
    if (tube.length !== capacity) return false;
    return tube.every(color => color === tube[0]);
  });
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message) {
  const payload = JSON.stringify(message);
  room.players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(payload);
    }
  });
}

function playersPayload(room) {
  return room.players.map(player => ({ id: player.id, name: player.name }));
}

function broadcastPlayers(room) {
  broadcast(room, {
    type: "players",
    players: playersPayload(room),
    hostId: room.hostId
  });
}

function broadcastChat(room, payload) {
  broadcast(room, {
    type: "chat",
    name: payload.name || "System",
    text: payload.text,
    time: payload.time || formatTime(),
    playerId: payload.playerId,
    system: payload.system || false
  });
}

function listRooms() {
  const list = [];
  rooms.forEach(room => {
    list.push({
      code: room.code,
      players: room.players.length,
      capacity: ROOM_SIZE,
      status: room.state ? "playing" : "waiting"
    });
  });
  return list;
}

function broadcastState(room, status = "", statusType = "") {
  if (!room.state) return;
  broadcast(room, {
    type: "state",
    payload: {
      tubes: cloneTubes(room.state.tubes),
      initial: cloneTubes(room.state.initialTubes),
      currentTurn: room.state.currentTurn,
      players: playersPayload(room),
      hostId: room.hostId,
      capacity: room.state.capacity,
      settings: room.state.settings,
      status,
      statusType
    }
  });
}

function closeRoom(room, message) {
  broadcastChat(room, { text: message, system: true });
  broadcast(room, { type: "room-closed", message });
  room.players.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.close();
    }
  });
  rooms.delete(room.code);
}

const clientPath = path.join(__dirname, "index.html");

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    fs.readFile(clientPath, (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Unable to load client.\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found.\n");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  const client = { id: randomId(), name: "", roomCode: "" };

  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (error) {
      send(ws, { type: "error", message: "Invalid message." });
      return;
    }

    if (!msg || !msg.type) {
      send(ws, { type: "error", message: "Missing message type." });
      return;
    }

    if (msg.type === "create") {
      const name = sanitizeName(msg.name);
      if (!name) {
        send(ws, { type: "error", message: "Name is required." });
        return;
      }
      const code = generateRoomCode();
      const room = {
        code,
        hostId: client.id,
        players: [{ id: client.id, name, ws }],
        state: null
      };
      rooms.set(code, room);
      client.name = name;
      client.roomCode = code;
      send(ws, {
        type: "room",
        code,
        players: playersPayload(room),
        hostId: room.hostId,
        selfId: client.id
      });
      return;
    }

    if (msg.type === "join") {
      const name = sanitizeName(msg.name);
      const code = String(msg.code || "").trim().toUpperCase();
      if (!name) {
        send(ws, { type: "error", message: "Name is required." });
        return;
      }
      if (!code) {
        send(ws, { type: "error", message: "Room code is required." });
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        send(ws, { type: "error", message: "Room not found." });
        return;
      }
      if (room.state) {
        send(ws, { type: "error", message: "Game already started." });
        return;
      }
      if (room.players.length >= ROOM_SIZE) {
        send(ws, { type: "error", message: "Room is full." });
        return;
      }
      room.players.push({ id: client.id, name, ws });
      client.name = name;
      client.roomCode = code;
      send(ws, {
        type: "room",
        code,
        players: playersPayload(room),
        hostId: room.hostId,
        selfId: client.id
      });
      broadcastPlayers(room);
      broadcastChat(room, { text: `${name} joined the room.`, system: true });
      return;
    }

    if (msg.type === "list") {
      send(ws, { type: "rooms", rooms: listRooms(), capacity: ROOM_SIZE });
      return;
    }

    const room = rooms.get(client.roomCode);
    if (!room) {
      send(ws, { type: "error", message: "You are not in a room." });
      return;
    }

    if (msg.type === "start") {
      if (client.id !== room.hostId) {
        send(ws, { type: "error", message: "Only the host can start." });
        return;
      }
      if (room.players.length < ROOM_SIZE) {
        send(ws, { type: "error", message: "Need 2 players to start." });
        return;
      }
      const settings = normalizeSettings(msg.settings || DEFAULT_SETTINGS);
      const levelId = msg.levelId || null;
      const tubes = generatePuzzle(settings);
      room.state = {
        tubes,
        initialTubes: cloneTubes(tubes),
        currentTurn: 0,
        capacity: settings.capacity,
        settings: { ...settings, levelId }
      };
      broadcastState(room, "Multiplayer game started!");
      broadcastChat(room, { text: "Game started.", system: true });
      return;
    }

    if (msg.type === "move") {
      if (!room.state) {
        send(ws, { type: "error", message: "Game has not started." });
        return;
      }
      const playerIndex = room.players.findIndex(player => player.id === client.id);
      if (playerIndex !== room.state.currentTurn) {
        send(ws, { type: "error", message: "Not your turn." });
        return;
      }
      const from = Number(msg.from);
      const to = Number(msg.to);
      if (!canMove(room.state.tubes, from, to, room.state.capacity)) {
        send(ws, { type: "error", message: "Invalid move." });
        return;
      }
      const source = room.state.tubes[from];
      const target = room.state.tubes[to];
      const color = source.pop();
      target.push(color);
      const isWin = checkWin(room.state.tubes, room.state.capacity);
      if (isWin) {
        broadcastState(room, "Puzzle solved! Great sorting.", "good");
        return;
      }
      room.state.currentTurn = (room.state.currentTurn + 1) % room.players.length;
      broadcastState(room, "Move completed.");
      return;
    }

    if (msg.type === "restart") {
      if (client.id !== room.hostId) {
        send(ws, { type: "error", message: "Only the host can restart." });
        return;
      }
      if (!room.state) {
        send(ws, { type: "error", message: "Game has not started." });
        return;
      }
      room.state.tubes = cloneTubes(room.state.initialTubes);
      room.state.currentTurn = 0;
      broadcastState(room, "Puzzle restarted.");
      broadcastChat(room, { text: "Puzzle restarted.", system: true });
      return;
    }

    if (msg.type === "new") {
      if (client.id !== room.hostId) {
        send(ws, { type: "error", message: "Only the host can start a new puzzle." });
        return;
      }
      const settings = normalizeSettings(msg.settings || (room.state && room.state.settings) || DEFAULT_SETTINGS);
      const levelId = msg.levelId || (room.state && room.state.settings && room.state.settings.levelId) || null;
      const tubes = generatePuzzle(settings);
      room.state = {
        tubes,
        initialTubes: cloneTubes(tubes),
        currentTurn: 0,
        capacity: settings.capacity,
        settings: { ...settings, levelId }
      };
      broadcastState(room, "Fresh puzzle ready.");
      broadcastChat(room, { text: "New puzzle ready.", system: true });
      return;
    }

    if (msg.type === "chat") {
      const text = sanitizeChat(msg.text);
      if (!text) return;
      broadcastChat(room, { name: client.name, text, playerId: client.id });
      return;
    }

    if (msg.type === "typing") {
      broadcast(room, {
        type: "typing",
        playerId: client.id,
        name: client.name,
        isTyping: Boolean(msg.isTyping)
      });
      return;
    }

    if (msg.type === "leave") {
      ws.close();
      return;
    }

    send(ws, { type: "error", message: "Unknown message type." });
  });

  ws.on("close", () => {
    const room = rooms.get(client.roomCode);
    if (!room) return;

    if (client.id === room.hostId) {
      closeRoom(room, "Host left the room.");
      return;
    }

    room.players = room.players.filter(player => player.id !== client.id);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }

    room.state = null;
    broadcastChat(room, { text: `${client.name || "A player"} left the room.`, system: true });
    broadcastPlayers(room);
    broadcast(room, { type: "info", message: "Player left. Waiting for a new player." });
  });
});

server.listen(PORT, () => {
  console.log(`Water Sort server running on port ${PORT}`);
});
