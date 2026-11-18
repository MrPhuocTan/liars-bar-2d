/**
 * Tactical AI Bot Heuristics for Liar's Bar 2D (Online Web Version)
 * Implements 3 distinct AI personalities:
 * 1. CALCULATED (Cáo Già): Card counting (tracks own matching cards + Jokers vs total possible 8 matching cards in 20-card deck)
 * 2. AGGRESSIVE (Sói Độc): High bluff rate, multi-card drops to empty hand fast, aggressive challenger
 * 3. CAUTIOUS (Heo Ngầu): Plays truthful cards first, bluffs only when forced, challenges empty-hand plays
 */

import { PHASES, SPECIAL_CARDS, WIN_MODES } from './gameEngine.js';
import { evaluateBestPokerHand } from './pokerEngine.js';

export const BOT_DIFFICULTIES = {
  GRADE_5: { key: 'GRADE_5', labelVi: 'Học sinh lớp 5', multiplier: 0.65 },
  MATH_MASTER: { key: 'MATH_MASTER', labelVi: 'Thạc sĩ toán học', multiplier: 1.15 },
  PROFESSOR_NGAU: { key: 'PROFESSOR_NGAU', labelVi: 'Giáo sư Ngâu', multiplier: 1.45 },
  EASY: { key: 'EASY', labelVi: 'Học sinh lớp 5', multiplier: 0.75 },
  NORMAL: { key: 'NORMAL', labelVi: 'Thạc sĩ toán học', multiplier: 1.0 },
  HARD: { key: 'HARD', labelVi: 'Giáo sư Ngâu', multiplier: 1.25 }
};

export const AI_PERSONAS = {
  CALCULATED: {
    key: 'CALCULATED',
    nameVi: 'Cáo Già (Hệ Tính Toán)',
    baseChallengeRate: 0.34,
    baseBluffRate: 0.30,
    emptyHandChallengeRate: 0.78
  },
  AGGRESSIVE: {
    key: 'AGGRESSIVE',
    nameVi: 'Sói Độc (Hệ Liều Lĩnh)',
    baseChallengeRate: 0.48,
    baseBluffRate: 0.56,
    emptyHandChallengeRate: 0.85
  },
  CAUTIOUS: {
    key: 'CAUTIOUS',
    nameVi: 'Heo Ngầu (Hệ Đa Nghi)',
    baseChallengeRate: 0.40,
    baseBluffRate: 0.18,
    emptyHandChallengeRate: 0.90
  }
};

/**
 * Computes the next deterministic or heuristic AI decision for aiPlayerId
 * @param {object} state - Full MatchState
 * @param {string} aiPlayerId - e.g. 'p1', 'p2', 'p3'
 * @param {() => number} [customRng] - Optional RNG override
 */
