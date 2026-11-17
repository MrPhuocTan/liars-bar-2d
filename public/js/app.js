/**
 * Liar's Bar 2D — Online Web Version Main Controller
 * Coordinates step-by-step 2D Pixel Cutscenes (Deal & Shuffle, Play Cards Zoom,
 * Challenge One-by-One Flip, Russian Roulette Spin/Shatter/Blank/1% Dodge)
 * and Multi-Round Elimination Pacing.
 */

import { PixelTableRenderer } from './pixelRenderer.js';
import { PixelSoundFX } from './soundFX.js';

const sound = new PixelSoundFX();
const canvas = document.getElementById('tavernCanvas');
const renderer = new PixelTableRenderer(canvas, sound);
renderer.startLoop();

let currentState = null;
let selectedCardIds = new Set();
let aiTimerId = null;
let autoRoundTimerId = null;
let isRequestInFlight = false;
let lastProcessedEventSeq = -1;

// DOM Elements
const roomBadge = document.getElementById('roomBadge');
const roundBadge = document.getElementById('roundBadge');
const modeBadge = document.getElementById('modeBadge');
const phaseBanner = document.getElementById('phaseBanner');
const phaseHeadline = document.getElementById('phaseHeadline');
const phaseSubline = document.getElementById('phaseSubline');
const pileStatusBadge = document.getElementById('pileStatusBadge');
const handHeaderTitle = document.getElementById('handHeaderTitle');
const selectionPreviewBadge = document.getElementById('selectionPreviewBadge');
const handCardsContainer = document.getElementById('handCardsContainer');

const btnPlayCards = document.getElementById('btnPlayCards');
const btnCallLiar = document.getElementById('btnCallLiar');
const btnPassFinal = document.getElementById('btnPassFinal');
const btnPullTrigger = document.getElementById('btnPullTrigger');
const btnNextRound = document.getElementById('btnNextRound');
const btnClearSelection = document.getElementById('btnClearSelection');

const aliveCountLabel = document.getElementById('aliveCountLabel');
const playersRosterList = document.getElementById('playersRosterList');
const actionLogContainer = document.getElementById('actionLogContainer');
const logCountBadge = document.getElementById('logCountBadge');

const lobbyModal = document.getElementById('lobbyModal');
const rulesModal = document.getElementById('rulesModal');
const publicRoomsList = document.getElementById('publicRoomsList');

