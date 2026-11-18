import { PixelTableRenderer } from './pixelRenderer.js';
import { PixelSoundFX } from './soundFX.js';
import { AVATAR_LIST, drawPixelAvatar, drawPixelCard } from './cardArt.js';

const TOKEN_STORAGE_KEY = 'lb_player_token';

const appState = {
  ws: null,
  player: null,
  currentView: 'LOBBY', // 'LOBBY' | 'WAITING' | 'GAME'
  rooms: [],
  waitingRoom: null,
  gameState: null,
  selectedCardIds: [],
  selectedSetupAvatar: 'human',
  selectedEditAvatar: 'human',
  lastEventSeq: 0,
  animQueue: [],
  isAnimating: false,
  timerInterval: null,
  clockOffsetMs: 0
};

const sound = new PixelSoundFX();
let renderer = null;

// =========================================================================
// DOM HELPERS & TOAST
// =========================================================================
const $ = (id) => document.getElementById(id);

function showToast(msg, isInfo = false) {
  const el = $('toastBanner');
  if (!el) return;
  el.textContent = msg;
  el.className = isInfo ? 'toast-banner info' : 'toast-banner';
  el.style.display = 'block';
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.style.display = 'none';
  }, 4200);
}

function switchView(viewName) {
  appState.currentView = viewName;
  $('viewLobby').style.display = viewName === 'LOBBY' ? 'block' : 'none';
  $('viewWaitingRoom').style.display = viewName === 'WAITING' ? 'block' : 'none';
  $('viewGame').style.display = viewName === 'GAME' ? 'grid' : 'none';

  if (viewName === 'GAME') {
    $('roomBadge').style.display = 'inline-block';
    $('roundBadge').style.display = 'inline-block';
  } else {
    $('roomBadge').style.display = 'none';
    $('roundBadge').style.display = 'none';
  }
}