export function chooseAIAction(state, aiPlayerId, customRng = null) {
  const rng =
    typeof customRng === 'function'
      ? customRng
      : typeof state._rng === 'function'
      ? state._rng
      : Math.random;

  if (state.phase === PHASES.ROULETTE_PENALTY) {
    const targets = state.pendingPenalty?.targetPlayerIds || [];
    if (targets.includes(aiPlayerId)) {
      return {
        action: 'PULL_TRIGGER',
        playerId: aiPlayerId,
        reasoningVi: 'Đến lượt phải bóp cò súng lục Cò Quay Nga.'
      };
    }
  }

  if (state.phase === PHASES.ROUND_END) {
    return {
      action: 'NEXT_ROUND',
      playerId: aiPlayerId,
      reasoningVi: 'Bắt đầu ván bài mới.'
    };
  }

  const aiPlayer = state.players.find((p) => p.id === aiPlayerId);
  if (!aiPlayer || !aiPlayer.alive) {
    throw new Error(`AI player ${aiPlayerId} không hợp lệ hoặc đã bị loại.`);
  }

  const personaCfg = AI_PERSONAS[aiPlayer.persona] || AI_PERSONAS.CALCULATED;
  const difficultyMultiplier =
    (BOT_DIFFICULTIES[state.botDifficulty] || BOT_DIFFICULTIES.MATH_MASTER).multiplier;

  // Count how many truthful cards (tableRank + Joker) this AI holds in its own hand
  const matchingInHand = aiPlayer.hand.filter(
    (c) => c.rank === state.tableRank || c.rank === SPECIAL_CARDS.JOKER
  );
  const nonMatchingInHand = aiPlayer.hand.filter(
    (c) => c.rank !== state.tableRank && c.rank !== SPECIAL_CARDS.JOKER && c.rank !== SPECIAL_CARDS.DEVIL
  );
  const devilCardInHand = aiPlayer.hand.find((c) => c.rank === SPECIAL_CARDS.DEVIL);

  // Maximum truthful cards in the entire 20-card deck = 6 tableRank + (1 or 2 Jokers) = 7 or 8
  const maxPossibleTruthfulInDeck = (state.roundHasDevil || state.includeDevil) ? 7 : 8;

  // Phase 1: FINAL_CHALLENGE_WINDOW (Someone just emptied their hand or only 1 player has cards left!)
  if (state.phase === PHASES.FINAL_CHALLENGE_WINDOW) {
    if (state.winMode === WIN_MODES.CLASSIC_SURVIVAL) {
      return {
        action: 'CALL_LIAR',
        playerId: aiPlayerId,
        reasoningVi: 'Chế độ Sinh Tử: Người cuối cùng giữ bài bắt buộc phải Lật Bài!'
      };
    }

    // In EMPTY_HAND_WIN mode: if we pass, the opponent wins immediately!
    // Check mathematical impossibility first:
    const claimedCount = state.lastPlay?.claimedCount || 1;
    if (matchingInHand.length + claimedCount > maxPossibleTruthfulInDeck) {
      return {
        action: 'CALL_LIAR',
        playerId: aiPlayerId,
        reasoningVi: `Đếm bài phát hiện bất hợp lý tuyệt đối: trên tay có ${matchingInHand.length} lá thật mà đối thủ dám tuyên bố ${claimedCount} lá!`
      };
    }

    // High probability to challenge someone trying to win by emptying their hand, unless AI is at 5/6 revolver chamber and terrified
    const revolverRisk = aiPlayer.revolver.shotsTaken / 6;
    const challengeProb = Math.min(
      0.96,
      Math.max(0.45, personaCfg.emptyHandChallengeRate * difficultyMultiplier - revolverRisk * 0.25 + (claimedCount - 1) * 0.15)
    );

    if (rng() < challengeProb) {
      return {
        action: 'CALL_LIAR',
        playerId: aiPlayerId,
        reasoningVi: 'Quyết tâm Lật Bài chặn chiến thắng hết bài của đối phương!'
      };
    }

    return {
      action: 'PASS_FINAL',
      playerId: aiPlayerId,
      reasoningVi: 'Không dám mạo hiểm súng lục, đành Cho Qua lượt xét bài cuối.'
    };
  }

  // Phase 2: Normal TURN_PLAY_OR_CHALLENGE
  if (state.phase === PHASES.TURN_PLAY_OR_CHALLENGE) {
    // Consider challenging state.lastPlay if one exists
    if (state.lastPlay && state.lastPlay.playerId !== aiPlayerId) {
      const claimedCount = state.lastPlay.claimedCount;

      // 1. Mathematical card-counting certainty:
      if (matchingInHand.length + claimedCount > maxPossibleTruthfulInDeck) {
        return {
          action: 'CALL_LIAR',
          playerId: aiPlayerId,
          reasoningVi: `Đếm bài chuẩn xác: Tôi đang giữ ${matchingInHand.length} lá hợp lệ, đối phương không thể có đủ ${claimedCount} lá ${state.tableRank}!`
        };
      }

      // 2. If AI itself has 0 cards left (shouldn't happen in normal turn, safety fallback)
      if (aiPlayer.hand.length === 0) {
        return {
          action: 'CALL_LIAR',
          playerId: aiPlayerId,
          reasoningVi: 'Không còn bài trên tay, chọn Lật Bài.'
        };
      }

      // 3. Heuristic suspicion score based on claimedCount, center pile size, and own matching cards
      let suspicion = personaCfg.baseChallengeRate * difficultyMultiplier;
      if (claimedCount === 2) suspicion += 0.16;
      if (claimedCount === 3) suspicion += 0.34;
      if (matchingInHand.length >= 3) suspicion += 0.22;
      if (state.pileCount >= 8) suspicion += 0.15;
      // Reduce reckless challenges if AI is at high bullet risk (e.g. 4/6 or 5/6)
      if (aiPlayer.revolver.shotsTaken >= 4) suspicion -= 0.18;

      if (rng() < Math.min(0.88, Math.max(0.08, suspicion))) {
        return {
          action: 'CALL_LIAR',
          playerId: aiPlayerId,
          reasoningVi: `Nghi ngờ đối phương đánh láo ${claimedCount} lá ${state.tableRank}.`
        };
      }
    }

    // Otherwise, PLAY 1 to 3 cards from hand!
    // Check if AI wants to play the Devil Card solo as a trap:
    if (devilCardInHand && (matchingInHand.length === 0 || rng() < 0.45)) {
      return {
        action: 'PLAY',
        playerId: aiPlayerId,
        cardIds: [devilCardInHand.id],
        speechVi: `Đánh 1 lá ${state.tableRank} chuẩn đét, giỏi thì lật đi!`,
        reasoningVi: 'Tung lá Ác Quỷ (Devil) đơn lẻ để gài bẫy cả bàn.'
      };
    }

    // Can AI empty its hand right now with truthful cards? (1 to 3 matching cards == entire hand)
    if (
      aiPlayer.hand.length <= 3 &&
      matchingInHand.length === aiPlayer.hand.length &&
      matchingInHand.length > 0
    ) {
      return {
        action: 'PLAY',
        playerId: aiPlayerId,
        cardIds: matchingInHand.map((c) => c.id),
        speechVi: `Đánh hết ${matchingInHand.length} lá ${state.tableRank} cuối cùng! Ai dám xét?!`,
        reasoningVi: 'Đánh hết toàn bộ bài thật trên tay để giành chiến thắng!'
      };
    }

    // Decide whether to play truthfully or bluff
    const wantsToBluff = matchingInHand.length === 0 || rng() < personaCfg.baseBluffRate;

    if (!wantsToBluff && matchingInHand.length > 0) {
      // Play 1 or 2 truthful cards
      const maxTruthToPlay = Math.min(2, matchingInHand.length);
      const countToPlay = maxTruthToPlay > 1 && rng() < 0.45 ? 2 : 1;
      const chosen = matchingInHand.slice(0, countToPlay).map((c) => c.id);
      return {
        action: 'PLAY',
        playerId: aiPlayerId,
        cardIds: chosen,
        speechVi: `Đánh ${chosen.length} lá ${state.tableRank} thật 100%!`,
        reasoningVi: `Đánh an toàn ${chosen.length} lá hợp lệ.`
      };
    }

    // Bluffing move: pick 1–2 non-matching cards (or mix 1 matching + 1 non-matching)
    if (nonMatchingInHand.length > 0) {
      const canMix = matchingInHand.length > 0 && rng() < 0.35;
      if (canMix) {
        const chosen = [matchingInHand[0].id, nonMatchingInHand[0].id];
        return {
          action: 'PLAY',
          playerId: aiPlayerId,
          cardIds: chosen,
          speechVi: `Đánh 2 lá ${state.tableRank}, tin tôi đi!`,
          reasoningVi: 'Trộn 1 lá thật kèm 1 lá giả để tung hỏa mù.'
        };
      }

      const bluffCount =
        nonMatchingInHand.length >= 2 && aiPlayer.persona === 'AGGRESSIVE' && rng() < 0.4 ? 2 : 1;
      const chosen = nonMatchingInHand.slice(0, bluffCount).map((c) => c.id);
      return {
        action: 'PLAY',
        playerId: aiPlayerId,
        cardIds: chosen,
        speechVi: `Đặt nhẹ ${chosen.length} lá ${state.tableRank} xuống bàn!`,
        reasoningVi: `Tố láo ${chosen.length} lá bài khác chất để xả bài.`
      };
    }

    // Fallback: play first available card (if it's Devil, play solo)
    const fallbackCard = aiPlayer.hand[0];
    return {
      action: 'PLAY',
      playerId: aiPlayerId,
      cardIds: [fallbackCard.id],
      speechVi: `Đánh 1 lá ${state.tableRank}!`,
      reasoningVi: 'Đánh lá bài cuối cùng khả dụng trên tay.'
    };
  }

  throw new Error(`Không thể tính nước đi AI cho giai đoạn ${state.phase}.`);
}

