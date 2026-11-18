/**
 * Liar's Bar 2D (Online Web Version) — Full-Stack HTTP + REST API Server
 * Zero external dependencies. Serves:
 * - Static frontend assets from /public
 * - Shared ES module engine from /engine/* -> /src/engine/*
 * - JSON REST API:
 *   - GET  /api/health
 *   - GET  /api/rooms
 *   - POST /api/match/new
 *   - GET  /api/match/state
 *   - POST /api/match/action
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WIN_MODES,
  PHASES,
  createMatchState,
  startNewRound,
  playCards,
  callLiar,
  passFinalChallenge,
  pullTrigger,
  addQuickChat,
  getPublicState
} from './src/engine/gameEngine.js';
import { chooseAIAction } from './src/engine/aiBot.js';
import { GameDatabase } from './src/db/database.js';
import { attachWebSocketServer } from './src/server/wsServer.js';
import { RoomManager } from './src/server/roomManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENGINE_DIR = path.join(__dirname, 'src', 'engine');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// Legacy single-player REST match store (for backward-compatible API tests)
const roomsStore = new Map();
let activeRoomId = null;

function sendJSON(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 16384) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
        reject(new Error('Payload vượt quá giới hạn 16KB.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON không hợp lệ.'));
      }
    });
    req.on('error', reject);
  });
}

function serveSafeFile(res, baseDir, relativeTarget) {
  const safeRel = path.normalize(relativeTarget).replace(/^(\.\.(\/|\\|$))+/, '');
  const absPath = path.join(baseDir, safeRel);
  if (!absPath.startsWith(baseDir)) {
    sendJSON(res, 403, { ok: false, error: 'Forbidden path' });
    return;
  }

  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      sendJSON(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(absPath).pipe(res);
  });
}

export function createAppServer(options = {}) {
  const db = new GameDatabase(options.dbPath);
  const roomManager = new RoomManager(db, {
    turnTimeSeconds: options.turnTimeSeconds ?? 60,
    disconnectGraceMs: options.disconnectGraceMs ?? 45000,
    botThinkMinMs: options.botThinkMinMs ?? 1900,
    botThinkMaxMs: options.botThinkMaxMs ?? 2700,
    roundEndDelayMs: options.roundEndDelayMs ?? 4800
  });

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = parsedUrl.pathname;

      // 1. Healthcheck
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJSON(res, 200, {
          status: 'ok',
          game: "Liar's Bar 2D - Online Web Version",
          publicRoomsCount: roomManager.getPublicRooms().length
        });
        return;
      }

      // 2. List public rooms (Online Lobby — excludes private rooms & pre-populated bot rooms)
      if (req.method === 'GET' && pathname === '/api/rooms') {
        sendJSON(res, 200, { ok: true, rooms: roomManager.getPublicRooms() });
        return;
      }

      // 3. Create or reset a match room
      if (req.method === 'POST' && pathname === '/api/match/new') {
        const body = await readJsonBody(req);
        const roomId = String(body.roomId || `BAN-${Math.floor(100 + Math.random() * 900)}`)
          .trim()
          .toUpperCase()
          .slice(0, 16);
        const roomName = String(body.roomName || `Bàn Quán Rượu #${roomId}`).trim().slice(0, 60);
        const matchState = createMatchState({
          roomId,
          roomName,
          playerName: body.playerName || 'Bạn (Tay Chơi)',
          playerAvatar: body.playerAvatar || 'human',
          playerCount: body.playerCount || 4,
          winMode: body.winMode || WIN_MODES.EMPTY_HAND_WIN,
          includeDevil: Boolean(body.includeDevil),
          botDifficulty: body.botDifficulty || 'NORMAL',
          turnTimeSeconds: body.turnTimeSeconds || 30,
          seed: body.seed ?? Date.now()
        });

        roomsStore.set(roomId, matchState);
        activeRoomId = roomId;
        sendJSON(res, 200, {
          ok: true,
          roomId,
          state: getPublicState(matchState, 'p0')
        });
        return;
      }

      // 4. Get current match state
      if (req.method === 'GET' && pathname === '/api/match/state') {
        const requestedRoomId = (parsedUrl.searchParams.get('roomId') || activeRoomId).trim().toUpperCase();
        const matchState =
          roomsStore.get(requestedRoomId) ||
          roomsStore.get(`BAN-${requestedRoomId}`) ||
          roomsStore.get(activeRoomId);
        if (!matchState) {
          sendJSON(res, 404, { ok: false, error: 'Không tìm thấy phòng chơi.' });
          return;
        }
        activeRoomId = matchState.roomId;
        sendJSON(res, 200, {
          ok: true,
          roomId: matchState.roomId,
          state: getPublicState(matchState, 'p0')
        });
        return;
      }

      // 4b. Join room by Room Code (POST /api/match/join)
      if (req.method === 'POST' && pathname === '/api/match/join') {
        const body = await readJsonBody(req);
        const rawCode = String(body.roomCode || '').trim().toUpperCase().replace(/^#/, '');
        if (!rawCode) {
          sendJSON(res, 400, { ok: false, error: 'Vui lòng nhập mã phòng (ví dụ: BAN-101 hoặc 101).' });
          return;
        }

        let matchState =
          roomsStore.get(rawCode) ||
          roomsStore.get(`BAN-${rawCode}`);

        // Also allow matching by suffix digits
        if (!matchState) {
          for (const [key, val] of roomsStore.entries()) {
            if (key.endsWith(`-${rawCode}`) || key === rawCode) {
              matchState = val;
              break;
            }
          }
        }

        // If room code does not exist yet and createIfMissing is true (default), create that room code!
        if (!matchState) {
          const normalizedCode = rawCode.startsWith('BAN-') || rawCode.includes('-')
            ? rawCode.slice(0, 16)
            : `BAN-${rawCode.slice(0, 12)}`;
          matchState = createMatchState({
            roomId: normalizedCode,
            roomName: `Bàn Mã #${normalizedCode}`,
            playerName: body.playerName || 'Bạn (Tay Chơi)',
            playerAvatar: body.playerAvatar || 'human',
            winMode: WIN_MODES.EMPTY_HAND_WIN
          });
          roomsStore.set(normalizedCode, matchState);
        } else if (body.playerName && matchState.players[0]) {
          matchState.players[0].name = String(body.playerName).trim().slice(0, 24) || matchState.players[0].name;
          if (body.playerAvatar) {
            matchState.players[0].avatarKey = body.playerAvatar;
          }
        }

        activeRoomId = matchState.roomId;
        sendJSON(res, 200, {
          ok: true,
          roomId: matchState.roomId,
          state: getPublicState(matchState, 'p0')
        });
        return;
      }

      // 5. Execute a game action (Player move or AI step)
      if (req.method === 'POST' && pathname === '/api/match/action') {
        const body = await readJsonBody(req);
        const targetRoomId = body.roomId || activeRoomId;
        const matchState = roomsStore.get(targetRoomId);
        if (!matchState) {
          sendJSON(res, 404, { ok: false, error: 'Không tìm thấy bàn chơi.' });
          return;
        }

        const actionType = String(body.type || '').toUpperCase();
        const playerId = String(body.playerId || 'p0');
        let aiDecision = null;

        try {
          if (actionType === 'PLAY_CARDS') {
            playCards(matchState, playerId, body.cardIds, body.speechVi || '');
          } else if (actionType === 'CALL_LIAR') {
            callLiar(matchState, playerId);
          } else if (actionType === 'PASS_FINAL') {
            passFinalChallenge(matchState, playerId);
          } else if (actionType === 'PULL_TRIGGER') {
            const allowTestCheats =
              process.env.NODE_ENV === 'test' || process.env.ALLOW_TEST_CHEATS === '1';
            const targetId = body.targetPlayerId || matchState.pendingPenalty?.targetPlayerIds?.[0] || playerId;
            pullTrigger(matchState, targetId, {
              forceDodge: allowTestCheats && Boolean(body.forceDodge),
              forceFatal: allowTestCheats && Boolean(body.forceFatal)
            });
          } else if (actionType === 'NEXT_ROUND') {
            startNewRound(matchState);
          } else if (actionType === 'QUICK_CHAT') {
            addQuickChat(matchState, playerId, body.messageVi);
          } else if (actionType === 'AI_STEP') {
            // Determine which AI needs to act right now
            let actingAiId = body.aiPlayerId;
            if (!actingAiId) {
              if (matchState.phase === PHASES.ROULETTE_PENALTY) {
                actingAiId = matchState.pendingPenalty?.targetPlayerIds?.[0];
              } else {
                actingAiId = matchState.players[matchState.currentTurnIndex]?.id;
              }
            }
            aiDecision = chooseAIAction(matchState, actingAiId);
            if (aiDecision.action === 'PLAY') {
              playCards(matchState, actingAiId, aiDecision.cardIds, aiDecision.speechVi || '');
            } else if (aiDecision.action === 'CALL_LIAR') {
              callLiar(matchState, actingAiId);
            } else if (aiDecision.action === 'PASS_FINAL') {
              passFinalChallenge(matchState, actingAiId);
            } else if (aiDecision.action === 'PULL_TRIGGER') {
              pullTrigger(matchState, actingAiId);
            } else if (aiDecision.action === 'NEXT_ROUND') {
              startNewRound(matchState);
            }
          } else {
            sendJSON(res, 400, { ok: false, error: `Hành động không hợp lệ: ${actionType}` });
            return;
          }

          sendJSON(res, 200, {
            ok: true,
            roomId: matchState.roomId,
            aiDecision,
            state: getPublicState(matchState, 'p0')
          });
        } catch (actionErr) {
          sendJSON(res, 400, {
            ok: false,
            error: actionErr.message || 'Lỗi thực thi nước đi.'
          });
        }
        return;
      }

      // 6. Serve shared ES module engine files at /engine/*
      if (req.method === 'GET' && pathname.startsWith('/engine/')) {
        const relEngine = pathname.slice('/engine/'.length);
        serveSafeFile(res, ENGINE_DIR, relEngine);
        return;
      }

      // 7. Serve static files from /public
      if (req.method === 'GET') {
        const relPublic = pathname === '/' ? 'index.html' : pathname.slice(1);
        serveSafeFile(res, PUBLIC_DIR, relPublic);
        return;
      }

      sendJSON(res, 405, { ok: false, error: 'Method Not Allowed' });
    } catch (err) {
      sendJSON(res, 500, { ok: false, error: err.message || 'Internal Server Error' });
    }
  });

  const wsServer = attachWebSocketServer(server, (conn) => {
    roomManager.registerConnection(conn);
  });

  server.on('close', () => {
    wsServer.closeAll();
    roomManager.destroy();
    db.close();
  });

  server.roomManager = roomManager;
  server.db = db;

  return server;
}

// Start server directly when run as entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const server = createAppServer();
  server.listen(port, host, () => {
    console.log(`[Liar's Bar 2D - Online Web Version] Server listening on http://${host}:${port}`);
  });
}