async function apiRequest(url, method = 'GET', body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function clearTimers() {
  if (aiTimerId) {
    window.clearTimeout(aiTimerId);
    aiTimerId = null;
  }
  if (autoRoundTimerId) {
    window.clearTimeout(autoRoundTimerId);
    autoRoundTimerId = null;
  }
}

async function loadInitialState() {
  try {
    const res = await apiRequest('/api/match/state');
    await applyStateUpdate(res.state, true);
  } catch (err) {
    phaseHeadline.textContent = `Lỗi kết nối: ${err.message}`;
  }
}

async function applyStateUpdate(newState, isInitialLoad = false) {
  clearTimers();
  currentState = newState;
  renderer.setState(currentState);

  const humanPlayer = currentState.players.find((p) => p.id === 'p0');
  const validHandIds = new Set((humanPlayer?.hand || []).map((c) => c.id));
  for (const id of Array.from(selectedCardIds)) {
    if (!validHandIds.has(id)) {
      selectedCardIds.delete(id);
    }
  }

  renderHUD();

  // Check if a new game event occurred that requires a step-by-step 2D Pixel Cutscene
  const ev = currentState.lastEvent;
  if (ev && ev.seq !== lastProcessedEventSeq) {
    lastProcessedEventSeq = ev.seq;

    if (ev.type === 'DEAL_ROUND') {
      await renderer.playCutscene('DEAL_ROUND', ev, isInitialLoad ? 2800 : 3800);
    } else if (ev.type === 'PLAY_CARDS') {
      sound.cardPlay(ev.cardCount || 1);
      await renderer.playCutscene('PLAY_CARDS', ev, 2100);
    } else if (ev.type === 'CALL_LIAR_REVEAL') {
      sound.callLiarSiren();
      await renderer.playCutscene('CALL_LIAR_REVEAL', ev, 3800);
      // Reset the roulette stage spin timer so the 1-turn cylinder spin plays right as the stage appears!
      renderer.rouletteStageEnteredAt = performance.now();
      sound.cylinderSpin();
    } else if (ev.type === 'ROULETTE_SHOT') {
      await renderer.playCutscene('ROULETTE_SHOT', ev, 3000);
      if (currentState.phase === 'GAME_OVER') {
        sound.victoryFanfare();
      }
    }
  }

  renderHUD();
  scheduleNextPacedAction();
}

function renderHUD() {
  if (!currentState) return;

  const isCutsceneBusy = renderer.isCutscenePlaying();
  const human = currentState.players.find((p) => p.id === 'p0');
  const activePlayer = currentState.players[currentState.currentTurnIndex];
  const isHumanTurn =
    !isCutsceneBusy &&
    activePlayer?.id === 'p0' &&
    (currentState.phase === 'TURN_PLAY_OR_CHALLENGE' ||
      currentState.phase === 'FINAL_CHALLENGE_WINDOW');

  // 1. Header Badges
  roomBadge.textContent = `#${currentState.roomId} • ${currentState.roomName}`;
  roundBadge.textContent = `VÁN ${currentState.roundNumber} • KEY: BÀN ${currentState.tableRank}`;
  const aliveCount = currentState.players.filter((p) => p.alive).length;
  modeBadge.textContent = `CÒN ${aliveCount}/${currentState.players.length} SỐNG • ĐẤU ĐẾN NGƯỜI CUỐI CÙNG`;

  pileStatusBadge.textContent = `Tụ bài: ${currentState.pileCount} lá úp`;

  // 2. Phase Banner
  phaseBanner.classList.toggle(
    'urgent',
    currentState.phase === 'FINAL_CHALLENGE_WINDOW' || currentState.phase === 'ROULETTE_PENALTY'
  );

  if (currentState.phase === 'GAME_OVER') {
    phaseHeadline.textContent = `[KẾT THÚC TRẬN ĐẤU] ${currentState.winnerName} LÀ NGƯỜI SỐNG SÓT CUỐI CÙNG!`;
    phaseSubline.textContent = `Tất cả đối thủ khác đã bị loại. Bấm "CHƠI TRẬN MỚI" để bắt đầu lại từ đầu!`;
  } else if (currentState.phase === 'ROULETTE_PENALTY') {
    const nextShooterId = currentState.pendingPenalty?.targetPlayerIds?.[0];
    const shooter = currentState.players.find((p) => p.id === nextShooterId);
    const vTag = currentState.pendingPenalty?.verdictTag || 'FAKE';
    phaseHeadline.textContent = `[PHÁN QUYẾT: ${vTag}] ${shooter?.name || ''} PHẢI BẮN SÚNG LỤC!`;
    phaseSubline.textContent =
      'Ổ đạn đã quay 1 vòng! Hãy bấm nút "BẮN SÚNG!" bên dưới để xem kết quả (Trúng đạn vỡ Avatar / Đạn rỗng Tích / 1% Né đạn)!';
  } else if (currentState.phase === 'FINAL_CHALLENGE_WINDOW') {
    const emptyPlayerName = currentState.lastPlay?.playerName || 'Đối thủ';
    phaseHeadline.textContent = `[XÉT BÀI CUỐI] ${emptyPlayerName} vừa đánh hết bài trên tay!`;
    phaseSubline.textContent = isHumanTurn
      ? 'Lượt bạn quyết định: Hô "LẬT BÀI!" để xét bài, hoặc "CHO QUA" (công nhận họ thắng ván con này)!'
      : `Đang chờ ${activePlayer?.name} quyết định Lật Bài hay Cho Qua...`;
  } else if (currentState.phase === 'ROUND_END') {
    const res = currentState.lastRouletteResult;
    const aliveList = currentState.players
      .filter((p) => p.alive)
      .map((p) => p.name)
      .join(', ');
    phaseHeadline.textContent = res?.isFatal
      ? `[1 NGƯỜI ĐÃ CHẾT: ${res.playerName}] — CÒN ${aliveCount} NGƯỜI SỐNG TIẾP TỤC CHIA VÁN MỚI!`
      : res?.isMiracleDodge
      ? `[1% BẮN HỤT NGOẠN MỤC!] ${res.playerName}: "Hú hồn, né được nhé!" — Tiếp tục chia ván mới!`
      : `[TÍCH! ĐẠN RỖNG] ${res?.playerName || ''} sống sót — Tiếp tục chia ván mới!`;
    phaseSubline.textContent = `Người đã chết không được tham gia tiếp. Còn sống (${aliveCount}): ${aliveList}. Bấm "TIẾP TỤC VÁN MỚI" (hoặc tự động sau 5 giây)!`;
  } else {
    phaseHeadline.textContent = isHumanTurn
      ? `>> LƯỢT CỦA BẠN! (KEY VÁN ${currentState.roundNumber}: BÀN LÁ ${currentState.tableRank})`
      : `>> Đang là lượt của: ${activePlayer?.name || '...'}`;
    phaseSubline.textContent = currentState.lastPlay
      ? `${currentState.lastPlay.playerName} vừa đánh ${currentState.lastPlay.claimedCount} lá (Tuyên bố ${currentState.lastPlay.claimedCount} Lá ${currentState.lastPlay.claimedRank}). Bạn có thể Đánh Tiếp hoặc Hô LẬT BÀI!`
      : `Mở màn ván ${currentState.roundNumber}: Chọn 1 đến 3 lá bài trên tay và bấm ĐÁNH BÀI ÚP.`;
  }

  // 3. Render Player Hand Cards
  renderPlayerHand(human);

  // 4. Render Action Buttons visibility & disabled state
  const penaltyTargets = currentState.pendingPenalty?.targetPlayerIds || [];

  btnPlayCards.style.display =
    currentState.phase === 'TURN_PLAY_OR_CHALLENGE' ? 'inline-block' : 'none';
  btnPlayCards.disabled =
    isCutsceneBusy || !isHumanTurn || selectedCardIds.size < 1 || selectedCardIds.size > 3;

  btnCallLiar.style.display =
    currentState.phase === 'TURN_PLAY_OR_CHALLENGE' ||
    currentState.phase === 'FINAL_CHALLENGE_WINDOW'
      ? 'inline-block'
      : 'none';
  btnCallLiar.disabled =
    isCutsceneBusy ||
    !isHumanTurn ||
    !currentState.lastPlay ||
    currentState.lastPlay.playerId === 'p0';

  btnPassFinal.style.display =
    currentState.phase === 'FINAL_CHALLENGE_WINDOW' ? 'inline-block' : 'none';
  btnPassFinal.disabled = isCutsceneBusy || !isHumanTurn;

  btnPullTrigger.style.display =
    currentState.phase === 'ROULETTE_PENALTY' ? 'inline-block' : 'none';
  btnPullTrigger.disabled = isCutsceneBusy || penaltyTargets.length === 0;
  const shooterObj = currentState.players.find((p) => p.id === penaltyTargets[0]);
  btnPullTrigger.textContent =
    penaltyTargets[0] === 'p0'
      ? 'BẮN SÚNG! (TỰ BÓP CÒ) [SPACE / R]'
      : `BẮN SÚNG! (${shooterObj?.name || 'ĐỐI THỦ'} BÓP CÒ) [SPACE / R]`;

  btnNextRound.style.display =
    currentState.phase === 'ROUND_END' || currentState.phase === 'GAME_OVER'
      ? 'inline-block'
      : 'none';
  btnNextRound.disabled = isCutsceneBusy;
  btnNextRound.textContent =
    currentState.phase === 'GAME_OVER'
      ? 'CHƠI TRẬN MỚI [ENTER]'
      : 'TIẾP TỤC CHIA VÁN MỚI [ENTER / SPACE]';

  btnClearSelection.style.display =
    currentState.phase === 'TURN_PLAY_OR_CHALLENGE' ? 'inline-block' : 'none';
  btnClearSelection.disabled = isCutsceneBusy || selectedCardIds.size === 0;

  // 5. Render Top-Right Revolver HUD & Match Log
  renderSidebarRoster();
  renderActionLog();
}

function renderPlayerHand(human) {
  const hand = human?.hand || [];
  handHeaderTitle.textContent = !human?.alive
    ? '[ĐÃ CHẾT — BẠN ĐANG XEM CÁC NGƯỜI CHƠI CÒN SỐNG ĐẤU TIẾP]'
    : human?.safeForRound
    ? '[THẮNG VÁN CON — BẠN ĐÃ HẾT BÀI VÀ AN TOÀN TRONG VÁN NÀY]'
    : `[BÀI TRÊN TAY: ${hand.length} LÁ] — KEY VÁN: LÁ ${currentState.tableRank}`;

  const selectedList = hand.filter((c) => selectedCardIds.has(c.id));
  if (selectedList.length === 0) {
    selectionPreviewBadge.className = 'selection-indicator';
    selectionPreviewBadge.textContent = 'Chưa chọn lá nào (Chọn 1-3 lá)';
  } else {
    const hasDevil = selectedList.some((c) => c.rank === 'D');
    const allTruth = selectedList.every(
      (c) => c.rank === currentState.tableRank || c.rank === 'J'
    );
    if (hasDevil && selectedList.length > 1) {
      selectionPreviewBadge.className = 'selection-indicator bluff';
      selectionPreviewBadge.textContent = '[LỖI] Lá Ác Quỷ (D) chỉ được đánh lẻ 1 lá!';
    } else if (hasDevil) {
      selectionPreviewBadge.className = 'selection-indicator bluff';
      selectionPreviewBadge.textContent = `[BẪY ÁC QUỶ] Đang chọn 1 lá D -> Bẫy cả bàn!`;
    } else if (allTruth) {
      selectionPreviewBadge.className = 'selection-indicator truth';
      selectionPreviewBadge.textContent = `[REAL / THẬT] Chọn ${selectedList.length} lá -> Đúng Bàn ${currentState.tableRank}`;
    } else {
      selectionPreviewBadge.className = 'selection-indicator bluff';
      selectionPreviewBadge.textContent = `[FAKE / NÓI DỐI] Chọn ${selectedList.length} lá -> Tuyên bố ${selectedList.length} Lá ${currentState.tableRank}`;
    }
  }

  handCardsContainer.innerHTML = '';
  if (hand.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.style.color = human?.alive ? 'var(--accent-green)' : 'var(--accent-red)';
    emptyEl.style.fontWeight = '800';
    emptyEl.textContent = human?.alive
      ? '[ĐÃ HẾT BÀI TRÊN TAY — AN TOÀN TRONG VÁN CON NÀY!]'
      : '[BẠN ĐÃ TRÚNG ĐẠN BỊ LOẠI — KHÔNG ĐƯỢC CHIA BÀI Ở VÁN MỚI]';
    handCardsContainer.appendChild(emptyEl);
    return;
  }

  hand.forEach((card, idx) => {
    const isSelected = selectedCardIds.has(card.id);
    const isTruth = card.rank === currentState.tableRank || card.rank === 'J';
    const isDevil = card.rank === 'D';

    const cardBtn = document.createElement('div');
    cardBtn.className = `pixel-card rank-${card.rank}${isSelected ? ' selected' : ''}`;
    cardBtn.dataset.cardId = card.id;

    const tagClass = isDevil ? 'devil' : isTruth ? 'match' : 'lie';
    const tagText = isDevil
      ? 'ÁC QUỶ'
      : card.rank === 'J'
      ? 'JOKER (REAL)'
      : isTruth
      ? `REAL (${currentState.tableRank})`
      : `FAKE (KHÁC ${currentState.tableRank})`;

    cardBtn.innerHTML = `
      <div class="card-top-row">
        <span>${card.rank}</span>
        <span class="card-key-hint">[${idx + 1}]</span>
      </div>
      <div class="card-center-rank">${card.rank}</div>
      <div class="card-bottom-tag ${tagClass}">${tagText}</div>
    `;

    cardBtn.addEventListener('click', () => {
      toggleCardSelection(card.id);
    });

    handCardsContainer.appendChild(cardBtn);
  });
}

function toggleCardSelection(cardId) {
  if (
    !currentState ||
    renderer.isCutscenePlaying() ||
    currentState.phase !== 'TURN_PLAY_OR_CHALLENGE'
  ) {
    return;
  }
  if (selectedCardIds.has(cardId)) {
    selectedCardIds.delete(cardId);
    sound.cardSelect();
  } else {
    if (selectedCardIds.size >= 3) {
      const firstId = selectedCardIds.values().next().value;
      selectedCardIds.delete(firstId);
    }
    selectedCardIds.add(cardId);
    sound.cardSelect();
  }
  renderHUD();
}

function renderSidebarRoster() {
  const aliveCount = currentState.players.filter((p) => p.alive).length;
  aliveCountLabel.textContent = `${aliveCount}/${currentState.players.length} SỐNG`;
  playersRosterList.innerHTML = '';

  currentState.players.forEach((p, idx) => {
    const row = document.createElement('div');
    const isTurn =
      currentState.currentTurnIndex === idx &&
      (currentState.phase === 'TURN_PLAY_OR_CHALLENGE' ||
        currentState.phase === 'FINAL_CHALLENGE_WINDOW');
    row.className = `corner-hud-row${isTurn ? ' active-turn' : ''}${!p.alive ? ' dead' : ''}`;

    const shortName = p.name.split('(')[0].trim();
    const pipsHtml = Array.from(
      { length: 6 },
      (_, ch) => `<span class="chamber-pip${ch < p.revolver.shotsTaken ? ' spent' : ''}"></span>`
    ).join('');

    row.innerHTML = `
      <span class="corner-hud-name">${isTurn ? '>' : ''}${shortName}</span>
      <span class="corner-hud-chambers">${pipsHtml}</span>
      <span class="corner-hud-shots">${!p.alive ? 'CHẾT' : `${p.revolver.shotsTaken}/6`}</span>
    `;
    playersRosterList.appendChild(row);
  });
}

function renderActionLog() {
  const logs = currentState.actionLog || [];
  logCountBadge.textContent = `${logs.length} mục`;
  actionLogContainer.innerHTML = '';

  [...logs].reverse().forEach((item) => {
    const div = document.createElement('div');
    div.className = `log-item ${item.type || ''}`;
    div.textContent = `[Ván ${item.round}] ${item.messageVi}`;
    actionLogContainer.appendChild(div);
  });
}

async function submitPlayerAction(type, payload = {}) {
  if (isRequestInFlight || renderer.isCutscenePlaying() || !currentState) return;
  isRequestInFlight = true;
  clearTimers();
  try {
    const res = await apiRequest('/api/match/action', 'POST', {
      roomId: currentState.roomId,
      type,
      playerId: 'p0',
      ...payload
    });
    if (type === 'PLAY_CARDS') {
      selectedCardIds.clear();
    }
    isRequestInFlight = false;
    await applyStateUpdate(res.state);
  } catch (err) {
    isRequestInFlight = false;
    phaseSubline.textContent = `[LỖI] ${err.message}`;
  }
}

function scheduleNextPacedAction() {
  clearTimers();
  if (!currentState || renderer.isCutscenePlaying()) return;

  // 1. In ROUND_END: Show continuation banner & automatically start the next round after 5.2 seconds
  //    (or the player can click "TIẾP TỤC CHIA VÁN MỚI" immediately!)
  if (currentState.phase === 'ROUND_END') {
    autoRoundTimerId = window.setTimeout(() => {
      submitPlayerAction('NEXT_ROUND');
    }, 5200);
    return;
  }

  if (currentState.phase === 'GAME_OVER') {
    return;
  }

  // 2. In ROULETTE_PENALTY: Let the player see the cylinder spin for 1.1s and click "BẮN SÚNG!".
  //    If an AI is the shooter (or if human is dead), auto-pull after 3.2s if user hasn't clicked yet.
  if (currentState.phase === 'ROULETTE_PENALTY') {
    const nextShooterId = currentState.pendingPenalty?.targetPlayerIds?.[0];
    const shooter = currentState.players.find((p) => p.id === nextShooterId);
    if (shooter && shooter.isAI) {
      aiTimerId = window.setTimeout(() => {
        submitPlayerAction('PULL_TRIGGER', { targetPlayerId: shooter.id });
      }, 3200);
    }
    return;
  }

  // 3. Normal AI Turn — paced at 1.6s AFTER any previous cutscene has already completed!
  const activePlayer = currentState.players[currentState.currentTurnIndex];
  if (
    activePlayer &&
    activePlayer.isAI &&
    (currentState.phase === 'TURN_PLAY_OR_CHALLENGE' ||
      currentState.phase === 'FINAL_CHALLENGE_WINDOW')
  ) {
    aiTimerId = window.setTimeout(() => {
      submitPlayerAction('AI_STEP', { aiPlayerId: activePlayer.id });
    }, 1600);
  }
}

// Event Listeners
btnPlayCards.addEventListener('click', () => {
  if (selectedCardIds.size < 1 || selectedCardIds.size > 3) return;
  submitPlayerAction('PLAY_CARDS', { cardIds: Array.from(selectedCardIds) });
});

btnCallLiar.addEventListener('click', () => {
  submitPlayerAction('CALL_LIAR');
});

btnPassFinal.addEventListener('click', () => {
  submitPlayerAction('PASS_FINAL');
});

btnPullTrigger.addEventListener('click', () => {
  const targetId = currentState?.pendingPenalty?.targetPlayerIds?.[0] || 'p0';
  submitPlayerAction('PULL_TRIGGER', { targetPlayerId: targetId });
});

btnNextRound.addEventListener('click', async () => {
  if (!currentState || renderer.isCutscenePlaying()) return;
  if (currentState.phase === 'GAME_OVER') {
    await startFreshMatchFromCurrentSettings();
  } else {
    await submitPlayerAction('NEXT_ROUND');
  }
});

btnClearSelection.addEventListener('click', () => {
  selectedCardIds.clear();
  renderHUD();
});

document.getElementById('btnQuickRestart').addEventListener('click', async () => {
  await startFreshMatchFromCurrentSettings();
});

async function startFreshMatchFromCurrentSettings() {
  clearTimers();
  selectedCardIds.clear();
  const res = await apiRequest('/api/match/new', 'POST', {
    roomId: currentState?.roomId || 'BAN-101',
    roomName: currentState?.roomName || 'Quán Rượu Cáo Già #101',
    playerName: currentState?.players?.[0]?.name || 'Bạn (Tay Chơi)',
    playerAvatar: currentState?.players?.[0]?.avatarKey || 'human',
    winMode: currentState?.winMode || 'EMPTY_HAND_WIN',
    includeDevil: Boolean(currentState?.includeDevil),
    botDifficulty: currentState?.botDifficulty || 'NORMAL'
  });
  await applyStateUpdate(res.state);
}

// Lobby & Room Browser
document.getElementById('btnOpenLobby').addEventListener('click', async () => {
  lobbyModal.classList.remove('hidden');
  await refreshRoomsList();
});

document.getElementById('btnCloseLobby').addEventListener('click', () => {
  lobbyModal.classList.add('hidden');
});

async function refreshRoomsList() {
  try {
    const data = await apiRequest('/api/rooms');
    publicRoomsList.innerHTML = '';
    data.rooms.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'room-card';
      card.innerHTML = `
        <div>
          <strong style="color: var(--accent-gold);">#${r.roomId} — ${r.roomName}</strong>
          <div style="font-size: 0.75rem; color: var(--text-muted);">
            Ván ${r.roundNumber} (${r.aliveCount}/${r.totalPlayers} sống)${r.includeDevil ? ' • Có Lá Ác Quỷ' : ''}
          </div>
        </div>
        <button type="button" class="pixel-btn primary" data-join-room="${r.roomId}">VÀO BÀN</button>
      `;
      card.querySelector('[data-join-room]').addEventListener('click', async () => {
        const stateRes = await apiRequest(`/api/match/state?roomId=${encodeURIComponent(r.roomId)}`);
        lobbyModal.classList.add('hidden');
        selectedCardIds.clear();
        await applyStateUpdate(stateRes.state);
      });
      publicRoomsList.appendChild(card);
    });
  } catch (err) {
    publicRoomsList.textContent = `Lỗi tải danh sách phòng: ${err.message}`;
  }
}

