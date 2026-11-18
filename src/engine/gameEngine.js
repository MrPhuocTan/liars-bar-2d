/**
 * Liar's Bar 2D (Online Web Version) — Deterministic Core Game Engine
 * Implements:
 * - 20-card Liar's Deck (6 Kings, 6 Queens, 6 Aces, 2 Jokers; optional Devil card)
 * - Multi-Round Elimination Loop:
 *   - Players who empty their hand win the sub-round (safeForRound = true, subRoundWins += 1)
 *   - Remaining players continue until a Liar challenge or last player holding cards must shoot
 *   - Dead players are permanently eliminated (alive = false) and skipped in subsequent rounds
 *   - Match continues across rounds (4 -> 3 -> 2 / 1v1) until only 1 survivor remains alive!
 * - 6-Chamber Russian Roulette Revolver (1/6 -> 6/6) with:
 *   - BLANK (Đạn rỗng: xoay 1 nấc + kêu Tách)
 *   - FATAL (Trúng đạn: bắn vỡ Avatar, loại khỏi trận)
 *   - MIRACLE DODGE (5% xác suất bắn hụt: Avatar thu nhỏ nhảy lên né đạn "Hú hồn, né được nhé!")
 */

export const CARD_RANKS = ['K', 'Q', 'A'];

export const SPECIAL_CARDS = {
  JOKER: 'J',
  DEVIL: 'D'
};

export const WIN_MODES = {
  EMPTY_HAND_WIN: 'EMPTY_HAND_WIN',
  CLASSIC_SURVIVAL: 'CLASSIC_SURVIVAL'
};

export const PHASES = {
  LOBBY: 'LOBBY',
  TURN_PLAY_OR_CHALLENGE: 'TURN_PLAY_OR_CHALLENGE',
  FINAL_CHALLENGE_WINDOW: 'FINAL_CHALLENGE_WINDOW',
  ROULETTE_PENALTY: 'ROULETTE_PENALTY',
  ROUND_END: 'ROUND_END',
  GAME_OVER: 'GAME_OVER'
};

export const RANK_META = {
  K: { rank: 'K', nameVi: 'Già (King)', shortVi: 'Lá K', titleVi: 'BÀN K (GIÀ)', color: '#f4b41b' },
  Q: { rank: 'Q', nameVi: 'Đầm (Queen)', shortVi: 'Lá Q', titleVi: 'BÀN Q (ĐẦM)', color: '#e85d75' },
  A: { rank: 'A', nameVi: 'Át (Ace)', shortVi: 'Lá A', titleVi: 'BÀN A (ÁT)', color: '#4ea8de' },
  J: { rank: 'J', nameVi: 'Joker (Vạn Năng)', shortVi: 'Joker', titleVi: 'JOKER', color: '#3cd070' },
  D: { rank: 'D', nameVi: 'Ác Quỷ (Devil)', shortVi: 'Ác Quỷ', titleVi: 'ÁC QUỶ', color: '#e03c3c' }
};

export const DEFAULT_PLAYERS_TEMPLATE = [
  { id: 'p0', name: 'Bạn (Tay Chơi)', isAI: false, persona: 'HUMAN', avatarKey: 'human', titleVi: 'Tay Chơi Bí Ẩn' },
  { id: 'p1', name: 'Cáo Già (Foxy)', isAI: true, persona: 'CALCULATED', avatarKey: 'fox', titleVi: 'Cao Thủ Đếm Bài' },
  { id: 'p2', name: 'Sói Độc (Wolf)', isAI: true, persona: 'AGGRESSIVE', avatarKey: 'wolf', titleVi: 'Vua Bịp Liều Lĩnh' },
  { id: 'p3', name: 'Heo Ngầu (Boar)', isAI: true, persona: 'CAUTIOUS', avatarKey: 'pig', titleVi: 'Kẻ Đa Nghi' }
];

