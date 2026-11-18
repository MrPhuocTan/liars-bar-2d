import test from 'node:test';
import assert from 'node:assert/strict';

import { PHASES } from '../src/engine/gameEngine.js';
import {
  buildPokerDeck,
  evaluate5CardHand,
  createPokerMatchState,
  performPokerAction,
  pullPokerTrigger,
  getPokerPublicState
} from '../src/engine/pokerEngine.js';
import { choosePokerAIAction } from '../src/engine/aiBot.js';

test('PK-01: 52-card Poker deck & 5-card hand evaluator rankings', () => {
  const deck = buildPokerDeck();
  assert.equal(deck.length, 52);

  const royal = evaluate5CardHand([
    { rank: 'A', suit: 'S', value: 14 },
    { rank: 'K', suit: 'S', value: 13 },
    { rank: 'Q', suit: 'S', value: 12 },
    { rank: 'J', suit: 'S', value: 11 },
    { rank: '10', suit: 'S', value: 10 }
  ]);
  assert.equal(royal.category, 9);

  const fullHouse = evaluate5CardHand([
    { rank: 'K', suit: 'S', value: 13 },
    { rank: 'K', suit: 'H', value: 13 },
    { rank: 'K', suit: 'D', value: 13 },
    { rank: '7', suit: 'C', value: 7 },
    { rank: '7', suit: 'S', value: 7 }
  ]);
  assert.equal(fullHouse.category, 6);
  assert.ok(royal.score > fullHouse.score);
});

test('PK-02: Switch + All-In restriction & Coward Fold 1-bullet penalty', () => {
  const match = createPokerMatchState({ seed: 123, playerCount: 2 });
  assert.equal(match.players[0].hand.length, 2);
  assert.equal(match.revealedCommunityCount, 0);

  // Switch 1 card
  const firstCardId = match.players[0].hand[0].id;
  performPokerAction(match, 'p0', { action: 'SWITCH', cardId: firstCardId });
  assert.equal(match.players[0].switchesLeft, 1);
  assert.equal(match.players[0].usedSwitchThisTurn, true);

  // Cannot All-In on same turn as Switch
  assert.throws(
    () => performPokerAction(match, 'p0', { action: 'ALL_IN', claimedHandRank: 3 }),
    /Không được All-In/
  );

  // Coward Fold triggers 1-bullet roulette
  performPokerAction(match, 'p0', { action: 'FOLD' });
  assert.equal(match.phase, PHASES.ROULETTE_PENALTY);
  assert.equal(match.pendingPenalty.shotsRemaining, 1);
  pullPokerTrigger(match, 'p0', { forceFatal: false });
});

test('PK-03: Full Street Progression (Pre-Flop -> Flop -> Turn -> River -> Showdown) & Private Hand Isolation', () => {
  const match = createPokerMatchState({ seed: 777, playerCount: 2 });

  // Private hand isolation: p0 must not see p1's hand!
  const p0View = getPokerPublicState(match, 'p0');
  assert.equal(p0View.players[0].hand.length, 2);
  assert.equal(p0View.players[1].hand.length, 0);
  assert.equal(p0View.communityCards.length, 0);

  // Pre-flop check/call
  performPokerAction(match, 'p0', { action: 'CHECK_CALL' });
  performPokerAction(match, 'p1', { action: 'CHECK_CALL' });
  assert.equal(match.street, 'FLOP');
  assert.equal(match.revealedCommunityCount, 3);

  // Flop
  performPokerAction(match, 'p0', { action: 'CHECK_CALL' });
  performPokerAction(match, 'p1', { action: 'CHECK_CALL' });
  assert.equal(match.street, 'TURN');
  assert.equal(match.revealedCommunityCount, 4);

  // Turn
  performPokerAction(match, 'p0', { action: 'CHECK_CALL' });
  performPokerAction(match, 'p1', { action: 'CHECK_CALL' });
  assert.equal(match.street, 'RIVER');
  assert.equal(match.revealedCommunityCount, 5);

  // River -> Showdown
  performPokerAction(match, 'p0', { action: 'CHECK_CALL' });
  performPokerAction(match, 'p1', { action: 'CHECK_CALL' });
  assert.equal(match.phase, PHASES.ROULETTE_PENALTY);
  assert.ok(match.lastShowdown);
});

test('PK-04: Poker AI Bot makes valid decisions across intelligence tiers', () => {
  for (const diff of ['GRADE_5', 'MATH_MASTER', 'PROFESSOR_NGAU']) {
    const match = createPokerMatchState({ seed: 555, playerCount: 3, botDifficulty: diff });
    const decision = choosePokerAIAction(match, 'p0');
    assert.ok(['CHECK_CALL', 'RAISE', 'SWITCH', 'FOLD', 'CALL_BLUFF'].includes(decision.action));
  }
});

test('PK-05: RAISE and ALL_IN rejected server-side when currentStake >= 6', () => {
  const match = createPokerMatchState({ seed: 888, playerCount: 2 });
  performPokerAction(match, 'p0', { action: 'ALL_IN', claimedHandRank: 5 });
  assert.equal(match.currentStake, 6);

  assert.throws(
    () => performPokerAction(match, 'p1', { action: 'RAISE', claimedHandRank: 6 }),
    /Mức cược đã đạt tối đa 6 viên đạn/
  );
  assert.throws(
    () => performPokerAction(match, 'p1', { action: 'ALL_IN', claimedHandRank: 6 }),
    /Mức cược đã đạt tối đa 6 viên đạn/
  );
});

test('PK-06: Poker CALL_BLUFF triggers multi-shot penalty (shotsRemaining > 1) and decrements per pull', () => {
  const match = createPokerMatchState({ seed: 101, playerCount: 2 });
  // p0 raises to stake 2 claiming Royal Flush (9)
  performPokerAction(match, 'p0', { action: 'RAISE', claimedHandRank: 9 });
  assert.equal(match.currentStake, 2);

  // p1 calls bluff -> penalty requires 2 shots
  performPokerAction(match, 'p1', { action: 'CALL_BLUFF' });
  assert.equal(match.phase, PHASES.ROULETTE_PENALTY);
  assert.ok(match.pendingPenalty);
  assert.equal(match.pendingPenalty.shotsRemaining, 2);
  assert.equal(match.pendingPenalty.totalShots, 2);

  // Force bullet to last chamber so first 2 shots are guaranteed blanks
  const loserId = match.pendingPenalty.targetPlayerId;
  const loser = match.players.find((p) => p.id === loserId);
  loser.revolver.bulletIndex = 5;

  pullPokerTrigger(match, loserId);
  assert.equal(match.phase, PHASES.ROULETTE_PENALTY);
  assert.equal(match.pendingPenalty.shotsRemaining, 1);

  pullPokerTrigger(match, loserId);
  assert.equal(match.phase, PHASES.ROUND_END);
  assert.equal(match.pendingPenalty, null);
});
