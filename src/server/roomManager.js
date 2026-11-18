/**
 * Server-Authoritative Multiplayer Room Manager
 * Manages:
 * - Public & Private rooms (zero pre-populated bot rooms)
 * - Unique 6-char invite codes for private rooms
 * - Waiting room (join, leave, kick, host transfer, start >= 2 players)
 * - 60s server-side turn timer with auto-default action
 * - 45s disconnect grace period & seamless reconnect
 * - Bot runner with random think delay
 * - Per-viewer sanitized state (private hands never leaked)
 * - Match result recording to SQLite DB
 */

import crypto from 'node:crypto';
import {
  PHASES,
  WIN_MODES,
  createMatchState,
  startNewRound,
  playCards,
  callLiar,
  passFinalChallenge,
  pullTrigger,
  addQuickChat,
  getPublicState
} from '../engine/gameEngine.js';
import {
  createPokerMatchState,
  startNewPokerRound,
  performPokerAction,
  pullPokerTrigger,
  handlePokerPlayerForfeit,
  getPokerPublicState
} from '../engine/pokerEngine.js';
import { chooseAIAction, choosePokerAIAction } from '../engine/aiBot.js';

const BOT_POOL = [
  { name: 'Cáo Già (Foxy)', avatarKey: 'fox', persona: 'CALCULATED' },
  { name: 'Sói Độc (Wolf)', avatarKey: 'wolf', persona: 'AGGRESSIVE' },
  { name: 'Heo Ngầu (Boar)', avatarKey: 'pig', persona: 'CAUTIOUS' }
];

export class RoomManager {
  constructor(db, options = {}) {
    this.db = db;
    this.rooms = new Map();
    this.connections = new Map(); // conn.id -> { conn, player, roomId }
    this.playerSockets = new Map(); // playerId -> conn
    this.turnTimeSeconds = options.turnTimeSeconds ?? 60;
    this.disconnectGraceMs = options.disconnectGraceMs ?? 45000;
    this.botThinkMinMs = options.botThinkMinMs ?? 1200;
    this.botThinkMaxMs = options.botThinkMaxMs ?? 2500;
    this.roundEndDelayMs = options.roundEndDelayMs ?? 3500;

    this._timerInterval = setInterval(() => this._tickTurnTimers(), 500);
    this._timerInterval.unref();
  }

  destroy() {
    clearInterval(this._timerInterval);
    for (const room of this.rooms.values()) {
      this._clearRoomTimers(room);
    }
    this.rooms.clear();
  }