export function createSeededRNG(seed = Date.now()) {
  let a = (Number(seed) || 1337) >>> 0;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleArray(items, rng = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export function buildDeck({ includeDevil = false } = {}) {
  const deck = [];
  for (const rank of CARD_RANKS) {
    for (let i = 1; i <= 6; i += 1) {
      deck.push({
        id: `${rank}-${i}`,
        rank,
        labelVi: RANK_META[rank].nameVi
      });
    }
  }
  deck.push({
    id: 'J-1',
    rank: 'J',
    labelVi: RANK_META.J.nameVi
  });
  if (includeDevil) {
    deck.push({
      id: 'D-1',
      rank: 'D',
      labelVi: RANK_META.D.nameVi
    });
  } else {
    deck.push({
      id: 'J-2',
      rank: 'J',
      labelVi: RANK_META.J.nameVi
    });
  }
  return deck;
}

function appendLog(state, type, messageVi, meta = {}) {
  const entry = {
    id: `log-${state.actionLog.length + 1}`,
    round: state.roundNumber,
    type,
    messageVi,
    timestamp: Date.now(),
    ...meta
  };
  state.actionLog.push(entry);
  if (state.actionLog.length > 80) {
    state.actionLog.shift();
  }
}

function findNextEligibleTurnIndex(state, fromIndex) {
  const count = state.players.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const idx = (fromIndex + offset) % count;
    const p = state.players[idx];
    if (p.alive && !p.safeForRound && p.hand.length > 0) {
      return idx;
    }
  }
  for (let offset = 1; offset <= count; offset += 1) {
    const idx = (fromIndex + offset) % count;
    const p = state.players[idx];
    if (p.alive) {
      return idx;
    }
  }
  return fromIndex;
}

function nextRandom(state) {
  if (typeof state._rng !== 'function') {
    const baseSeed = (state.seed || 1337) + (state.rngStateCalls || 0) * 9973;
    state._rng = createSeededRNG(baseSeed);
  }
  state.rngStateCalls = (state.rngStateCalls || 0) + 1;
  return state._rng();
}

export function createMatchState(options = {}) {
  const {
    roomId = 'BAN-101',
    roomName = 'Quán Rượu Cáo Già #101',
    playerName = 'Bạn (Tay Chơi)',
    playerAvatar = 'human',
    playerCount = 4,
    players: customPlayers = null,
    winMode = WIN_MODES.EMPTY_HAND_WIN,
    includeDevil = false,
    devilProbability = 0.30,
    botDifficulty = 'MATH_MASTER',
    turnTimeSeconds = 60,
    seed = Date.now()
  } = options;

  const rng = createSeededRNG(seed);

  let players;
  if (Array.isArray(customPlayers) && customPlayers.length >= 2) {
    players = customPlayers.slice(0, 4).map((cp, idx) => {
      const bulletIndex = Math.floor(rng() * 6);
      return {
        id: cp.id,
        seatIndex: idx,
        name: String(cp.name || `Người chơi ${idx + 1}`).trim(),
        isAI: Boolean(cp.isAI),
        isHost: Boolean(cp.isHost),
        disconnected: false,
        persona: cp.persona || 'CALCULATED',
        avatarKey: cp.avatarKey || 'human',
        titleVi: cp.titleVi || (cp.isAI ? 'Bot Quán Rượu' : 'Người Chơi'),
        alive: true,
        safeForRound: false,
        hand: [],
        revolver: {
          chamberIndex: 0,
          bulletIndex,
          shotsTaken: 0,
          maxChambers: 6
        },
        lastEmotion: 'neutral',
        lastSpeech: '',
        stats: {
          cardsPlayed: 0,
          bluffsMade: 0,
          challengesCalled: 0,
          challengesWon: 0,
          triggersPulled: 0,
          subRoundWins: 0,
          miracleDodges: 0
        }
      };
    });
  } else {
    const clampedCount = Math.min(4, Math.max(2, Number(playerCount) || 4));
    players = DEFAULT_PLAYERS_TEMPLATE.slice(0, clampedCount).map((tpl, idx) => {
      const bulletIndex = Math.floor(rng() * 6);
      return {
        id: tpl.id,
        seatIndex: idx,
        name: idx === 0 ? (String(playerName || '').trim() || tpl.name) : tpl.name,
        isAI: idx !== 0,
        isHost: idx === 0,
        disconnected: false,
        persona: tpl.persona,
        avatarKey: idx === 0 ? (playerAvatar || 'human') : tpl.avatarKey,
        titleVi: tpl.titleVi,
        alive: true,
        safeForRound: false,
        hand: [],
        revolver: {
          chamberIndex: 0,
          bulletIndex,
          shotsTaken: 0,
          maxChambers: 6
        },
        lastEmotion: 'neutral',
        lastSpeech: '',
        stats: {
          cardsPlayed: 0,
          bluffsMade: 0,
          challengesCalled: 0,
          challengesWon: 0,
          triggersPulled: 0,
          subRoundWins: 0,
          miracleDodges: 0
        }
      };
    });
  }

  const state = {
    gameType: 'LIARS_DECK',
    roomId,
    roomName,
    seed: Number(seed) || 1337,
    rngStateCalls: 0,
    winMode: winMode === WIN_MODES.CLASSIC_SURVIVAL ? WIN_MODES.CLASSIC_SURVIVAL : WIN_MODES.EMPTY_HAND_WIN,
    includeDevil: Boolean(includeDevil),
    devilProbability: Number(devilProbability ?? 0.30),
    roundHasDevil: false,
    botDifficulty,
    turnTimeSeconds: Number(turnTimeSeconds) || 60,
    roundNumber: 0,
    tableRank: 'K',
    phase: PHASES.LOBBY,
    currentTurnIndex: 0,
    roundStarterIndex: 0,
    pileCount: 0,
    centerPileCards: [],
    lastPlay: null,
    pendingPenalty: null,
    lastRouletteResult: null,
    lastChallengeResolution: null,
    eventSeq: 0,
    lastEvent: null,
    winnerId: null,
    winnerName: null,
    winnerReason: null,
    players,
    actionLog: [],
    _rng: rng
  };

  appendLog(
    state,
    'MATCH_START',
    `Khởi tạo bàn "${roomName}" — Chế độ: Đánh Hết Bài Thắng Ván Con + Súng Lục Sinh Tồn Đến Người Cuối Cùng${
      state.includeDevil ? ' + Có Lá Ác Quỷ (Devil)' : ''
    }.`
  );

  return startNewRound(state);
}

function recordEvent(state, type, payload = {}) {
  state.eventSeq = (state.eventSeq || 0) + 1;
  state.lastEvent = {
    seq: state.eventSeq,
    type,
    timestamp: Date.now(),
    ...payload
  };
}

export function startNewRound(state, options = {}) {
  if (state.phase === PHASES.GAME_OVER) {
    return state;
  }

  const alivePlayers = state.players.filter((p) => p.alive);
  if (alivePlayers.length <= 1) {
    state.phase = PHASES.GAME_OVER;
    if (alivePlayers.length === 1) {
      state.winnerId = alivePlayers[0].id;
      state.winnerName = alivePlayers[0].name;
      state.winnerReason = 'LAST_SURVIVOR_VICTORY';
      alivePlayers[0].lastEmotion = 'victory';
      appendLog(
        state,
        'GAME_OVER',
        `[CHIẾN THẮNG CHUNG CUỘC] ${alivePlayers[0].name} là người sống sót cuối cùng trên bàn rượu!`
      );
    }
    return state;
  }

  state.roundNumber += 1;
  const tableIdx = Math.floor(nextRandom(state) * CARD_RANKS.length);
  state.tableRank = CARD_RANKS[tableIdx];

  // B1: 30% probability per sub-round that 1 Devil Card is in the deck (unless forced)
  const hasDevil =
    options.forceDevil !== undefined
      ? Boolean(options.forceDevil)
      : state.includeDevil
      ? true
      : nextRandom(state) < (state.devilProbability ?? 0.30);
  state.roundHasDevil = hasDevil;

  const rawDeck = buildDeck({ includeDevil: hasDevil });
  const shuffledDeck = shuffleArray(rawDeck, () => nextRandom(state));

  let deckCursor = 0;
  for (const player of state.players) {
    if (player.alive) {
      player.safeForRound = false;
      player.hand = shuffledDeck.slice(deckCursor, deckCursor + 5);
      deckCursor += 5;
      player.lastEmotion = player.revolver.shotsTaken >= 3 ? 'sweat' : 'neutral';
      player.lastSpeech = '';
    } else {
      player.safeForRound = false;
      player.hand = [];
      player.lastEmotion = 'dead';
      player.lastSpeech = '';
    }
  }

  state.pileCount = 0;
  state.centerPileCards = [];
  state.lastPlay = null;
  state.pendingPenalty = null;
  state.lastRouletteResult = null;
  state.lastChallengeResolution = null;

  let starterIdx = state.roundNumber === 1 ? 0 : (state.roundStarterIndex + 1) % state.players.length;
  if (!state.players[starterIdx]?.alive) {
    starterIdx = findNextEligibleTurnIndex(state, starterIdx);
  }
  state.roundStarterIndex = starterIdx;
  state.currentTurnIndex = starterIdx;
  state.phase = PHASES.TURN_PLAY_OR_CHALLENGE;

  const starterPlayer = state.players[state.currentTurnIndex];
  const aliveNames = alivePlayers.map((p) => p.name).join(', ');
  appendLog(
    state,
    'ROUND_START',
    `=== VÁN ${state.roundNumber}: ${RANK_META[state.tableRank].titleVi} === Còn ${alivePlayers.length} người sống (${aliveNames}). Chia 5 lá/người. Lượt đầu: ${starterPlayer.name}.`
  );

  recordEvent(state, 'DEAL_ROUND', {
    roundNumber: state.roundNumber,
    tableRank: state.tableRank,
    alivePlayerIds: alivePlayers.map((p) => p.id),
    starterName: starterPlayer.name
  });

  return state;
}

export function evaluatePlayedBatch(cards, tableRank) {
  const isDevilTrap = cards.some((c) => c.rank === SPECIAL_CARDS.DEVIL);
  if (isDevilTrap) {
    return {
      isTruthful: false,
      wasLying: true,
      isDevilTrap: true
    };
  }
  const isTruthful = cards.every((c) => c.rank === tableRank || c.rank === SPECIAL_CARDS.JOKER);
  return {
    isTruthful,
    wasLying: !isTruthful,
    isDevilTrap: false
  };
}

export function playCards(state, playerId, cardIds, customSpeech = '') {
  if (state.phase !== PHASES.TURN_PLAY_OR_CHALLENGE) {
    throw new Error('Không thể đánh bài ở giai đoạn hiện tại.');
  }

  const activePlayer = state.players[state.currentTurnIndex];
  if (!activePlayer || activePlayer.id !== playerId) {
    throw new Error(`Chưa tới lượt của người chơi ${playerId}. Hiện đang là lượt của ${activePlayer?.name}.`);
  }

  if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 3) {
    throw new Error('Bạn phải chọn từ 1 đến 3 lá bài để đánh úp xuống bàn.');
  }

  const uniqueIds = [...new Set(cardIds)];
  if (uniqueIds.length !== cardIds.length) {
    throw new Error('Danh sách lá bài được chọn bị trùng lặp.');
  }

  const selectedCards = [];
  for (const id of uniqueIds) {
    const found = activePlayer.hand.find((c) => c.id === id);
    if (!found) {
      throw new Error(`Lá bài "${id}" không nằm trên tay của ${activePlayer.name}.`);
    }
    selectedCards.push(found);
  }

  const hasDevil = selectedCards.some((c) => c.rank === SPECIAL_CARDS.DEVIL);
  if (hasDevil && selectedCards.length > 1) {
    throw new Error('Lá Ác Quỷ (Devil) chỉ được phép đánh đơn lẻ 1 lá duy nhất, không được kẹp chung với lá khác!');
  }

  const selectedSet = new Set(uniqueIds);
  activePlayer.hand = activePlayer.hand.filter((c) => !selectedSet.has(c.id));

  const evalCheck = evaluatePlayedBatch(selectedCards, state.tableRank);
  activePlayer.stats.cardsPlayed += selectedCards.length;
  if (evalCheck.wasLying) {
    activePlayer.stats.bluffsMade += 1;
  }

  state.pileCount += selectedCards.length;
  state.centerPileCards.push(...selectedCards);

  const claimSpeech =
    customSpeech ||
    `Đánh ${selectedCards.length} lá ${state.tableRank}! (${
      activePlayer.hand.length === 0 ? 'HẾT BÀI TRÊN TAY!' : `còn ${activePlayer.hand.length} lá`
    })`;

  activePlayer.lastSpeech = claimSpeech;
  activePlayer.lastEmotion = activePlayer.hand.length === 0 ? 'smirk' : 'neutral';

  state.lastPlay = {
    playerId: activePlayer.id,
    playerName: activePlayer.name,
    cards: selectedCards,
    claimedCount: selectedCards.length,
    claimedRank: state.tableRank,
    emptiedHand: activePlayer.hand.length === 0
  };

  appendLog(
    state,
    'PLAY_CARDS',
    `[ĐÁNH BÀI] ${activePlayer.name} đánh ${selectedCards.length} lá (tuyên bố ${selectedCards.length} Lá ${state.tableRank})${
      activePlayer.hand.length === 0 ? ' — ĐÃ HẾT BÀI TRÊN TAY!' : ` (còn ${activePlayer.hand.length} lá).`
    }`,
    {
      playerId: activePlayer.id,
      claimedCount: selectedCards.length,
      claimedRank: state.tableRank,
      remainingCards: activePlayer.hand.length
    }
  );

  recordEvent(state, 'PLAY_CARDS', {
    playerId: activePlayer.id,
    seatIndex: activePlayer.seatIndex,
    playerName: activePlayer.name,
    cardCount: selectedCards.length,
    claimedRank: state.tableRank,
    remainingHandCount: activePlayer.hand.length,
    emptiedHand: activePlayer.hand.length === 0
  });

  // Check if player just emptied their hand!
  if (activePlayer.hand.length === 0) {
    const nextChallengerIdx = findNextEligibleTurnIndex(state, state.currentTurnIndex);
    state.currentTurnIndex = nextChallengerIdx;
    state.phase = PHASES.FINAL_CHALLENGE_WINDOW;
    const nextChallenger = state.players[nextChallengerIdx];
    appendLog(
      state,
      'FINAL_WINDOW',
      `[XÉT BÀI CUỐI] ${activePlayer.name} vừa đánh hết bài trên tay! ${nextChallenger.name} phải chọn: "LẬT BÀI" để xét hoặc "CHO QUA" (công nhận ${activePlayer.name} thắng ván con này).`
    );
    return state;
  }

  state.currentTurnIndex = findNextEligibleTurnIndex(state, state.currentTurnIndex);
  state.phase = PHASES.TURN_PLAY_OR_CHALLENGE;
  return state;
}

