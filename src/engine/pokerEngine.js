/**
 * Poker Liar Bar — Server-Authoritative Deterministic Engine
 * Combines Texas Hold'em community-card Poker with Liar's Bar bluff claims,
 * tactical Switch, Bullet Betting (1-6 chambers), Call Bluff, Showdown,
 * and 6-chamber Russian Roulette with 5% "Hú hồn" dodge at chamber 6.
 */

import { createSeededRNG, shuffleArray, PHASES } from './gameEngine.js';

export const POKER_SUITS = ['S', 'H', 'D', 'C']; // Spades, Hearts, Diamonds, Clubs
export const POKER_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const POKER_HAND_NAMES_VI = [
  'Mậu Thầu (High Card)',
  'Một Đôi (Pair)',
  'Hai Đôi (Two Pair)',
  'Sám Cô (Three of a Kind)',
  'Sảnh (Straight)',
  'Thùng (Flush)',
  'Cù Lũ (Full House)',
  'Tứ Quý (Four of a Kind)',
  'Thùng Phá Sảnh (Straight Flush)',
  'Sảnh Chúa (Royal Flush)'
];

export const POKER_STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN'];

const RANK_VALUES = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14
};

export function buildPokerDeck() {
  const deck = [];
  for (const suit of POKER_SUITS) {
    for (const rank of POKER_RANKS) {
      deck.push({
        id: `${rank}${suit}`,
        rank,
        suit,
        value: RANK_VALUES[rank],
        labelVi: `${rank}${suitSymbol(suit)}`
      });
    }
  }
  return deck;
}

function suitSymbol(suit) {
  if (suit === 'S') return '♠';
  if (suit === 'H') return '♥';
  if (suit === 'D') return '♦';
  return '♣';
}