  _clearRoomTimers(room) {
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }
    if (room.roundEndTimer) {
      clearTimeout(room.roundEndTimer);
      room.roundEndTimer = null;
    }
    for (const t of room.graceTimers.values()) {
      clearTimeout(t);
    }
    room.graceTimers.clear();
  }

  registerConnection(conn) {
    this.connections.set(conn.id, { conn, player: null, roomId: null });
    conn.on('message', (msg) => this._handleMessage(conn, msg));
    conn.on('close', () => this._handleDisconnect(conn));
  }

  _handleMessage(conn, msg) {
    const session = this.connections.get(conn.id);
    if (!session || !msg || typeof msg !== 'object') return;

    try {
      const { type } = msg;

      if (type === 'IDENTIFY') {
        // If client only sent an unknown/stale token without a name, ask them to set up their profile!
        if (msg.token && !msg.name) {
          const existing = this.db.getPlayerByToken(msg.token);
          if (!existing) {
            conn.send({ type: 'REQUIRE_PROFILE' });
            return;
          }
        }
        const player = this.db.createOrGetPlayer({
          token: msg.token,
          name: msg.name,
          avatarKey: msg.avatarKey
        });
        session.player = player;

        // Replace old socket if reconnecting
        const oldConn = this.playerSockets.get(player.id);
        if (oldConn && oldConn.id !== conn.id) {
          const oldSess = this.connections.get(oldConn.id);
          if (oldSess) {
            oldSess.player = null;
            oldSess.roomId = null;
          }
          oldConn.close(4001, 'Replaced by new connection');
        }
        this.playerSockets.set(player.id, conn);

        conn.send({
          type: 'IDENTIFIED',
          player: {
            id: player.id,
            token: player.token,
            name: player.name,
            avatarKey: player.avatarKey,
            wins: player.wins,
            losses: player.losses,
            matchesPlayed: player.matchesPlayed
          },
          rooms: this.getPublicRooms()
        });

        // Check if player was in a room (disconnect grace reconnect)
        for (const room of this.rooms.values()) {
          const member = room.members.find((m) => m.id === player.id);
          if (member) {
            member.disconnected = false;
            session.roomId = room.roomId;
            if (room.graceTimers.has(player.id)) {
              clearTimeout(room.graceTimers.get(player.id));
              room.graceTimers.delete(player.id);
            }
            if (room.matchState) {
              const mp = room.matchState.players.find((p) => p.id === player.id);
              if (mp) mp.disconnected = false;
              this._sendGameStateToPlayer(room, player.id);
            } else {
              this._broadcastWaitingRoom(room);
            }
            this._broadcastRoomSystem(room, `${player.name} đã kết nối lại!`);
            break;
          }
        }
        return;
      }

      if (!session.player) {
        conn.send({ type: 'ERROR', error: 'Vui lòng tạo hồ sơ người chơi trước.' });
        return;
      }

      const player = session.player;

      switch (type) {
        case 'UPDATE_PROFILE': {
          const updated = this.db.updateProfile(player.token, {
            name: msg.name,
            avatarKey: msg.avatarKey
          });
          session.player = updated;
          conn.send({
            type: 'PROFILE_UPDATED',
            player: updated
          });
          if (session.roomId) {
            const room = this.rooms.get(session.roomId);
            if (room && room.status === 'WAITING') {
              const m = room.members.find((x) => x.id === player.id);
              if (m) {
                m.name = updated.name;
                m.avatarKey = updated.avatarKey;
                this._broadcastWaitingRoom(room);
                this.broadcastLobbyUpdate();
              }
            }
          }
          break;
        }

        case 'GET_HISTORY': {
          const fresh = this.db.getPlayerById(player.id);
          const history = this.db.getMatchHistory(player.id, 20);
          conn.send({ type: 'MATCH_HISTORY', player: fresh, history });
          break;
        }

        case 'LIST_ROOMS': {
          conn.send({ type: 'LOBBY_UPDATE', rooms: this.getPublicRooms() });
          break;
        }

        case 'CREATE_ROOM': {
          const room = this.createRoom(player, msg);
          session.roomId = room.roomId;
          conn.send({ type: 'ROOM_JOINED', room: this._serializeWaitingRoom(room) });
          this.broadcastLobbyUpdate();
          break;
        }

        case 'JOIN_ROOM': {
          const room = this.joinRoom(player, { roomId: msg.roomId, inviteCode: msg.inviteCode });
          session.roomId = room.roomId;
          conn.send({ type: 'ROOM_JOINED', room: this._serializeWaitingRoom(room) });
          this._broadcastWaitingRoom(room);
          this.broadcastLobbyUpdate();
          break;
        }

        case 'LEAVE_ROOM': {
          this.leaveRoom(player.id, { intentional: true });
          session.roomId = null;
          conn.send({ type: 'ROOM_LEFT', rooms: this.getPublicRooms() });
          break;
        }

        case 'KICK_PLAYER': {
          this.kickPlayer(session.roomId, player.id, msg.targetPlayerId);
          break;
        }

        case 'START_MATCH': {
          this.startMatch(session.roomId, player.id);
          break;
        }

        case 'GAME_ACTION': {
          this.handleGameAction(session.roomId, player.id, msg);
          break;
        }

        case 'QUICK_CHAT': {
          this.handleQuickChat(session.roomId, player.id, msg.message);
          break;
        }

        default:
          conn.send({ type: 'ERROR', error: `Sự kiện không hỗ trợ: ${type}` });
      }
    } catch (err) {
      conn.send({ type: 'ERROR', error: err.message || 'Lỗi xử lý yêu cầu.' });
    }
  }

  _handleDisconnect(conn) {
    const session = this.connections.get(conn.id);
    this.connections.delete(conn.id);
    if (!session || !session.player) return;

    const player = session.player;
    if (this.playerSockets.get(player.id)?.id === conn.id) {
      this.playerSockets.delete(player.id);
    }

    if (!session.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (!room) return;

    const member = room.members.find((m) => m.id === player.id);
    if (!member) return;

    if (room.status === 'WAITING') {
      // Remove immediately in waiting room
      this.leaveRoom(player.id, { intentional: false });
      return;
    }

    // In PLAYING state: keep seat for disconnectGraceMs
    member.disconnected = true;
    if (room.matchState) {
      const mp = room.matchState.players.find((p) => p.id === player.id);
      if (mp) mp.disconnected = true;
      this._broadcastGameState(room);
    }
    this._broadcastRoomSystem(
      room,
      `${player.name} mất kết nối! Giữ chỗ trong ${Math.round(this.disconnectGraceMs / 1000)} giây...`
    );

    const timer = setTimeout(() => {
      room.graceTimers.delete(player.id);
      if (member.disconnected) {
        this.leaveRoom(player.id, { intentional: false, timedOut: true });
      }
    }, this.disconnectGraceMs);
    timer.unref();
    room.graceTimers.set(player.id, timer);
  }

  getPublicRooms() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (room.isPrivate) continue;
      list.push({
        roomId: room.roomId,
        roomName: room.roomName,
        hostName: room.hostName,
        playerCount: room.members.length,
        maxPlayers: room.maxPlayers,
        gameType: room.gameType,
        status: room.status,
        playWithBots: room.playWithBots
      });
    }
    return list;
  }

  broadcastLobbyUpdate() {
    const rooms = this.getPublicRooms();
    for (const { conn, player, roomId } of this.connections.values()) {
      if (player && !roomId) {
        conn.send({ type: 'LOBBY_UPDATE', rooms });
      }
    }
  }

  _generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      code = '';
      for (let i = 0; i < 6; i += 1) {
        code += chars[crypto.randomInt(0, chars.length)];
      }
      const exists = [...this.rooms.values()].some((r) => r.inviteCode === code);
      if (!exists) return code;
    }
    return `LB${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }

  createRoom(hostPlayer, options = {}) {
    // Remove host from any previous room
    this.leaveRoom(hostPlayer.id, { intentional: true });

    const gameType = options.gameType === 'POKER_LIAR_BAR' ? 'POKER_LIAR_BAR' : 'LIARS_DECK';
    const rawName = String(options.roomName || '').replace(/[\r\n\t<>]/g, '').trim().slice(0, 40);
    const roomName = rawName || `Bàn của ${hostPlayer.name}`;
    const isPrivate = Boolean(options.isPrivate);
    const playWithBots = Boolean(options.playWithBots);
    const botCount = playWithBots ? Math.min(3, Math.max(1, Number(options.botCount) || 1)) : 0;
    const botDifficulty = ['GRADE_5', 'MATH_MASTER', 'PROFESSOR_NGAU'].includes(options.botDifficulty)
      ? options.botDifficulty
      : 'MATH_MASTER';

    const roomId = `R-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const inviteCode = isPrivate ? this._generateInviteCode() : null;
    const maxPlayers = playWithBots ? 1 + botCount : 4;

    const members = [
      {
        id: hostPlayer.id,
        name: hostPlayer.name,
        avatarKey: hostPlayer.avatarKey,
        isAI: false,
        isHost: true,
        disconnected: false
      }
    ];

    if (playWithBots) {
      for (let i = 0; i < botCount; i += 1) {
        const botTpl = BOT_POOL[i % BOT_POOL.length];
        members.push({
          id: `bot-${roomId}-${i + 1}`,
          name: botTpl.name,
          avatarKey: botTpl.avatarKey,
          persona: botTpl.persona,
          isAI: true,
          isHost: false,
          disconnected: false
        });
      }
    }

    const room = {
      roomId,
      roomName,
      gameType,
      isPrivate,
      inviteCode,
      playWithBots,
      botCount,
      botDifficulty,
      maxPlayers,
      hostId: hostPlayer.id,
      hostName: hostPlayer.name,
      status: 'WAITING', // 'WAITING' | 'PLAYING'
      members,
      matchState: null,
      turnDeadlineAt: null,
      recordedResults: false,
      recordedPlayerIds: new Set(),
      botTimer: null,
      roundEndTimer: null,
      graceTimers: new Map()
    };

    this.rooms.set(roomId, room);
    return room;
  }

  joinRoom(player, { roomId, inviteCode }) {
    let targetRoom = null;
    if (inviteCode) {
      const codeUpper = String(inviteCode).trim().toUpperCase();
      if (!codeUpper) {
        throw new Error('Vui lòng nhập mã mời để tìm phòng.');
      }
      targetRoom = [...this.rooms.values()].find((r) => r.inviteCode === codeUpper);
      if (!targetRoom) {
        throw new Error(`Không tìm thấy phòng với mã mời "${codeUpper}".`);
      }
    } else if (roomId) {
      targetRoom = this.rooms.get(roomId);
      if (!targetRoom) {
        throw new Error('Phòng không tồn tại hoặc đã bị xoá.');
      }
    } else {
      throw new Error('Thiếu thông tin phòng.');
    }

    // Already in this room?
    const existingMember = targetRoom.members.find((m) => m.id === player.id);
    if (existingMember) {
      return targetRoom;
    }

    if (targetRoom.status === 'PLAYING') {
      throw new Error('Phòng đang trong trận đấu, không thể tham gia lúc này.');
    }
    if (targetRoom.members.length >= targetRoom.maxPlayers) {
      throw new Error(`Phòng đã đầy (${targetRoom.members.length}/${targetRoom.maxPlayers} người chơi).`);
    }

    // Leave any other room first
    this.leaveRoom(player.id, { intentional: true });

    targetRoom.members.push({
      id: player.id,
      name: player.name,
      avatarKey: player.avatarKey,
      isAI: false,
      isHost: false,
      disconnected: false
    });

    return targetRoom;
  }

  leaveRoom(playerId, { intentional = true, timedOut = false } = {}) {
    for (const [roomId, room] of this.rooms.entries()) {
      const idx = room.members.findIndex((m) => m.id === playerId);
      if (idx < 0) continue;

      const leaving = room.members[idx];
      if (room.graceTimers.has(playerId)) {
        clearTimeout(room.graceTimers.get(playerId));
        room.graceTimers.delete(playerId);
      }

      // If leaving mid-match, record LOSS & forfeit in engine
      if (room.status === 'PLAYING' && room.matchState && room.matchState.phase !== PHASES.GAME_OVER) {
        const state = room.matchState;
        const mp = state.players.find((p) => p.id === playerId);
        if (mp && mp.alive) {
          mp.alive = false;
          mp.folded = true;
          mp.hand = [];
          mp.lastEmotion = 'dead';
          mp.lastSpeech = timedOut ? 'Mất kết nối quá hạn!' : 'Rời phòng giữa trận!';
          if (!room.recordedPlayerIds.has(playerId)) {
            room.recordedPlayerIds.add(playerId);
            this.db.recordMatchResult(playerId, {
              roomName: room.roomName,
              gameType: room.gameType,
              result: 'LOSS',
              placement: state.players.filter((x) => x.alive).length + 1,
              totalPlayers: state.players.length,
              roundsPlayed: state.roundNumber
            });
          }

          const aliveNow = state.players.filter((x) => x.alive);
          if (aliveNow.length === 1) {
            state.phase = PHASES.GAME_OVER;
            state.winnerId = aliveNow[0].id;
            state.winnerName = aliveNow[0].name;
            state.winnerReason = 'OPPONENT_FORFEIT';
            state.pendingPenalty = null;
            room.turnDeadlineAt = null;
            this._recordMatchWinners(room);
          } else {
            if (room.gameType === 'POKER_LIAR_BAR') {
              handlePokerPlayerForfeit(state, playerId);
            } else {
              this._handleLiarsDeckForfeit(state, playerId);
            }
            if (state.phase !== PHASES.GAME_OVER && state.phase !== PHASES.ROUND_END) {
              this._resetTurnDeadline(room);
            } else {
              room.turnDeadlineAt = null;
            }
          }
        }
      }

      room.members.splice(idx, 1);

      // Check remaining human players
      const remainingHumans = room.members.filter((m) => !m.isAI);
      if (remainingHumans.length === 0) {
        this._clearRoomTimers(room);
        this.rooms.delete(roomId);
        this.broadcastLobbyUpdate();
        return;
      }

      // Transfer host if needed
      if (room.hostId === playerId || leaving.isHost) {
        const newHost = remainingHumans[0];
        newHost.isHost = true;
        room.hostId = newHost.id;
        room.hostName = newHost.name;
        if (room.matchState) {
          const mpHost = room.matchState.players.find((p) => p.id === newHost.id);
          if (mpHost) mpHost.isHost = true;
        }
        this._broadcastRoomSystem(room, `${newHost.name} đã trở thành Chủ phòng mới.`);
      }

      if (room.status === 'WAITING') {
        this._broadcastWaitingRoom(room);
      } else {
        this._broadcastGameState(room);
        this._scheduleNextBotOrRound(room);
      }
      this.broadcastLobbyUpdate();
      return;
    }
  }

  _findNextIndex(players, fromIndex, predicate) {
    const count = players.length;
    const start = fromIndex >= 0 ? fromIndex : 0;
    for (let offset = 1; offset <= count; offset += 1) {
      const idx = (start + offset) % count;
      if (predicate(players[idx])) return idx;
    }
    return -1;
  }

  _handleLiarsDeckForfeit(state, playerId) {
    const clearPileAndEndRound = () => {
      state.lastPlay = null;
      state.pileCount = 0;
      state.centerPileCards = [];
      state.roundStarterIndex = state.players.findIndex((x) => x.alive);
      state.phase = PHASES.ROUND_END;
    };

    if (state.phase === PHASES.ROULETTE_PENALTY && state.pendingPenalty) {
      state.pendingPenalty.targetPlayerIds = state.pendingPenalty.targetPlayerIds.filter((id) => id !== playerId);
      if (state.pendingPenalty.targetPlayerIds.length === 0) {
        state.pendingPenalty = null;
        state.roundStarterIndex = state.players.findIndex((x) => x.alive);
        state.phase = PHASES.ROUND_END;
      }
      return;
    }

    const isHolder = (x) => x.alive && !x.safeForRound && x.hand.length > 0;
    const holders = state.players.filter(isHolder);

    if (state.phase === PHASES.FINAL_CHALLENGE_WINDOW) {
      if (state.lastPlay?.playerId === playerId) {
        state.lastPlay = null;
        state.pileCount = 0;
        state.centerPileCards = [];
        if (holders.length >= 2) {
          state.phase = PHASES.TURN_PLAY_OR_CHALLENGE;
          const current = state.players[state.currentTurnIndex];
          if (!current || !isHolder(current)) {
            const nextIdx = this._findNextIndex(state.players, state.currentTurnIndex, isHolder);
            if (nextIdx >= 0) state.currentTurnIndex = nextIdx;
          }
        } else {
          state.roundStarterIndex = state.players.findIndex((x) => x.alive);
          state.phase = PHASES.ROUND_END;
        }
        return;
      }

      if (state.players[state.currentTurnIndex]?.id === playerId) {
        const nextChallengerIdx = this._findNextIndex(
          state.players,
          state.currentTurnIndex,
          (x) => isHolder(x) && x.id !== state.lastPlay?.playerId
        );
        if (nextChallengerIdx >= 0) {
          state.currentTurnIndex = nextChallengerIdx;
        } else {
          clearPileAndEndRound();
        }
      }
      return;
    }

    if (state.phase === PHASES.TURN_PLAY_OR_CHALLENGE) {
      if (holders.length <= 1) {
        clearPileAndEndRound();
        return;
      }
      if (state.lastPlay?.playerId === playerId) {
        state.lastPlay = null;
        state.pileCount = 0;
        state.centerPileCards = [];
      }
      if (state.players[state.currentTurnIndex]?.id === playerId) {
        const nextIdx = this._findNextIndex(state.players, state.currentTurnIndex, isHolder);
        const fallbackIdx = state.players.findIndex((x) => x.alive);
        if (nextIdx >= 0) state.currentTurnIndex = nextIdx;
        else if (fallbackIdx >= 0) state.currentTurnIndex = fallbackIdx;
      }
    }
  }

  kickPlayer(roomId, hostId, targetPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Phòng không tồn tại.');
    if (room.hostId !== hostId) throw new Error('Chỉ chủ phòng mới có quyền kick người chơi.');
    if (room.status !== 'WAITING') throw new Error('Không thể kick khi trận đấu đã bắt đầu.');
    if (targetPlayerId === hostId) throw new Error('Không thể tự kick chính mình.');

    const idx = room.members.findIndex((m) => m.id === targetPlayerId);
    if (idx < 0) throw new Error('Người chơi không có trong phòng.');

    const [kicked] = room.members.splice(idx, 1);
    const targetConn = this.playerSockets.get(targetPlayerId);
    if (targetConn) {
      const sess = this.connections.get(targetConn.id);
      if (sess) sess.roomId = null;
      targetConn.send({
        type: 'KICKED',
        message: 'Bạn đã bị chủ phòng mời ra khỏi phòng.',
        rooms: this.getPublicRooms()
      });
    }

    this._broadcastWaitingRoom(room);
    this._broadcastRoomSystem(room, `${kicked.name} đã bị chủ phòng kick.`);
    this.broadcastLobbyUpdate();
  }

  startMatch(roomId, hostId) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Phòng không tồn tại.');
    if (room.hostId !== hostId) throw new Error('Chỉ chủ phòng mới có quyền bắt đầu game.');
    if (room.status !== 'WAITING') throw new Error('Trận đấu đã bắt đầu rồi.');
    if (room.members.length < 2) {
      throw new Error('Cần tối thiểu 2 người chơi (người thật hoặc bot) để bắt đầu.');
    }

    room.status = 'PLAYING';
    room.recordedResults = false;
    room.recordedPlayerIds = new Set();

    const matchOptions = {
      roomId: room.roomId,
      roomName: room.roomName,
      players: room.members,
      winMode: WIN_MODES.EMPTY_HAND_WIN,
      includeDevil: false,
      devilProbability: 0.30,
      botDifficulty: room.botDifficulty,
      turnTimeSeconds: this.turnTimeSeconds,
      seed: Date.now()
    };

    room.matchState =
      room.gameType === 'POKER_LIAR_BAR'
        ? createPokerMatchState(matchOptions)
        : createMatchState(matchOptions);

    this._resetTurnDeadline(room);
    this.broadcastLobbyUpdate();

    // Notify all humans with their own sanitized state + DEAL_ROUND animation trigger
    this._broadcastMatchStarted(room);
    this._scheduleNextBotOrRound(room);
  }

  handleGameAction(roomId, playerId, msg) {
    const room = this.rooms.get(roomId);
    if (!room || !room.matchState) throw new Error('Phòng chưa bắt đầu trận đấu.');
    const state = room.matchState;
    const { action } = msg;

    if (room.gameType === 'POKER_LIAR_BAR') {
      if (action === 'PULL_TRIGGER') {
        pullPokerTrigger(state, playerId);
      } else if (action === 'NEXT_ROUND') {
        if (state.phase === PHASES.ROUND_END) {
          startNewPokerRound(state);
        }
      } else {
        performPokerAction(state, playerId, msg);
      }
    } else {
      // LIARS_DECK
      if (action === 'PLAY_CARDS') {
        playCards(state, playerId, msg.cardIds, msg.speechVi);
      } else if (action === 'CALL_LIAR') {
        callLiar(state, playerId);
      } else if (action === 'PASS_FINAL') {
        passFinalChallenge(state, playerId);
      } else if (action === 'PULL_TRIGGER') {
        pullTrigger(state, playerId);
      } else if (action === 'NEXT_ROUND') {
        if (state.phase === PHASES.ROUND_END) {
          startNewRound(state);
        }
      } else {
        throw new Error(`Hành động không hợp lệ: ${action}`);
      }
    }

    this._afterStateTransition(room);
  }

  handleQuickChat(roomId, playerId, message) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.matchState) {
      addQuickChat(room.matchState, playerId, message);
      this._broadcastGameState(room);
    }
  }

  _afterStateTransition(room) {
    const state = room.matchState;
    if (state.phase === PHASES.GAME_OVER) {
      this._recordMatchWinners(room);
      room.turnDeadlineAt = null;
    } else {
      this._resetTurnDeadline(room);
    }

    this._broadcastGameState(room);
    this._scheduleNextBotOrRound(room);
  }

  _recordMatchWinners(room) {
    if (room.recordedResults || !room.matchState) return;
    room.recordedResults = true;
    const state = room.matchState;
    const total = state.players.length;
    for (const p of state.players) {
      if (p.isAI || room.recordedPlayerIds.has(p.id)) continue;
      room.recordedPlayerIds.add(p.id);
      const isWin = p.id === state.winnerId;
      this.db.recordMatchResult(p.id, {
        roomName: room.roomName,
        gameType: room.gameType,
        result: isWin ? 'WIN' : 'LOSS',
        placement: isWin ? 1 : 2,
        totalPlayers: total,
        roundsPlayed: state.roundNumber
      });
    }
  }

  _resetTurnDeadline(room) {
    room.turnDeadlineAt = Date.now() + this.turnTimeSeconds * 1000;
  }

  _tickTurnTimers() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.status !== 'PLAYING' || !room.matchState || !room.turnDeadlineAt) continue;
      const state = room.matchState;
      if (state.phase === PHASES.GAME_OVER || state.phase === PHASES.ROUND_END) continue;

      if (now >= room.turnDeadlineAt) {
        try {
          this._executeTimeoutDefault(room);
        } catch {
          this._resetTurnDeadline(room);
        }
      }
    }
  }

  _executeTimeoutDefault(room) {
    const state = room.matchState;
    if (room.gameType === 'POKER_LIAR_BAR') {
      if (state.phase === PHASES.ROULETTE_PENALTY && state.pendingPenalty?.targetPlayerId) {
        pullPokerTrigger(state, state.pendingPenalty.targetPlayerId);
      } else if (state.phase === PHASES.TURN_PLAY_OR_CHALLENGE) {
        const active = state.players[state.currentTurnIndex];
        if (active && active.alive && !active.folded) {
          performPokerAction(state, active.id, { action: 'CHECK_CALL' });
        }
      }
    } else {
      if (state.phase === PHASES.ROULETTE_PENALTY && state.pendingPenalty?.targetPlayerIds?.length) {
        pullTrigger(state, state.pendingPenalty.targetPlayerIds[0]);
      } else if (state.phase === PHASES.FINAL_CHALLENGE_WINDOW) {
        const active = state.players[state.currentTurnIndex];
        if (active) {
          if (state.winMode === WIN_MODES.CLASSIC_SURVIVAL) {
            callLiar(state, active.id);
          } else {
            passFinalChallenge(state, active.id);
          }
        }
      } else if (state.phase === PHASES.TURN_PLAY_OR_CHALLENGE) {
        const active = state.players[state.currentTurnIndex];
        if (active && active.hand.length > 0) {
          playCards(state, active.id, [active.hand[0].id], 'Hết giờ! Tự đánh 1 lá.');
        }
      }
    }
    this._afterStateTransition(room);
  }

  _scheduleNextBotOrRound(room) {
    if (room.botTimer) {
      clearTimeout(room.botTimer);
      room.botTimer = null;
    }
    if (room.roundEndTimer) {
      clearTimeout(room.roundEndTimer);
      room.roundEndTimer = null;
    }

    const state = room.matchState;
    if (!state || state.phase === PHASES.GAME_OVER) return;

    if (state.phase === PHASES.ROUND_END) {
      room.roundEndTimer = setTimeout(() => {
        if (state.phase === PHASES.ROUND_END) {
          if (room.gameType === 'POKER_LIAR_BAR') {
            startNewPokerRound(state);
          } else {
            startNewRound(state);
          }
          this._afterStateTransition(room);
        }
      }, this.roundEndDelayMs);
      room.roundEndTimer.unref();
      return;
    }

    let actorId = null;
    if (state.phase === PHASES.ROULETTE_PENALTY) {
      actorId =
        room.gameType === 'POKER_LIAR_BAR'
          ? state.pendingPenalty?.targetPlayerId
          : state.pendingPenalty?.targetPlayerIds?.[0];
    } else {
      actorId = state.players[state.currentTurnIndex]?.id;
    }

    const actor = state.players.find((p) => p.id === actorId);
    if (!actor || !actor.isAI) return;

    const baseDelay =
      this.botThinkMinMs +
      Math.floor(Math.random() * Math.max(1, this.botThinkMaxMs - this.botThinkMinMs));
    // Give clients enough time to watch CALL_LIAR_REVEAL (4s) before bot pulls the trigger,
    // and wait for the 4.8s DEAL_ROUND cutscene before Round 1/2+ bot starters act!
    let delay = state.phase === PHASES.ROULETTE_PENALTY ? Math.max(baseDelay, 4300) : baseDelay;
    if (state.lastEvent?.type === 'DEAL_ROUND') {
      delay = Math.max(delay, 5000);
    }

    room.botTimer = setTimeout(() => {
      try {
        if (room.gameType === 'POKER_LIAR_BAR') {
          const decision = choosePokerAIAction(state, actor.id);
          if (decision.action === 'PULL_TRIGGER') {
            pullPokerTrigger(state, actor.id);
          } else {
            performPokerAction(state, actor.id, decision);
          }
        } else {
          const decision = chooseAIAction(state, actor.id);
          if (decision.action === 'PULL_TRIGGER') {
            pullTrigger(state, actor.id);
          } else if (decision.action === 'PLAY') {
            playCards(state, actor.id, decision.cardIds, decision.speechVi);
          } else if (decision.action === 'CALL_LIAR') {
            callLiar(state, actor.id);
          } else if (decision.action === 'PASS_FINAL') {
            passFinalChallenge(state, actor.id);
          }
        }
        this._afterStateTransition(room);
      } catch {
        // Ignore stale bot turn
      }
    }, delay);
    room.botTimer.unref();
  }

  _serializeWaitingRoom(room) {
    return {
      roomId: room.roomId,
      roomName: room.roomName,
      gameType: room.gameType,
      isPrivate: room.isPrivate,
      inviteCode: room.isPrivate ? room.inviteCode : null,
      playWithBots: room.playWithBots,
      botDifficulty: room.botDifficulty,
      maxPlayers: room.maxPlayers,
      hostId: room.hostId,
      status: room.status,
      members: room.members.map((m) => ({
        id: m.id,
        name: m.name,
        avatarKey: m.avatarKey,
        isAI: Boolean(m.isAI),
        isHost: m.id === room.hostId,
        disconnected: Boolean(m.disconnected)
      }))
    };
  }

  _broadcastWaitingRoom(room) {
    const payload = { type: 'ROOM_UPDATED', room: this._serializeWaitingRoom(room) };
    for (const m of room.members) {
      if (m.isAI) continue;
      const conn = this.playerSockets.get(m.id);
      if (conn) conn.send(payload);
    }
  }

  _broadcastRoomSystem(room, message) {
    for (const m of room.members) {
      if (m.isAI) continue;
      const conn = this.playerSockets.get(m.id);
      if (conn) conn.send({ type: 'SYSTEM_NOTICE', message });
    }
  }

  _getSanitizedState(room, viewerId) {
    const base =
      room.gameType === 'POKER_LIAR_BAR'
        ? getPokerPublicState(room.matchState, viewerId)
        : getPublicState(room.matchState, viewerId);
    return {
      ...base,
      hostId: room.hostId,
      turnDeadlineAt: room.turnDeadlineAt,
      serverNow: Date.now()
    };
  }

  _sendGameStateToPlayer(room, playerId) {
    const conn = this.playerSockets.get(playerId);
    if (!conn) return;
    conn.send({
      type: 'GAME_STATE',
      state: this._getSanitizedState(room, playerId)
    });
  }

  _broadcastMatchStarted(room) {
    for (const m of room.members) {
      if (m.isAI) continue;
      const conn = this.playerSockets.get(m.id);
      if (conn) {
        conn.send({
          type: 'MATCH_STARTED',
          state: this._getSanitizedState(room, m.id)
        });
      }
    }
  }

  _broadcastGameState(room) {
    for (const m of room.members) {
      if (m.isAI) continue;
      this._sendGameStateToPlayer(room, m.id);
    }
  }
}