/**
 * When a player empties their hand and the next player chooses "CHO QUA" (Pass Final Challenge):
 * - The empty-hand player wins the sub-round (safeForRound = true, subRoundWins += 1)!
 * - If only 1 alive player remains holding cards in this sub-round, that last player loses the sub-round and must pull the Russian Roulette trigger!
 * - If >= 2 alive players still hold cards, those remaining players continue playing the sub-round until someone shoots!
 */
export function passFinalChallenge(state, callerId) {
  if (state.phase !== PHASES.FINAL_CHALLENGE_WINDOW) {
    throw new Error('Chỉ có thể "Cho Qua" trong cửa sổ xét bài cuối cùng.');
  }

  const activePlayer = state.players[state.currentTurnIndex];
  if (!activePlayer || activePlayer.id !== callerId) {
    throw new Error(`Chỉ ${activePlayer?.name} mới có quyền quyết định Cho Qua hoặc Lật Bài lúc này.`);
  }

  const subRoundWinner = state.players.find((p) => p.id === state.lastPlay?.playerId);
  if (!subRoundWinner) {
    throw new Error('Không tìm thấy người chơi vừa đánh hết bài.');
  }

  subRoundWinner.safeForRound = true;
  subRoundWinner.stats.subRoundWins = (subRoundWinner.stats.subRoundWins || 0) + 1;
  subRoundWinner.lastEmotion = 'victory';
  subRoundWinner.lastSpeech = 'Đánh hết bài thành công! Tôi an toàn qua ván này nhé!';
  activePlayer.lastSpeech = 'Tôi tin! Không lật bài...';

  const playersStillHolding = state.players.filter(
    (p) => p.alive && !p.safeForRound && p.hand.length > 0
  );

  // If 2+ players still hold cards, the sub-round continues among them!
  if (playersStillHolding.length >= 2) {
    state.lastPlay = null;
    state.pileCount = 0;
    state.centerPileCards = [];
    const nextIdx = state.players.findIndex((p) => p.id === playersStillHolding[0].id);
    state.currentTurnIndex = nextIdx >= 0 ? nextIdx : findNextEligibleTurnIndex(state, state.currentTurnIndex);
    state.phase = PHASES.TURN_PLAY_OR_CHALLENGE;

    appendLog(
      state,
      'PASS_FINAL',
      `[THẮNG VÁN CON] ${activePlayer.name} chọn "CHO QUA". ${subRoundWinner.name} đánh hết bài và thoát an toàn! Còn ${playersStillHolding.length} người giữ bài tiếp tục đấu trí để tìm người phải bắn súng!`
    );

    recordEvent(state, 'SUBROUND_SAFE', {
      safePlayerId: subRoundWinner.id,
      safePlayerName: subRoundWinner.name,
      remainingHolders: playersStillHolding.length
    });
    return state;
  }

  // Otherwise only 1 player is left holding cards (e.g. in 1v1 or when 2 others already escaped):
  // That last player holding cards loses the sub-round and must pull the Russian Roulette trigger!
  const loserPlayer = playersStillHolding[0] || activePlayer;
  loserPlayer.lastEmotion = 'shock';
  loserPlayer.lastSpeech = 'Chỉ còn mình tôi ôm bài... Phải rút súng rồi!';

  const summaryVi = `[THUA VÁN CON] ${subRoundWinner.name} đã đánh hết bài thành công! ${loserPlayer.name} là người cuối cùng còn ôm bài nên phải rút súng Cò Quay Nga!`;

  state.pendingPenalty = {
    callerId: activePlayer.id,
    callerName: activePlayer.name,
    accusedId: subRoundWinner.id,
    accusedName: subRoundWinner.name,
    revealedCards: state.lastPlay.cards,
    wasLying: false,
    verdictTag: 'REAL',
    isDevilTrap: false,
    targetPlayerIds: [loserPlayer.id],
    emptiedHandCandidateId: subRoundWinner.id
  };

  state.lastChallengeResolution = {
    ...state.pendingPenalty,
    summaryVi
  };

  state.phase = PHASES.ROULETTE_PENALTY;
  appendLog(state, 'PASS_FINAL', summaryVi);

  recordEvent(state, 'ROULETTE_READY', {
    verdictTag: 'REAL',
    callerName: activePlayer.name,
    accusedName: subRoundWinner.name,
    shooterId: loserPlayer.id,
    shooterName: loserPlayer.name,
    revealedCards: state.lastPlay.cards
  });

  return state;
}