function nextRandom(state) {
  if (typeof state._rng !== 'function') {
    const baseSeed = (state.seed || 1337) + (state.rngStateCalls || 0) * 9973;
    state._rng = createSeededRNG(baseSeed);
  }
  state.rngStateCalls = (state.rngStateCalls || 0) + 1;
  return state._rng();
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
  if (state.actionLog.length > 80) state.actionLog.shift();
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

/**
 * Evaluates a 5-card Poker hand -> { category: 0..9, tiebreakers: number[], score: number, nameVi: string }
 */
export function evaluate5CardHand(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map((c) => c.value);
  const suits = sorted.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);

  let isStraight = false;
  let straightHigh = values[0];
  const uniqueVals = [...new Set(values)];
  if (uniqueVals.length === 5) {
    if (values[0] - values[4] === 4) {
      isStraight = true;
      straightHigh = values[0];
    } else if (values[0] === 14 && values[1] === 5 && values[2] === 4 && values[3] === 3 && values[4] === 2) {
      // Wheel A-2-3-4-5
      isStraight = true;
      straightHigh = 5;
    }
  }

  const countsMap = new Map();
  for (const v of values) {
    countsMap.set(v, (countsMap.get(v) || 0) + 1);
  }
  const groups = [...countsMap.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  let category = 0;
  let tiebreakers = values;

  if (isFlush && isStraight) {
    category = straightHigh === 14 ? 9 : 8;
    tiebreakers = [straightHigh];
  } else if (groups[0][1] === 4) {
    category = 7;
    tiebreakers = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    category = 6;
    tiebreakers = [groups[0][0], groups[1][0]];
  } else if (isFlush) {
    category = 5;
    tiebreakers = values;
  } else if (isStraight) {
    category = 4;
    tiebreakers = [straightHigh];
  } else if (groups[0][1] === 3) {
    category = 3;
    tiebreakers = [groups[0][0], ...groups.slice(1).map((g) => g[0])];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    category = 2;
    tiebreakers = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2) {
    category = 1;
    tiebreakers = [groups[0][0], ...groups.slice(1).map((g) => g[0])];
  } else {
    category = 0;
    tiebreakers = values;
  }

  let score = category * 1e10;
  for (let i = 0; i < tiebreakers.length; i += 1) {
    score += tiebreakers[i] * Math.pow(16, 4 - i);
  }

  return {
    category,
    tiebreakers,
    score,
    nameVi: POKER_HAND_NAMES_VI[category]
  };
}

/**
 * Finds the best 5-card hand from 2..7 available cards.
 */
export function evaluateBestPokerHand(cards) {
  if (!cards || cards.length < 5) {
    // Pre-flop (only 2 hole cards): evaluate pair or high card
    const sorted = [...(cards || [])].sort((a, b) => b.value - a.value);
    if (sorted.length >= 2 && sorted[0].value === sorted[1].value) {
      return {
        category: 1,
        tiebreakers: [sorted[0].value],
        score: 1 * 1e10 + sorted[0].value * Math.pow(16, 4),
        nameVi: POKER_HAND_NAMES_VI[1]
      };
    }
    const high = sorted[0]?.value || 0;
    return {
      category: 0,
      tiebreakers: sorted.map((c) => c.value),
      score: high * Math.pow(16, 4),
      nameVi: POKER_HAND_NAMES_VI[0]
    };
  }

  let best = null;
  const n = cards.length;
  for (let i = 0; i < n - 4; i += 1) {
    for (let j = i + 1; j < n - 3; j += 1) {
      for (let k = j + 1; k < n - 2; k += 1) {
        for (let l = k + 1; l < n - 1; l += 1) {
          for (let m = l + 1; m < n; m += 1) {
            const evalRes = evaluate5CardHand([cards[i], cards[j], cards[k], cards[l], cards[m]]);
            if (!best || evalRes.score > best.score) {
              best = evalRes;
            }
          }
        }
      }
    }
  }
  return best;
}

export function createPokerMatchState(options = {}) {
  const {
    roomId = 'POKER-101',
    roomName = 'Bàn Poker Tử Thần',
    players: customPlayers = null,
    playerCount = 4,
    botDifficulty = 'MATH_MASTER',
    turnTimeSeconds = 60,
    seed = Date.now()
  } = options;

  const rng = createSeededRNG(seed);
  const defaultTemplates = [
    { id: 'p0', name: 'Bạn (Tay Chơi)', isAI: false, avatarKey: 'human', persona: 'HUMAN' },
    { id: 'p1', name: 'Cáo Già (Foxy)', isAI: true, avatarKey: 'fox', persona: 'CALCULATED' },
    { id: 'p2', name: 'Sói Độc (Wolf)', isAI: true, avatarKey: 'wolf', persona: 'AGGRESSIVE' },
    { id: 'p3', name: 'Heo Ngầu (Boar)', isAI: true, avatarKey: 'pig', persona: 'CAUTIOUS' }
  ];

  const sourceList =
    Array.isArray(customPlayers) && customPlayers.length >= 2
      ? customPlayers.slice(0, 4)
      : defaultTemplates.slice(0, Math.min(4, Math.max(2, Number(playerCount) || 4)));

  const players = sourceList.map((cp, idx) => ({
    id: cp.id,
    seatIndex: idx,
    name: String(cp.name || `Người chơi ${idx + 1}`).trim(),
    isAI: Boolean(cp.isAI),
    isHost: Boolean(cp.isHost ?? idx === 0),
    disconnected: false,
    persona: cp.persona || 'CALCULATED',
    avatarKey: cp.avatarKey || 'human',
    alive: true,
    folded: false,
    actedThisStreet: false,
    usedSwitchThisTurn: false,
    switchesLeft: 2,
    committedBullets: 1,
    hand: [],
    revolver: {
      chamberIndex: 0,
      bulletIndex: Math.floor(rng() * 6),
      shotsTaken: 0,
      maxChambers: 6
    },
    lastEmotion: 'neutral',
    lastSpeech: '',
    stats: {
      raisesMade: 0,
      bluffsCalled: 0,
      triggersPulled: 0,
      subRoundWins: 0,
      miracleDodges: 0
    }
  }));

  const state = {
    gameType: 'POKER_LIAR_BAR',
    roomId,
    roomName,
    seed: Number(seed) || 1337,
    rngStateCalls: 0,
    botDifficulty,
    turnTimeSeconds: Number(turnTimeSeconds) || 60,
    roundNumber: 0,
    phase: PHASES.LOBBY,
    street: 'PREFLOP',
    currentTurnIndex: 0,
    roundStarterIndex: 0,
    currentStake: 1,
    deck: [],
    communityCards: [],
    revealedCommunityCount: 0,
    lastClaim: null,
    pendingPenalty: null,
    lastRouletteResult: null,
    lastShowdown: null,
    eventSeq: 0,
    lastEvent: null,
    winnerId: null,
    winnerName: null,
    winnerReason: null,
    players,
    actionLog: [],
    _rng: rng
  };

  appendLog(state, 'MATCH_START', `Khởi tạo bàn Poker Liar Bar "${roomName}" — Cược bằng đạn, sinh tồn đến người cuối cùng!`);
  return startNewPokerRound(state);
}

function findNextActivePokerIndex(state, fromIndex) {
  const count = state.players.length;
  for (let offset = 1; offset <= count; offset += 1) {
    const idx = (fromIndex + offset) % count;
    const p = state.players[idx];
    if (p.alive && !p.folded) {
      return idx;
    }
  }
  return fromIndex;
}

export function startNewPokerRound(state) {
  if (state.phase === PHASES.GAME_OVER) return state;

  const alivePlayers = state.players.filter((p) => p.alive);
  if (alivePlayers.length <= 1) {
    state.phase = PHASES.GAME_OVER;
    if (alivePlayers.length === 1) {
      state.winnerId = alivePlayers[0].id;
      state.winnerName = alivePlayers[0].name;
      state.winnerReason = 'LAST_SURVIVOR_VICTORY';
      alivePlayers[0].lastEmotion = 'victory';
      appendLog(state, 'GAME_OVER', `[CHIẾN THẮNG] ${alivePlayers[0].name} là người sống sót cuối cùng!`);
    }
    return state;
  }

  state.roundNumber += 1;
  state.street = 'PREFLOP';
  state.currentStake = 1;
  state.lastClaim = null;
  state.pendingPenalty = null;
  state.lastRouletteResult = null;
  state.lastShowdown = null;

  const shuffled = shuffleArray(buildPokerDeck(), () => nextRandom(state));
  let cursor = 0;

  for (const p of state.players) {
    if (p.alive) {
      p.hand = shuffled.slice(cursor, cursor + 2);
      cursor += 2;
      p.folded = false;
      p.actedThisStreet = false;
      p.usedSwitchThisTurn = false;
      p.switchesLeft = 2;
      p.committedBullets = 1;
      p.lastEmotion = p.revolver.shotsTaken >= 3 ? 'sweat' : 'neutral';
      p.lastSpeech = '';
    } else {
      p.hand = [];
      p.folded = true;
      p.lastEmotion = 'dead';
      p.lastSpeech = '';
    }
  }

  state.communityCards = shuffled.slice(cursor, cursor + 5);
  cursor += 5;
  state.deck = shuffled.slice(cursor);
  state.revealedCommunityCount = 0;

  let starterIdx = state.roundNumber === 1 ? 0 : (state.roundStarterIndex + 1) % state.players.length;
  if (!state.players[starterIdx]?.alive) {
    starterIdx = findNextActivePokerIndex(state, starterIdx);
  }
  state.roundStarterIndex = starterIdx;
  state.currentTurnIndex = starterIdx;
  state.phase = PHASES.TURN_PLAY_OR_CHALLENGE;

  const starter = state.players[starterIdx];
  appendLog(state, 'ROUND_START', `Ván con #${state.roundNumber} (Poker Liar Bar) bắt đầu! Mức cược khởi điểm: 1 viên đạn. Lượt của ${starter.name}.`);
  recordEvent(state, 'DEAL_ROUND', {
    gameType: 'POKER_LIAR_BAR',
    roundNumber: state.roundNumber,
    starterId: starter.id,
    starterName: starter.name
  });

  return state;
}

function advanceStreetOrShowdown(state) {
  const activePlayers = state.players.filter((p) => p.alive && !p.folded);
  if (activePlayers.length <= 1) {
    // Everyone else folded; last active player wins sub-round safely
    state.phase = PHASES.ROUND_END;
    return state;
  }

  for (const p of activePlayers) {
    p.actedThisStreet = false;
    p.usedSwitchThisTurn = false;
  }

  if (state.street === 'PREFLOP') {
    state.street = 'FLOP';
    state.revealedCommunityCount = 3;
  } else if (state.street === 'FLOP') {
    state.street = 'TURN';
    state.revealedCommunityCount = 4;
  } else if (state.street === 'TURN') {
    state.street = 'RIVER';
    state.revealedCommunityCount = 5;
  } else if (state.street === 'RIVER') {
    return resolvePokerShowdown(state);
  }

  state.currentTurnIndex = state.players[state.roundStarterIndex]?.alive && !state.players[state.roundStarterIndex]?.folded
    ? state.roundStarterIndex
    : findNextActivePokerIndex(state, state.roundStarterIndex);

  appendLog(state, 'STREET_REVEAL', `Mở bài chung vòng ${state.street} (${state.revealedCommunityCount}/5 lá). Cược hiện tại: ${state.currentStake} viên đạn.`);
  recordEvent(state, 'STREET_REVEAL', {
    street: state.street,
    revealedCommunityCount: state.revealedCommunityCount
  });
  return state;
}

function resolvePokerShowdown(state) {
  state.street = 'SHOWDOWN';
  state.revealedCommunityCount = 5;

  const activePlayers = state.players.filter((p) => p.alive && !p.folded);
  const evaluations = activePlayers.map((p) => ({
    player: p,
    evalResult: evaluateBestPokerHand([...p.hand, ...state.communityCards])
  }));

  evaluations.sort((a, b) => a.evalResult.score - b.evalResult.score);
  const loserEntry = evaluations[0];
  const winnerEntry = evaluations[evaluations.length - 1];

  winnerEntry.player.stats.subRoundWins += 1;
  winnerEntry.player.lastEmotion = 'victory';
  winnerEntry.player.lastSpeech = `Bài tôi ${winnerEntry.evalResult.nameVi}!`;

  loserEntry.player.lastEmotion = 'shock';
  loserEntry.player.lastSpeech = `Thua Showdown (${loserEntry.evalResult.nameVi})! Phải bắn ${state.currentStake} phát...`;

  state.lastShowdown = {
    results: evaluations.map((e) => ({
      playerId: e.player.id,
      playerName: e.player.name,
      hand: e.player.hand,
      handNameVi: e.evalResult.nameVi,
      category: e.evalResult.category
    })),
    loserId: loserEntry.player.id,
    loserName: loserEntry.player.name,
    winnerId: winnerEntry.player.id,
    winnerName: winnerEntry.player.name
  };

  state.pendingPenalty = {
    reason: 'SHOWDOWN_LOSS',
    targetPlayerId: loserEntry.player.id,
    targetPlayerIds: [loserEntry.player.id],
    shotsRemaining: state.currentStake,
    totalShots: state.currentStake
  };
  state.phase = PHASES.ROULETTE_PENALTY;

  appendLog(
    state,
    'SHOWDOWN',
    `[SHOWDOWN] ${winnerEntry.player.name} thắng (${winnerEntry.evalResult.nameVi})! ${loserEntry.player.name} yếu nhất (${loserEntry.evalResult.nameVi}) phải bắn ${state.currentStake} phát đạn!`
  );
  recordEvent(state, 'POKER_SHOWDOWN', {
    ...state.lastShowdown,
    stake: state.currentStake
  });

  return state;
}

export function performPokerAction(state, playerId, actionPayload = {}) {
  const { action } = actionPayload;
  if (state.phase !== PHASES.TURN_PLAY_OR_CHALLENGE) {
    throw new Error('Không thể thực hiện hành động Poker ở giai đoạn hiện tại.');
  }

  const activePlayer = state.players[state.currentTurnIndex];
  if (!activePlayer || activePlayer.id !== playerId) {
    throw new Error(`Chưa tới lượt của bạn (Hiện là lượt của ${activePlayer?.name}).`);
  }

  if (action === 'SWITCH') {
    if (activePlayer.switchesLeft <= 0) {
      throw new Error('Bạn đã hết lượt Đổi bài (Switch) trong ván con này.');
    }
    if (state.deck.length === 0) {
      throw new Error('Bộ bài đã hết lá để đổi.');
    }
    const cardId = actionPayload.cardId || activePlayer.hand[0]?.id;
    const cardIdx = activePlayer.hand.findIndex((c) => c.id === cardId);
    if (cardIdx < 0) {
      throw new Error('Không tìm thấy lá bài để đổi.');
    }
    const newCard = state.deck.shift();
    activePlayer.hand[cardIdx] = newCard;
    activePlayer.switchesLeft -= 1;
    activePlayer.usedSwitchThisTurn = true;
    activePlayer.lastSpeech = 'Đổi 1 lá bài chiến thuật!';
    appendLog(state, 'POKER_SWITCH', `${activePlayer.name} đã dùng Switch đổi 1 lá bài.`);
    recordEvent(state, 'POKER_ACTION', { playerId, action: 'SWITCH' });
    return state;
  }

  if (action === 'FOLD') {
    activePlayer.folded = true;
    activePlayer.lastEmotion = 'sweat';
    activePlayer.lastSpeech = 'Bỏ bài (Fold)! Chịu phạt 1 phát đạn...';
    state.pendingPenalty = {
      reason: 'COWARD_FOLD',
      targetPlayerId: activePlayer.id,
      targetPlayerIds: [activePlayer.id],
      shotsRemaining: 1,
      totalShots: 1
    };
    state.phase = PHASES.ROULETTE_PENALTY;
    appendLog(state, 'POKER_FOLD', `${activePlayer.name} Bỏ bài (Coward Fold) và phải bắn 1 phát Cò Quay Nga!`);
    recordEvent(state, 'POKER_ACTION', { playerId, action: 'FOLD' });
    return state;
  }

  if (action === 'CALL_BLUFF') {
    if (!state.lastClaim || state.lastClaim.playerId === playerId) {
      throw new Error('Chưa có lời tuyên bố bài nào của đối thủ để Bắt Liar!');
    }
    const accused = state.players.find((p) => p.id === state.lastClaim.playerId);
    const revealedCommunity = state.communityCards.slice(0, state.revealedCommunityCount);
    const accusedEval = evaluateBestPokerHand([...accused.hand, ...revealedCommunity]);
    const claimedRank = state.lastClaim.handRank;
    const wasLying = accusedEval.category < claimedRank;

    activePlayer.stats.bluffsCalled += 1;
    const loser = wasLying ? accused : activePlayer;
    const winner = wasLying ? activePlayer : accused;

    winner.lastEmotion = 'smirk';
    loser.lastEmotion = 'shock';
    loser.lastSpeech = wasLying ? 'Bị bắt quả tang nói dối!' : 'Bắt nhầm rồi, bài tôi thật!';

    state.lastShowdown = {
      results: [
        {
          playerId: accused.id,
          playerName: accused.name,
          hand: accused.hand,
          handNameVi: accusedEval.nameVi,
          category: accusedEval.category
        }
      ],
      wasLying,
      claimedHandNameVi: POKER_HAND_NAMES_VI[claimedRank],
      loserId: loser.id,
      loserName: loser.name,
      winnerId: winner.id,
      winnerName: winner.name
    };

    state.pendingPenalty = {
      reason: wasLying ? 'CAUGHT_BLUFFING' : 'FAILED_BLUFF_CALL',
      targetPlayerId: loser.id,
      targetPlayerIds: [loser.id],
      shotsRemaining: state.currentStake,
      totalShots: state.currentStake
    };
    state.phase = PHASES.ROULETTE_PENALTY;

    appendLog(
      state,
      'CALL_BLUFF',
      `[BẮT LIAR POKER] ${activePlayer.name} bắt bài ${accused.name} (tuyên bố ${POKER_HAND_NAMES_VI[claimedRank]}, thực tế: ${accusedEval.nameVi}) -> ${loser.name} thua và phải bắn ${state.currentStake} phát!`
    );
    recordEvent(state, 'POKER_BLUFF_REVEAL', {
      ...state.lastShowdown,
      stake: state.currentStake
    });
    return state;
  }

  if (action === 'RAISE' || action === 'ALL_IN') {
    if (action === 'ALL_IN' && activePlayer.usedSwitchThisTurn) {
      throw new Error('Luật Poker Liar Bar: Không được All-In trong cùng lượt vừa dùng Switch!');
    }
    if (state.currentStake >= 6) {
      throw new Error('Mức cược đã đạt tối đa 6 viên đạn.');
    }
    const nextStake = action === 'ALL_IN' ? 6 : Math.min(6, state.currentStake + 1);
    const minClaim = state.lastClaim ? state.lastClaim.handRank : 1;
    const claimedRank = Math.min(9, Math.max(minClaim, Number(actionPayload.claimedHandRank ?? minClaim)));

    state.currentStake = nextStake;
    activePlayer.committedBullets = nextStake;
    activePlayer.actedThisStreet = true;
    activePlayer.stats.raisesMade += 1;
    activePlayer.usedSwitchThisTurn = false;
    activePlayer.lastSpeech =
      action === 'ALL_IN'
        ? `ALL-IN ${nextStake} ĐẠN! Tôi có ${POKER_HAND_NAMES_VI[claimedRank]}!`
        : `Tăng cược ${nextStake} đạn! Tôi có ${POKER_HAND_NAMES_VI[claimedRank]}!`;

    state.lastClaim = {
      playerId: activePlayer.id,
      playerName: activePlayer.name,
      handRank: claimedRank,
      handNameVi: POKER_HAND_NAMES_VI[claimedRank],
      stake: nextStake
    };

    // Other active players must act again to match the new stake
    for (const p of state.players) {
      if (p.alive && !p.folded && p.id !== activePlayer.id) {
        p.actedThisStreet = false;
      }
    }

    appendLog(state, 'POKER_RAISE', `${activePlayer.name}: ${activePlayer.lastSpeech}`);
    recordEvent(state, 'POKER_ACTION', {
      playerId,
      action,
      stake: nextStake,
      claimedHandNameVi: POKER_HAND_NAMES_VI[claimedRank]
    });
  } else if (action === 'CHECK_CALL') {
    activePlayer.committedBullets = state.currentStake;
    activePlayer.actedThisStreet = true;
    activePlayer.usedSwitchThisTurn = false;
    activePlayer.lastSpeech = state.currentStake > 1 ? `Theo cược (${state.currentStake} đạn)` : 'Xem bài (Check)';
    appendLog(state, 'POKER_CALL', `${activePlayer.name}: ${activePlayer.lastSpeech}`);
    recordEvent(state, 'POKER_ACTION', { playerId, action: 'CHECK_CALL', stake: state.currentStake });
  } else {
    throw new Error(`Hành động Poker không hợp lệ: ${action}`);
  }

  // Check if all active players have acted and matched stake
  const activePlayers = state.players.filter((p) => p.alive && !p.folded);
  const allMatched = activePlayers.every((p) => p.actedThisStreet && p.committedBullets === state.currentStake);

  if (allMatched) {
    return advanceStreetOrShowdown(state);
  }

  state.currentTurnIndex = findNextActivePokerIndex(state, state.currentTurnIndex);
  return state;
}

export function pullPokerTrigger(state, targetPlayerId, options = {}) {
  if (state.phase !== PHASES.ROULETTE_PENALTY || !state.pendingPenalty) {
    throw new Error('Không có hình phạt đạn nào đang chờ.');
  }
  if (state.pendingPenalty.targetPlayerId !== targetPlayerId) {
    throw new Error(`Chưa tới lượt ${targetPlayerId} bóp cò.`);
  }

  const player = state.players.find((p) => p.id === targetPlayerId);
  if (!player || !player.alive) {
    throw new Error('Người chơi không tồn tại hoặc đã bị loại.');
  }

  const currentChamber = player.revolver.chamberIndex;
  const hitBullet = currentChamber === player.revolver.bulletIndex;
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
    player.stats.miracleDodges += 1;
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
    outcomeType,
    isFatal,
    isMiracleDodge,
    shotsTaken: player.revolver.shotsTaken,
    maxChambers: 6,
    oddsLabel: `${player.revolver.shotsTaken}/6`
  };

  recordEvent(state, 'ROULETTE_SHOT', { ...state.lastRouletteResult });
  appendLog(
    state,
    'ROULETTE_SHOT',
    isMiracleDodge
      ? `[HÚ HỒN!] ${player.name} né được viên đạn thứ 6: "Hú hồn, may mà né được, lêu lêu con gà kia!"`
      : isFatal
      ? `[ĐOÀNG!!] ${player.name} trúng đạn và bị loại khỏi bàn!`
      : `[TÁCH!] ${player.name} thoát chết (${player.revolver.shotsTaken}/6)!`
  );

  state.pendingPenalty.shotsRemaining -= 1;

  // Stop shooting if dead, dodged, or finished all stake shots
  if (!isFatal && !isMiracleDodge && state.pendingPenalty.shotsRemaining > 0) {
    return state;
  }

  const alivePlayers = state.players.filter((p) => p.alive);
  if (alivePlayers.length === 1) {
    const survivor = alivePlayers[0];
    survivor.lastEmotion = 'victory';
    state.phase = PHASES.GAME_OVER;
    state.winnerId = survivor.id;
    state.winnerName = survivor.name;
    state.winnerReason = 'LAST_SURVIVOR_VICTORY';
    appendLog(state, 'GAME_OVER', `[CHIẾN THẮNG] ${survivor.name} là người sống sót cuối cùng!`);
    return state;
  }

  // If player folded mid-round and >= 2 active players remain, check street completion or advance turn!
  const activeRemaining = state.players.filter((p) => p.alive && !p.folded);
  if (state.pendingPenalty.reason === 'COWARD_FOLD' && activeRemaining.length >= 2) {
    return resumeOrAdvancePokerStreet(state, activeRemaining);
  }

  state.pendingPenalty = null;
  state.roundStarterIndex = player.alive
    ? state.players.findIndex((p) => p.id === player.id)
    : findNextActivePokerIndex(state, state.currentTurnIndex);
  state.phase = PHASES.ROUND_END;
  return state;
}