// =========================================================================
// WEBSOCKET CONNECTION
// =========================================================================
function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}`;
  const ws = new WebSocket(wsUrl);
  appState.ws = ws;

  ws.addEventListener('open', () => {
    $('connStatusPill').textContent = 'ONLINE';
    $('connStatusPill').className = 'pixel-pill green';

    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (savedToken) {
      sendWS({ type: 'IDENTIFY', token: savedToken });
    } else {
      openProfileSetupModal();
    }
  });

  ws.addEventListener('close', (ev) => {
    if (ev.code === 4001 || (ev.code === 1000 && /Replaced/i.test(ev.reason || ''))) {
      $('connStatusPill').textContent = 'PHIÊN KHÁC ĐANG MỞ';
      $('connStatusPill').className = 'pixel-pill red';
      showToast('Phiên kết nối đã được mở ở tab khác. Vui lòng dùng tab mới nhất.');
      return;
    }
    $('connStatusPill').textContent = 'MẤT KẾT NỐI...';
    $('connStatusPill').className = 'pixel-pill red';
    setTimeout(connectWebSocket, 2000);
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      handleServerMessage(msg);
    } catch {
      // ignore
    }
  });
}

function sendWS(payload) {
  if (!appState.ws || appState.ws.readyState !== WebSocket.OPEN) {
    showToast('Đang kết nối lại máy chủ, vui lòng chờ...');
    return false;
  }
  appState.ws.send(JSON.stringify(payload));
  return true;
}

// =========================================================================
// SERVER MESSAGE HANDLER
// =========================================================================
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'ERROR': {
      showToast(msg.error || 'Có lỗi xảy ra.');
      if ($('viewLobby').style.display !== 'none') {
        $('findRoomError').textContent = msg.error || '';
        $('findRoomError').style.display = msg.error ? 'block' : 'none';
      }
      break;
    }

    case 'SYSTEM_NOTICE': {
      showToast(msg.message, true);
      break;
    }

    case 'REQUIRE_PROFILE': {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      openProfileSetupModal();
      break;
    }

    case 'IDENTIFIED': {
      appState.player = msg.player;
      localStorage.setItem(TOKEN_STORAGE_KEY, msg.player.token);
      $('profileSetupModal').style.display = 'none';
      updateHeaderProfile();
      appState.rooms = msg.rooms || [];
      appState.waitingRoom = null;
      appState.gameState = null;
      renderLobbyRooms();
      switchView('LOBBY');
      break;
    }

    case 'PROFILE_UPDATED': {
      appState.player = msg.player;
      updateHeaderProfile();
      showToast('Đã cập nhật hồ sơ thành công!', true);
      break;
    }

    case 'MATCH_HISTORY': {
      renderProfileHistory(msg.player, msg.history || []);
      break;
    }

    case 'LOBBY_UPDATE': {
      appState.rooms = msg.rooms || [];
      renderLobbyRooms();
      break;
    }

    case 'ROOM_JOINED':
    case 'ROOM_UPDATED': {
      appState.waitingRoom = msg.room;
      $('findRoomError').style.display = 'none';
      $('createRoomModal').style.display = 'none';
      switchView('WAITING');
      renderWaitingRoom();
      break;
    }

    case 'ROOM_LEFT': {
      appState.waitingRoom = null;
      appState.gameState = null;
      appState.rooms = msg.rooms || [];
      switchView('LOBBY');
      renderLobbyRooms();
      break;
    }

    case 'KICKED': {
      appState.waitingRoom = null;
      appState.gameState = null;
      appState.rooms = msg.rooms || [];
      switchView('LOBBY');
      renderLobbyRooms();
      showToast(msg.message || 'Bạn đã bị mời khỏi phòng.');
      break;
    }

    case 'MATCH_STARTED': {
      appState.lastEventSeq = 0;
      appState.animQueue = [];
      appState.selectedCardIds = [];
      switchView('GAME');
      applyGameState(msg.state);
      break;
    }

    case 'GAME_STATE': {
      if (appState.currentView !== 'GAME') {
        switchView('GAME');
        if (appState.lastEventSeq === 0 && msg.state?.eventSeq) {
          appState.lastEventSeq = msg.state.eventSeq;
        }
      }
      applyGameState(msg.state);
      break;
    }

    default:
      break;
  }
}

// =========================================================================
// PROFILE SETUP & HISTORY (C1)
// =========================================================================
function updateHeaderProfile() {
  if (!appState.player) return;
  $('headerPlayerName').textContent = appState.player.name;
  drawPixelAvatar($('headerAvatarCanvas'), appState.player.avatarKey);
}

function renderAvatarGrid(containerId, selectedKey, onSelect) {
  const container = $(containerId);
  container.innerHTML = '';
  for (const av of AVATAR_LIST) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `avatar-option ${av.key === selectedKey ? 'selected' : ''}`;
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    drawPixelAvatar(c, av.key);
    const lbl = document.createElement('span');
    lbl.textContent = av.label;
    btn.appendChild(c);
    btn.appendChild(lbl);
    btn.addEventListener('click', () => {
      onSelect(av.key);
      renderAvatarGrid(containerId, av.key, onSelect);
    });
    container.appendChild(btn);
  }
}

function openProfileSetupModal() {
  appState.selectedSetupAvatar = 'human';
  renderAvatarGrid('setupAvatarGrid', appState.selectedSetupAvatar, (key) => {
    appState.selectedSetupAvatar = key;
  });
  $('profileSetupModal').style.display = 'flex';
}

function openProfileHistoryModal() {
  if (!appState.player) return;
  $('editNameInput').value = appState.player.name;
  appState.selectedEditAvatar = appState.player.avatarKey;
  renderAvatarGrid('editAvatarGrid', appState.selectedEditAvatar, (key) => {
    appState.selectedEditAvatar = key;
  });
  $('profileHistoryModal').style.display = 'flex';
  sendWS({ type: 'GET_HISTORY' });
}

function renderProfileHistory(player, history) {
  if (!player) return;
  appState.player = { ...appState.player, ...player };
  updateHeaderProfile();

  const total = player.matchesPlayed || 0;
  const wins = player.wins || 0;
  const losses = player.losses || 0;
  const rate = total > 0 ? Math.round((wins / total) * 100) : 0;

  $('statTotalMatches').textContent = total;
  $('statWins').textContent = wins;
  $('statLosses').textContent = losses;
  $('statWinRate').textContent = `${rate}%`;

  const list = $('matchHistoryList');
  if (history.length === 0) {
    list.innerHTML = '<div class="empty-state">Chưa có lịch sử trận đấu nào.</div>';
    return;
  }

  list.innerHTML = history
    .map((h) => {
      const gameLabel = h.gameType === 'POKER_LIAR_BAR' ? 'Poker Liar Bar' : "Liar's Deck";
      const badgeCls = h.result === 'WIN' ? 'green' : 'red';
      const resultVi = h.result === 'WIN' ? 'THẮNG' : 'THUA';
      const timeStr = new Date(h.createdAt).toLocaleString('vi-VN');
      return `
        <div class="history-item">
          <div>
            <strong>${escapeHtml(h.roomName)}</strong>
            <span style="color:#b89f83;font-size:11px;"> • ${gameLabel} • ${timeStr}</span>
          </div>
          <span class="pixel-pill ${badgeCls}">${resultVi}</span>
        </div>
      `;
    })
    .join('');
}

// =========================================================================
// LOBBY & WAITING ROOM (C2, C3, C4)
// =========================================================================
function renderLobbyRooms() {
  const listEl = $('publicRoomsList');
  const loadingEl = $('lobbyLoadingState');
  if (loadingEl) loadingEl.style.display = 'none';
  const rooms = appState.rooms || [];
  $('publicRoomsCount').textContent = `${rooms.length} phòng`;

  if (rooms.length === 0) {
    listEl.innerHTML =
      '<div class="empty-state">Hiện chưa có phòng công khai nào. Hãy bấm <strong>+ TẠO PHÒNG MỚI</strong> để mở bàn!</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const r of rooms) {
    const card = document.createElement('div');
    card.className = 'room-card';
    const gameLabel = r.gameType === 'POKER_LIAR_BAR' ? 'Poker Liar Bar' : "Liar's Deck";
    const statusLabel = r.status === 'PLAYING' ? 'ĐANG CHƠI' : 'ĐANG CHỜ';
    const statusCls = r.status === 'PLAYING' ? 'red' : 'green';
    card.innerHTML = `
      <div class="room-card-top">
        <span class="room-card-name">${escapeHtml(r.roomName)}</span>
        <span class="pixel-pill ${statusCls}">${statusLabel}</span>
      </div>
      <div class="room-card-meta">
        <span>Chủ phòng: <strong>${escapeHtml(r.hostName)}</strong></span>
        <span>${r.playerCount}/${r.maxPlayers} người</span>
      </div>
      <div class="room-card-meta">
        <span class="pixel-pill gold">${gameLabel}</span>
        <span style="color:#f4b41b;font-weight:700;">Bấm để vào &rarr;</span>
      </div>
    `;
    card.addEventListener('click', () => {
      sendWS({ type: 'JOIN_ROOM', roomId: r.roomId });
    });
    listEl.appendChild(card);
  }
}

function renderWaitingRoom() {
  const room = appState.waitingRoom;
  if (!room) return;

  $('waitRoomTitle').textContent = room.roomName;
  $('waitGameBadge').textContent =
    room.gameType === 'POKER_LIAR_BAR' ? 'POKER LIAR BAR' : "LIAR'S DECK";
  $('waitPrivacyBadge').textContent = room.isPrivate ? 'PHÒNG PRIVATE' : 'CÔNG KHAI';
  $('waitBotBadge').style.display = room.playWithBots ? 'inline-block' : 'none';

  if (room.isPrivate && room.inviteCode) {
    $('waitInviteBox').style.display = 'flex';
    $('waitInviteCodeText').textContent = room.inviteCode;
  } else {
    $('waitInviteBox').style.display = 'none';
  }

  $('waitMemberCount').textContent = `${room.members.length}/${room.maxPlayers}`;

  const isMeHost = appState.player && room.hostId === appState.player.id;
  const grid = $('waitMembersGrid');
  grid.innerHTML = '';

  for (const m of room.members) {
    const card = document.createElement('div');
    card.className = `member-card ${m.isHost ? 'is-host' : ''}`;

    const left = document.createElement('div');
    left.className = 'member-left';
    const av = document.createElement('canvas');
    av.width = 40;
    av.height = 40;
    drawPixelAvatar(av, m.avatarKey);

    const info = document.createElement('div');
    const roleTag = m.isHost ? '[CHỦ PHÒNG]' : m.isAI ? '[BOT AI]' : 'Người chơi';
    info.innerHTML = `
      <div class="member-name">${escapeHtml(m.name)}</div>
      <div class="member-role">${roleTag}</div>
    `;

    left.appendChild(av);
    left.appendChild(info);
    card.appendChild(left);

    if (isMeHost && m.id !== appState.player.id) {
      const kickBtn = document.createElement('button');
      kickBtn.type = 'button';
      kickBtn.className = 'pixel-btn danger sm';
      kickBtn.textContent = 'KICK';
      kickBtn.addEventListener('click', () => {
        sendWS({ type: 'KICK_PLAYER', targetPlayerId: m.id });
      });
      card.appendChild(kickBtn);
    }

    grid.appendChild(card);
  }

  const startBtn = $('btnStartMatch');
  if (isMeHost) {
    startBtn.style.display = 'inline-block';
    const canStart = room.members.length >= 2;
    startBtn.disabled = !canStart;
    $('waitStartHint').textContent = canStart
      ? 'Đã đủ người! Bấm Bắt đầu để vào ván.'
      : 'Cần tối thiểu 2 người chơi (người thật hoặc bot) để bắt đầu.';
  } else {
    startBtn.style.display = 'none';
    $('waitStartHint').textContent = 'Đang chờ chủ phòng bấm Bắt đầu...';
  }
}

// =========================================================================
// IN-GAME STATE, ANIMATION QUEUE (E) & HUD (C5)
// =========================================================================
function applyGameState(state) {
  if (!state) return;
  const prevState = appState.gameState;
  appState.gameState = state;
  appState.clockOffsetMs =
    typeof state.serverNow === 'number' ? state.serverNow - Date.now() : 0;

  if (renderer) {
    renderer.setState(state);
  }

  // Enqueue animations sequentially from lastEvent
  if (state.lastEvent && state.lastEvent.seq > appState.lastEventSeq) {
    appState.lastEventSeq = state.lastEvent.seq;
    enqueueAnimationForEvent(state.lastEvent, state, prevState);
  }

  renderGameHUD(state);
}

function enqueueAnimationForEvent(ev, state) {
  if (!renderer) return;

  if (ev.type === 'DEAL_ROUND') {
    appState.animQueue.push(() =>
      renderer.playCutscene('DEAL_ROUND', ev, 4800)
    );
  } else if (ev.type === 'PLAY_CARDS') {
    appState.animQueue.push(() =>
      renderer.playCutscene('PLAY_CARDS', ev, 1800)
    );
  } else if (ev.type === 'CALL_LIAR_REVEAL') {
    appState.animQueue.push(() =>
      renderer.playCutscene('CALL_LIAR_REVEAL', ev, 4000)
    );
  } else if (ev.type === 'ROULETTE_SHOT') {
    const dur = ev.outcomeType === 'DODGE' ? 3800 : 3200;
    appState.animQueue.push(() =>
      renderer.playCutscene('ROULETTE_SHOT', ev, dur)
    );
  } else if (ev.type === 'STREET_REVEAL') {
    appState.animQueue.push(() =>
      renderer.playCutscene('STREET_REVEAL', ev, 1600)
    );
  } else if (ev.type === 'POKER_SHOWDOWN' || ev.type === 'POKER_BLUFF_REVEAL') {
    appState.animQueue.push(() =>
      renderer.playCutscene(ev.type, ev, 3600)
    );
  }

  processAnimQueue();
}

async function processAnimQueue() {
  if (appState.isAnimating) return;
  appState.isAnimating = true;
  while (appState.animQueue.length > 0) {
    const fn = appState.animQueue.shift();
    try {
      await fn();
    } catch {
      // ignore
    }
  }
  appState.isAnimating = false;
  if (appState.gameState) {
    renderGameHUD(appState.gameState);
  }
}

function renderGameHUD(state) {
  const myId = appState.player?.id;
  const me = state.players.find((p) => p.id === myId);

  $('roomBadge').textContent = state.roomName;
  $('roundBadge').textContent =
    state.gameType === 'POKER_LIAR_BAR'
      ? `VÁN ${state.roundNumber} • POKER (${state.street})`
      : `VÁN ${state.roundNumber} • BÀN ${state.tableRank}`;

  // Alive Roster + Glowing active turn ring (C5)
  const aliveCount = state.players.filter((p) => p.alive).length;
  $('aliveCountLabel').textContent = `${aliveCount}/${state.players.length}`;

  const rosterEl = $('playersRosterList');
  rosterEl.innerHTML = state.players
    .map((p) => {
      const isActive = p.id === state.currentTurnPlayerId && p.alive;
      const cls = `hud-player-row ${isActive ? 'active-turn' : ''} ${!p.alive ? 'dead' : ''}`;
      return `
        <div class="${cls}">
          <span>${p.isHost ? '[CHỦ] ' : ''}${escapeHtml(p.name)}</span>
          <span>${p.alive ? `${p.revolver?.shotsTaken || 0}/6` : '[LOẠI]'}</span>
        </div>
      `;
    })
    .join('');

  // Key Card Visual Image below Scoreboard (C5)
  const keyCanvas = $('keyCardCanvas');
  if (state.gameType === 'POKER_LIAR_BAR') {
    $('keyCardHudTitle').textContent = 'CƯỢC ĐẠN';
    keyCanvas.style.display = 'none';
    $('pokerStakeInfo').style.display = 'flex';
    $('pokerStakeVal').textContent = state.currentStake;
    $('pokerStreetVal').textContent = state.street;
  } else {
    $('keyCardHudTitle').textContent = 'LÁ BÀI KEY';
    keyCanvas.style.display = 'block';
    $('pokerStakeInfo').style.display = 'none';
    drawPixelCard(keyCanvas, { rank: state.tableRank }, { isKeyCard: true });
  }

  // Phase Banner
  if (state.phase === 'GAME_OVER') {
    $('phaseHeadline').textContent = `CHIẾN THẮNG CHUNG CUỘC: ${state.winnerName}!`;
    $('phaseSubline').textContent = 'Ván lớn đã kết thúc. Bấm Rời phòng để về Sảnh.';
  } else if (state.phase === 'ROUND_END') {
    $('phaseHeadline').textContent = 'KẾT THÚC VÁN CON — CHUẨN BỊ VÁN TIẾP THEO...';
    $('phaseSubline').textContent = 'Đang chia bài cho những người sống sót...';
  } else if (state.phase === 'ROULETTE_PENALTY') {
    const targetId =
      state.gameType === 'POKER_LIAR_BAR'
        ? state.pendingPenalty?.targetPlayerId
        : state.pendingPenalty?.targetPlayerIds?.[0];
    const targetP = state.players.find((p) => p.id === targetId);
    $('phaseHeadline').textContent = `PHẠT SÚNG LỤC: ${targetP?.name || ''}`;
    $('phaseSubline').textContent =
      targetId === myId ? 'Tới lượt bạn bóp cò Cò Quay Nga!' : 'Đang chờ đối thủ bóp cò...';
  } else {
    const turnP = state.players.find((p) => p.id === state.currentTurnPlayerId);
    $('phaseHeadline').textContent =
      turnP?.id === myId ? 'ĐẾN LƯỢT CỦA BẠN!' : `Lượt của: ${turnP?.name || '...'}`;
    $('phaseSubline').textContent =
      state.gameType === 'POKER_LIAR_BAR'
        ? `Cược hiện tại: ${state.currentStake} viên đạn • Vòng ${state.street}`
        : `Tuyên bố theo bài Key (${state.tableRank}) hoặc Bắt Liar!`;
  }

  $('pileStatusBadge').textContent =
    state.gameType === 'POKER_LIAR_BAR'
      ? `Cược: ${state.currentStake} đạn`
      : `Tụ bài: ${state.pileCount || 0} lá`;

  // Render 2D Pixel Hand Cards
  const handContainer = $('handCardsContainer');
  handContainer.innerHTML = '';
  const myHand = me?.hand || [];
  $('handHeaderTitle').textContent = `[BÀI TRÊN TAY: ${myHand.length} LÁ]`;

  // Prune invalid selections
  appState.selectedCardIds = appState.selectedCardIds.filter((id) =>
    myHand.some((c) => c.id === id)
  );

  for (const card of myHand) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = appState.selectedCardIds.includes(card.id);
    btn.className = `pixel-card-btn ${isSelected ? 'selected' : ''}`;
    const c = document.createElement('canvas');
    c.width = 84;
    c.height = 116;
    drawPixelCard(c, card);
    btn.appendChild(c);

    btn.addEventListener('click', () => {
      if (state.gameType === 'POKER_LIAR_BAR') {
        appState.selectedCardIds = [card.id];
      } else {
        if (appState.selectedCardIds.includes(card.id)) {
          appState.selectedCardIds = appState.selectedCardIds.filter((x) => x !== card.id);
        } else if (appState.selectedCardIds.length < 3) {
          appState.selectedCardIds.push(card.id);
        }
      }
      sound.cardSelect();
      renderGameHUD(appState.gameState);
    });

    handContainer.appendChild(btn);
  }

  $('selectionPreviewBadge').textContent =
    appState.selectedCardIds.length > 0
      ? `Đã chọn ${appState.selectedCardIds.length} lá`
      : 'Chưa chọn lá nào';

  // Action Controls
  const isMyTurn = state.currentTurnPlayerId === myId && me?.alive;
  if (state.gameType === 'POKER_LIAR_BAR') {
    $('liarsDeckControls').style.display = 'none';
    $('pokerControls').style.display = 'flex';
    const isPenaltyMe =
      state.phase === 'ROULETTE_PENALTY' && state.pendingPenalty?.targetPlayerId === myId;
    const canAct = state.phase === 'TURN_PLAY_OR_CHALLENGE' && isMyTurn;

    const minRank = state.lastClaim ? state.lastClaim.handRank : 1;
    const sel = $('selectPokerClaim');
    Array.from(sel.options).forEach((opt) => {
      opt.disabled = Number(opt.value) < minRank;
    });
    if (Number(sel.value) < minRank) {
      sel.value = String(minRank);
    }

    $('btnPokerCheckCall').style.display = canAct ? 'inline-block' : 'none';
    $('btnPokerRaise').style.display = canAct && state.currentStake < 6 ? 'inline-block' : 'none';
    $('selectPokerClaim').style.display = canAct && state.currentStake < 6 ? 'inline-block' : 'none';
    $('btnPokerAllIn').style.display =
      canAct && state.currentStake < 6 && !me?.usedSwitchThisTurn ? 'inline-block' : 'none';
    $('btnPokerSwitch').style.display =
      canAct && (me?.switchesLeft || 0) > 0 ? 'inline-block' : 'none';
    $('btnPokerCallBluff').style.display =
      canAct && state.lastClaim && state.lastClaim.playerId !== myId ? 'inline-block' : 'none';
    $('btnPokerFold').style.display = canAct ? 'inline-block' : 'none';
    $('btnPokerPullTrigger').style.display = isPenaltyMe && !appState.isAnimating ? 'inline-block' : 'none';
  } else {
    $('liarsDeckControls').style.display = 'flex';
    $('pokerControls').style.display = 'none';

    const isPenaltyMe =
      state.phase === 'ROULETTE_PENALTY' &&
      state.pendingPenalty?.targetPlayerIds?.[0] === myId;
    const isFinal = state.phase === 'FINAL_CHALLENGE_WINDOW';
    const isTurnPhase = state.phase === 'TURN_PLAY_OR_CHALLENGE';

    $('btnPlayCards').style.display = isTurnPhase ? 'inline-block' : 'none';
    $('btnPlayCards').disabled = !isMyTurn || appState.selectedCardIds.length === 0;
    $('btnCallLiar').style.display = isTurnPhase || isFinal ? 'inline-block' : 'none';
    $('btnCallLiar').disabled =
      !isMyTurn || !state.lastPlay || state.lastPlay.playerId === myId;
    $('btnPassFinal').style.display =
      isFinal && isMyTurn && state.winMode === 'EMPTY_HAND_WIN' ? 'inline-block' : 'none';
    $('btnPullTrigger').style.display = isPenaltyMe && !appState.isAnimating ? 'inline-block' : 'none';
    $('btnClearSelection').style.display = isTurnPhase ? 'inline-block' : 'none';
  }

  // Action Log
  const logEl = $('actionLogList');
  logEl.innerHTML = (state.actionLog || [])
    .slice()
    .reverse()
    .map((entry) => `<div class="log-item">${escapeHtml(entry.messageVi)}</div>`)
    .join('');
}

function startTurnTimerLoop() {
  if (appState.timerInterval) clearInterval(appState.timerInterval);
  appState.timerInterval = setInterval(() => {
    const state = appState.gameState;
    const timerBox = $('centerTurnTimer');
    const digitsEl = $('turnTimerValue');
    if (!state || !state.turnDeadlineAt || state.phase === 'GAME_OVER' || state.phase === 'ROUND_END') {
      digitsEl.textContent = '--';
      timerBox.classList.remove('urgent');
      return;
    }
    const syncedNow = Date.now() + (appState.clockOffsetMs || 0);
    const leftMs = Math.max(0, state.turnDeadlineAt - syncedNow);
    const leftSec = Math.ceil(leftMs / 1000);
    digitsEl.textContent = String(leftSec);
    if (leftSec <= 10) {
      timerBox.classList.add('urgent');
    } else {
      timerBox.classList.remove('urgent');
    }
  }, 250);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =========================================================================
// INITIALIZATION & EVENT BINDINGS
// =========================================================================
function initApp() {
  const canvas = $('tavernCanvas');
  if (canvas) {
    renderer = new PixelTableRenderer(canvas, sound);
    renderer.startLoop();
  }

  drawPixelAvatar($('headerAvatarCanvas'), 'human');
  if (!localStorage.getItem(TOKEN_STORAGE_KEY)) {
    openProfileSetupModal();
  }

  const loadingEl = $('lobbyLoadingState');
  if (loadingEl) loadingEl.style.display = 'block';

  startTurnTimerLoop();
  connectWebSocket();

  // Profile Setup Save
  $('btnSaveSetupProfile').addEventListener('click', () => {
    const name = $('setupNameInput').value.trim();
    if (name.length < 2) {
      $('setupError').textContent = 'Tên phải có ít nhất 2 ký tự.';
      $('setupError').style.display = 'block';
      return;
    }
    $('setupError').style.display = 'none';
    sendWS({
      type: 'IDENTIFY',
      name,
      avatarKey: appState.selectedSetupAvatar
    });
  });

  // Top-right Profile & History
  $('btnProfileCorner').addEventListener('click', openProfileHistoryModal);
  $('btnCloseProfileModal').addEventListener('click', () => {
    $('profileHistoryModal').style.display = 'none';
  });
  $('btnUpdateProfile').addEventListener('click', () => {
    const name = $('editNameInput').value.trim();
    if (name.length < 2) {
      showToast('Tên phải có ít nhất 2 ký tự.');
      return;
    }
    sendWS({
      type: 'UPDATE_PROFILE',
      name,
      avatarKey: appState.selectedEditAvatar
    });
  });

  // Lobby: Find Private Room
  $('btnJoinByCode').addEventListener('click', () => {
    const code = $('inputInviteCode').value.trim().toUpperCase();
    if (!code) {
      $('findRoomError').textContent = 'Vui lòng nhập mã mời.';
      $('findRoomError').style.display = 'block';
      return;
    }
    $('findRoomError').style.display = 'none';
    sendWS({ type: 'JOIN_ROOM', inviteCode: code });
  });

  // Create Room Modal
  $('btnOpenCreateRoom').addEventListener('click', () => {
    $('createRoomModal').style.display = 'flex';
  });
  $('btnCloseCreateRoom').addEventListener('click', () => {
    $('createRoomModal').style.display = 'none';
  });
  $('btnCancelCreateRoom').addEventListener('click', () => {
    $('createRoomModal').style.display = 'none';
  });

  document.querySelectorAll('input[name="createPlayMode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      $('botOptionsGroup').style.display = e.target.value === 'BOTS' ? 'block' : 'none';
    });
  });

  $('btnSubmitCreateRoom').addEventListener('click', () => {
    const gameType = document.querySelector('input[name="createGameType"]:checked')?.value || 'LIARS_DECK';
    const roomName = $('createRoomName').value.trim();
    const isPrivate = $('createIsPrivate').checked;
    const playWithBots =
      document.querySelector('input[name="createPlayMode"]:checked')?.value === 'BOTS';
    const botCount = Number(
      document.querySelector('input[name="createBotCount"]:checked')?.value || 1
    );
    const botDifficulty = $('createBotDifficulty').value;

    sendWS({
      type: 'CREATE_ROOM',
      gameType,
      roomName,
      isPrivate,
      playWithBots,
      botCount,
      botDifficulty
    });
  });

  // Waiting Room
  $('btnCopyInvite').addEventListener('click', async () => {
    const code = $('waitInviteCodeText').textContent;
    try {
      await navigator.clipboard.writeText(code);
      showToast(`Đã sao chép mã mời: ${code}`, true);
    } catch {
      showToast(`Mã mời của bạn: ${code}`, true);
    }
  });
  $('btnLeaveWaiting').addEventListener('click', () => {
    sendWS({ type: 'LEAVE_ROOM' });
  });
  $('btnStartMatch').addEventListener('click', () => {
    sendWS({ type: 'START_MATCH' });
  });

  // Leave Mid-Match Confirmation (F)
  $('btnLeaveMatch').addEventListener('click', () => {
    const state = appState.gameState;
    if (state && state.phase !== 'GAME_OVER') {
      $('leaveConfirmModal').style.display = 'flex';
    } else {
      sendWS({ type: 'LEAVE_ROOM' });
    }
  });
  $('btnCancelLeave').addEventListener('click', () => {
    $('leaveConfirmModal').style.display = 'none';
  });
  $('btnConfirmLeave').addEventListener('click', () => {
    $('leaveConfirmModal').style.display = 'none';
    sendWS({ type: 'LEAVE_ROOM' });
  });

  // Liar's Deck Controls
  $('btnPlayCards').addEventListener('click', () => {
    if (appState.selectedCardIds.length === 0) return;
    sendWS({
      type: 'GAME_ACTION',
      action: 'PLAY_CARDS',
      cardIds: appState.selectedCardIds
    });
    appState.selectedCardIds = [];
  });
  $('btnCallLiar').addEventListener('click', () => {
    sound.callLiarSiren();
    sendWS({ type: 'GAME_ACTION', action: 'CALL_LIAR' });
  });
  $('btnPassFinal').addEventListener('click', () => {
    sendWS({ type: 'GAME_ACTION', action: 'PASS_FINAL' });
  });
  $('btnPullTrigger').addEventListener('click', () => {
    sendWS({ type: 'GAME_ACTION', action: 'PULL_TRIGGER' });
  });
  $('btnClearSelection').addEventListener('click', () => {
    appState.selectedCardIds = [];
    if (appState.gameState) renderGameHUD(appState.gameState);
  });

  // Poker Liar Bar Controls
  $('btnPokerCheckCall').addEventListener('click', () => {
    sendWS({ type: 'GAME_ACTION', action: 'CHECK_CALL' });
  });
  $('btnPokerRaise').addEventListener('click', () => {
    const claimedHandRank = Number($('selectPokerClaim').value || 1);
    sendWS({ type: 'GAME_ACTION', action: 'RAISE', claimedHandRank });
  });
  $('btnPokerAllIn').addEventListener('click', () => {
    const claimedHandRank = Number($('selectPokerClaim').value || 1);
    sendWS({ type: 'GAME_ACTION', action: 'ALL_IN', claimedHandRank });
  });
  $('btnPokerSwitch').addEventListener('click', () => {
    const cardId = appState.selectedCardIds[0];
    if (!cardId) {
      showToast('Hãy bấm chọn 1 lá bài trên tay trước khi bấm Đổi bài (Switch)!');
      return;
    }
    sendWS({ type: 'GAME_ACTION', action: 'SWITCH', cardId });
    appState.selectedCardIds = [];
  });
  $('btnPokerCallBluff').addEventListener('click', () => {
    sound.callLiarSiren();
    sendWS({ type: 'GAME_ACTION', action: 'CALL_BLUFF' });
  });
  $('btnPokerFold').addEventListener('click', () => {
    sendWS({ type: 'GAME_ACTION', action: 'FOLD' });
  });
  $('btnPokerPullTrigger').addEventListener('click', () => {
    sendWS({ type: 'GAME_ACTION', action: 'PULL_TRIGGER' });
  });

  // Quick Chat & Sidebar
  document.querySelectorAll('.chat-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      sendWS({ type: 'QUICK_CHAT', message: btn.dataset.chat });
    });
  });

  $('btnToggleSidebar').addEventListener('click', () => {
    $('viewGame').classList.toggle('drawer-closed');
  });
  $('btnCloseSidebarInner').addEventListener('click', () => {
    $('viewGame').classList.add('drawer-closed');
  });

  // Rules & Sound
  $('btnOpenRules').addEventListener('click', () => {
    $('rulesModal').style.display = 'flex';
  });
  $('btnCloseRules').addEventListener('click', () => {
    $('rulesModal').style.display = 'none';
  });
  $('btnToggleSound').addEventListener('click', () => {
    const muted = sound.toggleMute();
    $('btnToggleSound').textContent = muted ? '[SFX] TẮT' : '[SFX] BẬT';
  });

  // Keyboard shortcuts for In-Game Liar's Deck
  document.addEventListener('keydown', (e) => {
    if (appState.currentView !== 'GAME') return;
    if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const key = e.key.toUpperCase();
    if (e.code === 'Space' && !$('btnPlayCards').disabled && $('btnPlayCards').style.display !== 'none') {
      e.preventDefault();
      $('btnPlayCards').click();
    } else if (key === 'L' && !$('btnCallLiar').disabled && $('btnCallLiar').style.display !== 'none') {
      $('btnCallLiar').click();
    } else if (key === 'P' && $('btnPassFinal').style.display !== 'none') {
      $('btnPassFinal').click();
    } else if (key === 'R' && $('btnPullTrigger').style.display !== 'none') {
      $('btnPullTrigger').click();
    } else if (key === 'X' && $('btnClearSelection').style.display !== 'none') {
      $('btnClearSelection').click();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