export function callLiar(state, callerId) {
  if (
    state.phase !== PHASES.TURN_PLAY_OR_CHALLENGE &&
    state.phase !== PHASES.FINAL_CHALLENGE_WINDOW
  ) {
    throw new Error('Không thể hô Lật Bài ở giai đoạn hiện tại.');
  }

  if (!state.lastPlay) {
    throw new Error('Chưa có ai đánh bài xuống bàn để Lật Bài!');
  }

  const activePlayer = state.players[state.currentTurnIndex];
  if (!activePlayer || activePlayer.id !== callerId) {
    throw new Error(`Chưa tới lượt của bạn để hô Lật Bài (Hiện là lượt của ${activePlayer?.name}).`);
  }

  if (state.lastPlay.playerId === callerId) {
    throw new Error('Không thể tự hô Lật Bài của chính mình.');
  }

  const accusedPlayer = state.players.find((p) => p.id === state.lastPlay.playerId);
  const revealedCards = state.lastPlay.cards;
  const evaluation = evaluatePlayedBatch(revealedCards, state.tableRank);

  activePlayer.stats.challengesCalled += 1;
  activePlayer.lastSpeech = 'BẮT BÀI! Mở bài lên xem thật hay giả!';

  const cardNamesStr = revealedCards.map((c) => `[${c.rank}]`).join(' ');
  let targetPlayerIds = [];
  let summaryVi = '';
  let verdictTag = 'FAKE';

  if (evaluation.isDevilTrap) {
    verdictTag = 'DEVIL';
    targetPlayerIds = state.players
      .filter((p) => p.alive && p.id !== accusedPlayer.id)
      .map((p) => p.id);
    accusedPlayer.lastEmotion = 'smirk';
    accusedPlayer.lastSpeech = 'Dính bẫy ÁC QUỶ (DEVIL) rồi nhé!';
    activePlayer.lastEmotion = 'shock';
    summaryVi = `[BẪY ÁC QUỶ] ${activePlayer.name} bắt bài của ${accusedPlayer.name} và lật trúng lá ${cardNamesStr}! Toàn bộ người chơi khác trên bàn (${targetPlayerIds.length} người) phải rút súng bóp cò!`;
  } else if (evaluation.wasLying) {
    verdictTag = 'FAKE';
    targetPlayerIds = [accusedPlayer.id];
    activePlayer.stats.challengesWon += 1;
    activePlayer.lastEmotion = 'smirk';
    accusedPlayer.lastEmotion = 'shock';
    accusedPlayer.lastSpeech = 'FAKE! Bị bắt quả tang bài giả rồi...';
    summaryVi = `[FAKE — BÀI GIẢ!] ${activePlayer.name} bắt bài của ${accusedPlayer.name}: Lật ra ${cardNamesStr} (Bàn ${state.tableRank}) -> ${accusedPlayer.name} NÓI DỐI và phải rút súng Cò Quay Nga!`;
  } else {
    verdictTag = 'REAL';
    targetPlayerIds = [activePlayer.id];
    if (accusedPlayer.hand.length === 0) {
      accusedPlayer.safeForRound = true;
      accusedPlayer.stats.subRoundWins = (accusedPlayer.stats.subRoundWins || 0) + 1;
    }
    accusedPlayer.lastEmotion = 'smirk';
    accusedPlayer.lastSpeech = 'REAL! Bài thật 100%, tự rút súng bắn đi!';
    activePlayer.lastEmotion = 'shock';
    summaryVi = `[REAL — BÀI THẬT!] ${activePlayer.name} bắt bài của ${accusedPlayer.name}: Lật ra ${cardNamesStr} (đều là bài thật Bàn ${state.tableRank}) -> ${activePlayer.name} bắt sai và phải tự rút súng Cò Quay Nga!`;
  }

  state.pendingPenalty = {
    callerId: activePlayer.id,
    callerName: activePlayer.name,
    accusedId: accusedPlayer.id,
    accusedName: accusedPlayer.name,
    revealedCards,
    wasLying: evaluation.wasLying,
    verdictTag,
    isDevilTrap: evaluation.isDevilTrap,
    targetPlayerIds,
    emptiedHandCandidateId: state.lastPlay.emptiedHand ? accusedPlayer.id : null
  };

  state.lastChallengeResolution = {
    ...state.pendingPenalty,
    summaryVi
  };

  state.phase = PHASES.ROULETTE_PENALTY;
  appendLog(state, 'CALL_LIAR', summaryVi, {
    callerId: activePlayer.id,
    accusedId: accusedPlayer.id,
    revealedRanks: revealedCards.map((c) => c.rank),
    wasLying: evaluation.wasLying,
    verdictTag,
    isDevilTrap: evaluation.isDevilTrap
  });

  recordEvent(state, 'CALL_LIAR_REVEAL', {
    callerId: activePlayer.id,
    callerName: activePlayer.name,
    accusedId: accusedPlayer.id,
    accusedName: accusedPlayer.name,
    tableRank: state.tableRank,
    revealedCards,
    wasLying: evaluation.wasLying,
    verdictTag,
    shooterId: targetPlayerIds[0],
    shooterName: state.players.find((p) => p.id === targetPlayerIds[0])?.name || ''
  });

  return state;
}