document.getElementById('createRoomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const playerName = document.getElementById('inputPlayerName').value.trim() || 'Bạn (Tay Chơi)';
  const roomName = document.getElementById('inputRoomName').value.trim() || 'Bàn Quán Rượu';
  const winMode = document.getElementById('selectWinMode').value;
  const includeDevil = document.getElementById('selectDevilMode').value === 'true';
  const playerAvatar = document.getElementById('selectAvatar').value;
  const botDifficulty = document.getElementById('selectBotDifficulty').value;

  const res = await apiRequest('/api/match/new', 'POST', {
    roomName,
    playerName,
    playerAvatar,
    winMode,
    includeDevil,
    botDifficulty
  });
  lobbyModal.classList.add('hidden');
  selectedCardIds.clear();
  await applyStateUpdate(res.state);
});

// Rules Modal
document.getElementById('btnOpenRules').addEventListener('click', () => {
  rulesModal.classList.remove('hidden');
});

document.getElementById('btnCloseRules').addEventListener('click', () => {
  rulesModal.classList.add('hidden');
});

// Sound Toggle
const btnToggleSound = document.getElementById('btnToggleSound');
btnToggleSound.addEventListener('click', () => {
  const isMuted = sound.toggleMute();
  btnToggleSound.textContent = isMuted ? '[SFX] TẮT' : '[SFX] BẬT';
});