function resumeOrAdvancePokerStreet(state, activeRemaining) {
  state.pendingPenalty = null;
  state.phase = PHASES.TURN_PLAY_OR_CHALLENGE;
  const allMatched = activeRemaining.every((p) => p.actedThisStreet && p.committedBullets === state.currentStake);
  if (allMatched) {
    return advanceStreetOrShowdown(state);
  }
  state.currentTurnIndex = findNextActivePokerIndex(state, state.currentTurnIndex);
  return state;
}

/**
 * Resolves mid-match player forfeit in Poker Liar Bar without soft-locking when >= 2 alive players remain.
 */
export function handlePokerPlayerForfeit(state, playerId) {
  if (!state || state.phase === PHASES.GAME_OVER) return state;
  const mp = state.players.find((p) => p.id === playerId);
  if (mp) {
    mp.alive = false;
    mp.folded = true;
    mp.hand = [];
  }

  const activeRemaining = state.players.filter((p) => p.alive && !p.folded);

  if (state.phase === PHASES.ROULETTE_PENALTY && state.pendingPenalty) {
    if (state.pendingPenalty.targetPlayerId === playerId) {
      const { reason } = state.pendingPenalty;
      state.pendingPenalty = null;
      if (reason === 'COWARD_FOLD' && activeRemaining.length >= 2) {
        return resumeOrAdvancePokerStreet(state, activeRemaining);
      }
      const nextAliveIdx = state.players.findIndex((p) => p.alive);
      state.roundStarterIndex = nextAliveIdx >= 0 ? nextAliveIdx : 0;
      state.phase = PHASES.ROUND_END;
    }
    return state;
  }

  if (state.phase === PHASES.TURN_PLAY_OR_CHALLENGE) {
    if (state.lastClaim?.playerId === playerId) {
      state.lastClaim = null;
    }
    if (activeRemaining.length <= 1) {
      const nextAliveIdx = state.players.findIndex((p) => p.alive);
      state.roundStarterIndex = nextAliveIdx >= 0 ? nextAliveIdx : 0;
      state.phase = PHASES.ROUND_END;
      return state;
    }
    const allMatched = activeRemaining.every((p) => p.actedThisStreet && p.committedBullets === state.currentStake);
    if (allMatched) {
      return advanceStreetOrShowdown(state);
    }
    if (state.players[state.currentTurnIndex]?.id === playerId) {
      state.currentTurnIndex = findNextActivePokerIndex(state, state.currentTurnIndex);
    }
  }

  return state;
}