/**
 * Pulls the 6-chamber Russian Roulette revolver trigger for targetPlayerId.
 * Supports:
 * - Blank shot (Tách! Không có đạn)
 * - 5% Miracle Dodge (Bắn hụt 5%: Avatar thu nhỏ nhảy lên né viên đạn lướt qua, hiện "Hú hồn, né được nhé!")
 * - Fatal shot (Đoàng! Viên đạn bắn vỡ Avatar người bị bắn, loại khỏi các ván sau)
 * - Match only ends when 1 survivor remains (alivePlayers.length === 1); otherwise transitions to ROUND_END to deal next round!
 */
export function pullTrigger(state, targetPlayerId, options = {}) {
  if (state.phase !== PHASES.ROULETTE_PENALTY || !state.pendingPenalty) {
    throw new Error('Hiện không có hình phạt Cò Quay Nga nào đang chờ xử lý.');
  }

  const { targetPlayerIds } = state.pendingPenalty;
  if (!targetPlayerIds.includes(targetPlayerId)) {
    throw new Error(`Người chơi ${targetPlayerId} không nằm trong danh sách phải bóp cò lúc này.`);
  }
  if (targetPlayerIds[0] !== targetPlayerId) {
    throw new Error(`Chưa tới lượt ${targetPlayerId} bóp cò (Đang chờ ${targetPlayerIds[0]}).`);
  }

  const player = state.players.find((p) => p.id === targetPlayerId);
  if (!player || !player.alive) {
    throw new Error('Người chơi không tồn tại hoặc đã bị loại.');
  }

  const currentChamber = player.revolver.chamberIndex;
  const hitBullet = currentChamber === player.revolver.bulletIndex;

  // A: 5% "Hú hồn" miracle dodge when guaranteed to hit the bullet at the 6th chamber (index 5)
  const isSixthChamber = currentChamber === 5;
  const dodgeRoll = nextRandom(state);
  const isMiracleDodge =
    options.forceDodge === true ||
    (hitBullet && isSixthChamber && options.forceFatal !== true && dodgeRoll < 0.05);

  const isFatal = hitBullet && !isMiracleDodge;

  player.revolver.shotsTaken += 1;
  player.revolver.chamberIndex = Math.min(5, player.revolver.chamberIndex + 1);
  player.stats.triggersPulled += 1;

  let outcomeType = 'BLANK';
  if (isMiracleDodge) {
    outcomeType = 'DODGE';
    player.alive = true;
    player.stats.miracleDodges = (player.stats.miracleDodges || 0) + 1;
    // Reset bullet in cylinder after miracle dodge so gun remains active
    player.revolver.chamberIndex = 0;
    player.revolver.shotsTaken = 0;
    player.revolver.bulletIndex = Math.floor(nextRandom(state) * 6);
    player.lastEmotion = 'victory';
    player.lastSpeech = 'Hú hồn, may mà né được, lêu lêu con gà kia!';
  } else if (isFatal) {
    outcomeType = 'FATAL';
    player.alive = false;
    player.hand = [];
    player.lastEmotion = 'dead';
    player.lastSpeech = 'ĐOÀNG!! Vỡ tan...';
  } else {
    outcomeType = 'BLANK';
    player.lastEmotion = 'sweat';
    player.lastSpeech = `Tách! Không có đạn (${player.revolver.shotsTaken}/6)`;
  }

  state.lastRouletteResult = {
    playerId: player.id,
    playerName: player.name,
    avatarKey: player.avatarKey,
    outcomeType, // 'BLANK' | 'FATAL' | 'DODGE'
    isFatal,
    isMiracleDodge,
    verdictTag: state.pendingPenalty.verdictTag || (state.pendingPenalty.wasLying ? 'FAKE' : 'REAL'),
    shotsTaken: player.revolver.shotsTaken,
    maxChambers: 6,
    oddsLabel: `${player.revolver.shotsTaken}/6`
  };

  if (isMiracleDodge) {
    appendLog(
      state,
      'ROULETTE_SHOT',
      `[NÉ ĐẠN 5%!] Viên đạn nổ vang nhưng sượt qua tóc! ${player.name} nhảy vọt lên né đạn: "Hú hồn, may mà né được, lêu lêu con gà kia!"`,
      state.lastRouletteResult
    );
  } else if (isFatal) {
    appendLog(
      state,
      'ROULETTE_SHOT',
      `[ĐOÀNG!! BẮN VỠ AVATAR] ${player.name} trúng viên đạn thật ở phát thứ ${player.revolver.shotsTaken}/6 và bị loại khỏi trận đấu!`,
      state.lastRouletteResult
    );
  } else {
    appendLog(
      state,
      'ROULETTE_SHOT',
      `[TÁCH! ĐẠN RỖNG] Vòng đạn xoay 1 nấc và kêu "Tách" — ${player.name} sống sót (${player.revolver.shotsTaken}/6 viên)!`,
      state.lastRouletteResult
    );
  }

  recordEvent(state, 'ROULETTE_SHOT', {
    ...state.lastRouletteResult
  });

  state.pendingPenalty.targetPlayerIds = state.pendingPenalty.targetPlayerIds.filter(
    (id) => id !== targetPlayerId
  );

  if (state.pendingPenalty.targetPlayerIds.length > 0) {
    return state;
  }

  const alivePlayers = state.players.filter((p) => p.alive);

  // Match ONLY ends when all opponents are dead and 1 survivor remains!
  if (alivePlayers.length === 1) {
    const survivor = alivePlayers[0];
    survivor.lastEmotion = 'victory';
    survivor.lastSpeech = 'Tất cả đối thủ đã gục! Tôi là người chiến thắng cuối cùng!';
    state.phase = PHASES.GAME_OVER;
    state.winnerId = survivor.id;
    state.winnerName = survivor.name;
    state.winnerReason = 'LAST_SURVIVOR_VICTORY';
    appendLog(
      state,
      'GAME_OVER',
      `[KẾT THÚC TRẬN ĐẤU] Tất cả đối thủ đã chết — ${survivor.name} là người sống sót cuối cùng và giành chiến thắng chung cuộc!`
    );
    return state;
  }

  // Otherwise, >= 2 players are still alive! Transition to ROUND_END so next round deals to surviving players!
  state.roundStarterIndex = player.alive
    ? state.players.findIndex((p) => p.id === player.id)
    : findNextEligibleTurnIndex(state, state.currentTurnIndex);
  state.phase = PHASES.ROUND_END;

  appendLog(
    state,
    'ROUND_END',
    `[CHUẨN BỊ VÁN MỚI] Còn ${alivePlayers.length} người sống sót (${alivePlayers
      .map((p) => p.name)
      .join(', ')}). Bấm "TIẾP TỤC VÁN MỚI" để chia bài đấu tiếp!`
  );

  return state;
}