export function choosePokerAIAction(state, aiPlayerId, customRng = null) {
  const rng =
    typeof customRng === 'function'
      ? customRng
      : typeof state._rng === 'function'
      ? state._rng
      : Math.random;

  if (state.phase === PHASES.ROULETTE_PENALTY) {
    if (state.pendingPenalty?.targetPlayerId === aiPlayerId) {
      return { action: 'PULL_TRIGGER', playerId: aiPlayerId };
    }
  }

  if (state.phase === PHASES.ROUND_END) {
    return { action: 'NEXT_ROUND', playerId: aiPlayerId };
  }

  const aiPlayer = state.players.find((p) => p.id === aiPlayerId);
  if (!aiPlayer || !aiPlayer.alive || aiPlayer.folded) {
    throw new Error(`Poker AI ${aiPlayerId} không hợp lệ hoặc đã bỏ bài.`);
  }

  const diffMult = (BOT_DIFFICULTIES[state.botDifficulty] || BOT_DIFFICULTIES.MATH_MASTER).multiplier;
  const revealedCommunity = state.communityCards.slice(0, state.revealedCommunityCount);
  const myEval = evaluateBestPokerHand([...aiPlayer.hand, ...revealedCommunity]);

  // Consider calling bluff if previous claim is suspiciously high
  if (state.lastClaim && state.lastClaim.playerId !== aiPlayerId) {
    const claimedRank = state.lastClaim.handRank;
    const bluffThreshold = claimedRank >= 4 ? 0.55 : claimedRank >= 2 ? 0.25 : 0.10;
    if (rng() < bluffThreshold * Math.min(1.2, diffMult)) {
      return { action: 'CALL_BLUFF', playerId: aiPlayerId };
    }
  }

  // Consider using Switch if hand is weak (High Card) and switches remain
  if (aiPlayer.switchesLeft > 0 && myEval.category === 0 && !aiPlayer.usedSwitchThisTurn && rng() < 0.45) {
    const lowestCard = [...aiPlayer.hand].sort((a, b) => a.value - b.value)[0];
    return { action: 'SWITCH', playerId: aiPlayerId, cardId: lowestCard?.id };
  }

  // Fold if stake is very high (>= 4) and hand is weak and revolver is risky
  if (state.currentStake >= 4 && myEval.category === 0 && aiPlayer.revolver.shotsTaken >= 3 && rng() < 0.35) {
    return { action: 'FOLD', playerId: aiPlayerId };
  }

  // Raise or bluff raise
  const canRaise = state.currentStake < 6;
  const wantRaise =
    canRaise &&
    ((myEval.category >= 2 && rng() < 0.45 * diffMult) || (rng() < 0.18 * diffMult));

  if (wantRaise) {
    const minClaim = state.lastClaim ? state.lastClaim.handRank : 1;
    const claimRank = Math.min(9, Math.max(minClaim, myEval.category + (rng() < 0.35 ? 1 : 0)));
    return {
      action: 'RAISE',
      playerId: aiPlayerId,
      claimedHandRank: claimRank
    };
  }

  return { action: 'CHECK_CALL', playerId: aiPlayerId };
}