export function getPokerPublicState(state, viewerPlayerId) {
  const revealAllHands =
    state.phase === PHASES.ROULETTE_PENALTY ||
    state.phase === PHASES.ROUND_END ||
    state.phase === PHASES.GAME_OVER;

  return {
    gameType: 'POKER_LIAR_BAR',
    roomId: state.roomId,
    roomName: state.roomName,
    botDifficulty: state.botDifficulty,
    turnTimeSeconds: state.turnTimeSeconds,
    roundNumber: state.roundNumber,
    phase: state.phase,
    street: state.street,
    currentStake: state.currentStake,
    currentTurnIndex: state.currentTurnIndex,
    currentTurnPlayerId: state.players[state.currentTurnIndex]?.id || null,
    communityCards: state.communityCards.slice(0, state.revealedCommunityCount),
    revealedCommunityCount: state.revealedCommunityCount,
    lastClaim: state.lastClaim,
    pendingPenalty: state.pendingPenalty,
    lastRouletteResult: state.lastRouletteResult,
    lastShowdown: state.lastShowdown,
    eventSeq: state.eventSeq,
    lastEvent: state.lastEvent,
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
      avatarKey: p.avatarKey,
      alive: p.alive,
      folded: p.folded,
      switchesLeft: p.switchesLeft,
      usedSwitchThisTurn: p.usedSwitchThisTurn,
      committedBullets: p.committedBullets,
      handCount: p.hand.length,
      hand:
        p.id === viewerPlayerId || (revealAllHands && state.lastShowdown?.results?.some((r) => r.playerId === p.id))
          ? p.hand
          : [],
      revolver: {
        shotsTaken: p.revolver.shotsTaken,
        maxChambers: p.revolver.maxChambers,
        dangerRiskNext: p.alive ? `1/${6 - p.revolver.shotsTaken}` : 'ĐÃ LOẠI'
      },
      lastEmotion: p.lastEmotion,
      lastSpeech: p.lastSpeech,
      stats: p.stats
    })),
    actionLog: state.actionLog.slice(-30)
  };
}