export function addQuickChat(state, playerId, messageVi) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error('Không tìm thấy người chơi.');
  }
  const cleanMsg = String(messageVi || '').trim().slice(0, 120);
  if (!cleanMsg) {
    throw new Error('Nội dung chat không được để trống.');
  }
  player.lastSpeech = cleanMsg;
  appendLog(state, 'QUICK_CHAT', `[CHAT] ${player.name}: "${cleanMsg}"`, { playerId });
  return state;
}

export function getPublicState(state, viewerPlayerId = 'p0') {
  const revealLastPlay =
    state.phase === PHASES.ROULETTE_PENALTY ||
    state.phase === PHASES.ROUND_END ||
    state.phase === PHASES.GAME_OVER;

  return {
    gameType: state.gameType || 'LIARS_DECK',
    roomId: state.roomId,
    roomName: state.roomName,
    winMode: state.winMode,
    includeDevil: state.includeDevil,
    roundHasDevil: Boolean(state.roundHasDevil),
    botDifficulty: state.botDifficulty,
    turnTimeSeconds: state.turnTimeSeconds,
    roundNumber: state.roundNumber,
    tableRank: state.tableRank,
    tableMeta: RANK_META[state.tableRank],
    phase: state.phase,
    currentTurnIndex: state.currentTurnIndex,
    currentTurnPlayerId: state.players[state.currentTurnIndex]?.id || null,
    pileCount: state.pileCount,
    eventSeq: state.eventSeq || 0,
    lastEvent: state.lastEvent || null,
    lastPlay: state.lastPlay
      ? {
          playerId: state.lastPlay.playerId,
          playerName: state.lastPlay.playerName,
          claimedCount: state.lastPlay.claimedCount,
          claimedRank: state.lastPlay.claimedRank,
          emptiedHand: state.lastPlay.emptiedHand,
          cards: revealLastPlay ? state.lastPlay.cards : null
        }
      : null,
    pendingPenalty: state.pendingPenalty
      ? {
          callerId: state.pendingPenalty.callerId,
          callerName: state.pendingPenalty.callerName,
          accusedId: state.pendingPenalty.accusedId,
          accusedName: state.pendingPenalty.accusedName,
          revealedCards: state.pendingPenalty.revealedCards,
          wasLying: state.pendingPenalty.wasLying,
          verdictTag: state.pendingPenalty.verdictTag,
          isDevilTrap: state.pendingPenalty.isDevilTrap,
          targetPlayerIds: state.pendingPenalty.targetPlayerIds,
          emptiedHandCandidateId: state.pendingPenalty.emptiedHandCandidateId
        }
      : null,
    lastRouletteResult: state.lastRouletteResult,
    lastChallengeResolution: state.lastChallengeResolution,
    winnerId: state.winnerId,
    winnerName: state.winnerName,
    winnerReason: state.winnerReason,
    players: state.players.map((p) => ({
      id: p.id,
      seatIndex: p.seatIndex,
      name: p.name,
      isAI: p.isAI,
      isHost: Boolean(p.isHost),
      disconnected: Boolean(p.disconnected),
      persona: p.persona,
      avatarKey: p.avatarKey,
      titleVi: p.titleVi,
      alive: p.alive,
      safeForRound: p.safeForRound,
      handCount: p.hand.length,
      hand: p.id === viewerPlayerId || state.phase === PHASES.GAME_OVER ? p.hand : [],
      revolver: {
        shotsTaken: p.revolver.shotsTaken,
        maxChambers: p.revolver.maxChambers,
        survivalOddsNext: p.alive ? `${6 - p.revolver.shotsTaken - 1}/${6 - p.revolver.shotsTaken}` : '0/0',
        dangerRiskNext: p.alive ? `1/${6 - p.revolver.shotsTaken}` : 'ĐÃ LOẠI'
      },
      lastEmotion: p.lastEmotion,
      lastSpeech: p.lastSpeech,
      stats: p.stats
    })),
    actionLog: state.actionLog.slice(-30)
  };
}