// Collapsible Right Drawer (< / > Toggle)
const workspaceGrid = document.getElementById('workspaceGrid');
const btnToggleSidebar = document.getElementById('btnToggleSidebar');
const btnCloseSidebarInner = document.getElementById('btnCloseSidebarInner');

function setSidebarOpen(isOpen) {
  if (!workspaceGrid || !btnToggleSidebar) return;
  workspaceGrid.classList.toggle('drawer-closed', !isOpen);
  btnToggleSidebar.setAttribute('aria-expanded', String(isOpen));
  btnToggleSidebar.textContent = isOpen ? '> ĐÓNG CHAT / LOG' : '< CHAT / LOG';
}

if (btnToggleSidebar) {
  btnToggleSidebar.addEventListener('click', () => {
    const currentlyClosed = workspaceGrid.classList.contains('drawer-closed');
    setSidebarOpen(currentlyClosed);
  });
}

if (btnCloseSidebarInner) {
  btnCloseSidebarInner.addEventListener('click', () => {
    setSidebarOpen(false);
  });
}

// Quick Chat Chips & Custom Chat
document.querySelectorAll('.chat-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const msg = chip.getAttribute('data-chat');
    if (msg) {
      submitPlayerAction('QUICK_CHAT', { messageVi: msg });
    }
  });
});

document.getElementById('customChatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('customChatInput');
  const val = input.value.trim();
  if (!val) return;
  input.value = '';
  submitPlayerAction('QUICK_CHAT', { messageVi: val });
});

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (
    document.activeElement &&
    (document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'SELECT' ||
      document.activeElement.tagName === 'TEXTAREA')
  ) {
    return;
  }
  if (!lobbyModal.classList.contains('hidden') || !rulesModal.classList.contains('hidden')) {
    if (e.key === 'Escape') {
      lobbyModal.classList.add('hidden');
      rulesModal.classList.add('hidden');
    }
    return;
  }
  if (!currentState || renderer.isCutscenePlaying()) return;

  const human = currentState.players.find((p) => p.id === 'p0');
  const hand = human?.hand || [];

  if (['1', '2', '3', '4', '5'].includes(e.key)) {
    const idx = Number(e.key) - 1;
    if (hand[idx]) {
      toggleCardSelection(hand[idx].id);
    }
  } else if (e.key === ' ' || e.key === 'Enter') {
    if (currentState.phase === 'TURN_PLAY_OR_CHALLENGE' && !btnPlayCards.disabled) {
      e.preventDefault();
      btnPlayCards.click();
    } else if (
      currentState.phase === 'ROULETTE_PENALTY' &&
      !btnPullTrigger.disabled &&
      btnPullTrigger.style.display !== 'none'
    ) {
      e.preventDefault();
      btnPullTrigger.click();
    } else if (
      (currentState.phase === 'ROUND_END' || currentState.phase === 'GAME_OVER') &&
      !btnNextRound.disabled &&
      btnNextRound.style.display !== 'none'
    ) {
      e.preventDefault();
      btnNextRound.click();
    }
  } else if (e.key.toLowerCase() === 'l') {
    if (!btnCallLiar.disabled && btnCallLiar.style.display !== 'none') {
      btnCallLiar.click();
    }
  } else if (e.key.toLowerCase() === 'p') {
    if (!btnPassFinal.disabled && btnPassFinal.style.display !== 'none') {
      btnPassFinal.click();
    }
  } else if (e.key.toLowerCase() === 'r') {
    if (!btnPullTrigger.disabled && btnPullTrigger.style.display !== 'none') {
      btnPullTrigger.click();
    }
  }
});

// Boot initial state
loadInitialState();
