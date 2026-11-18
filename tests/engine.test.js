import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_RANKS,
  SPECIAL_CARDS,
  WIN_MODES,
  PHASES,
  buildDeck,
  createMatchState,
  startNewRound,
  playCards,
  callLiar,
  passFinalChallenge,
  pullTrigger
} from '../src/engine/gameEngine.js';
import { chooseAIAction } from '../src/engine/aiBot.js';
import { createAppServer } from '../server.js';

test('AC-01: 20-Card Liar\'s Deck composition (Standard & Devil Variant) and 5-card deal', () => {
  const standardDeck = buildDeck({ includeDevil: false });
  assert.equal(standardDeck.length, 20);
  assert.equal(standardDeck.filter((c) => c.rank === 'K').length, 6);
  assert.equal(standardDeck.filter((c) => c.rank === 'Q').length, 6);
  assert.equal(standardDeck.filter((c) => c.rank === 'A').length, 6);
  assert.equal(standardDeck.filter((c) => c.rank === 'J').length, 2);
  assert.equal(standardDeck.filter((c) => c.rank === 'D').length, 0);

  const devilDeck = buildDeck({ includeDevil: true });
  assert.equal(devilDeck.length, 20);
  assert.equal(devilDeck.filter((c) => c.rank === 'J').length, 1);
  assert.equal(devilDeck.filter((c) => c.rank === 'D').length, 1);

  const match = createMatchState({ seed: 42, playerCount: 4 });
  assert.equal(match.players.length, 4);
  assert.ok(CARD_RANKS.includes(match.tableRank));
  for (const p of match.players) {
    assert.equal(p.hand.length, 5);
    assert.ok(p.revolver.bulletIndex >= 0 && p.revolver.bulletIndex <= 5);
    assert.equal(p.revolver.shotsTaken, 0);
  }
});

test('AC-02: Turn Loop & 1-3 Face-Down Card Play validation + Devil solo constraint', () => {
  const match = createMatchState({ seed: 100, includeDevil: true });
  const p0 = match.players[0];

  assert.throws(() => playCards(match, 'p0', []), /1 đến 3 lá/);
  assert.throws(
    () => playCards(match, 'p0', p0.hand.slice(0, 4).map((c) => c.id)),
    /1 đến 3 lá/
  );
  assert.throws(() => playCards(match, 'p1', [match.players[1].hand[0].id]), /Chưa tới lượt/);

  p0.hand = [
    { id: 'D-1', rank: SPECIAL_CARDS.DEVIL, labelVi: 'Ác Quỷ' },
    { id: 'K-1', rank: 'K', labelVi: 'Già' },
    { id: 'Q-1', rank: 'Q', labelVi: 'Đầm' }
  ];
  assert.throws(() => playCards(match, 'p0', ['D-1', 'K-1']), /Lá Ác Quỷ/);

  playCards(match, 'p0', ['K-1', 'Q-1']);
  assert.equal(p0.hand.length, 1);
  assert.equal(match.pileCount, 2);
  assert.equal(match.currentTurnIndex, 1);
});

test('AC-03: Call Liar resolution with REAL / FAKE / DEVIL verdict tags', () => {
  const matchTruth = createMatchState({ seed: 777 });
  matchTruth.tableRank = 'K';
  matchTruth.players[0].hand = [
    { id: 'K-1', rank: 'K', labelVi: 'K' },
    { id: 'J-1', rank: 'J', labelVi: 'Joker' },
    { id: 'Q-1', rank: 'Q', labelVi: 'Q' }
  ];
  playCards(matchTruth, 'p0', ['K-1', 'J-1']);
  callLiar(matchTruth, 'p1');
  assert.equal(matchTruth.phase, PHASES.ROULETTE_PENALTY);
  assert.equal(matchTruth.pendingPenalty.wasLying, false);
  assert.equal(matchTruth.pendingPenalty.verdictTag, 'REAL');
  assert.deepEqual(matchTruth.pendingPenalty.targetPlayerIds, ['p1']);

  const matchLie = createMatchState({ seed: 888 });
  matchLie.tableRank = 'A';
  matchLie.players[0].hand = [
    { id: 'K-1', rank: 'K', labelVi: 'K' },
    { id: 'A-1', rank: 'A', labelVi: 'A' }
  ];
  playCards(matchLie, 'p0', ['K-1']);
  callLiar(matchLie, 'p1');
  assert.equal(matchLie.pendingPenalty.wasLying, true);
  assert.equal(matchLie.pendingPenalty.verdictTag, 'FAKE');
  assert.deepEqual(matchLie.pendingPenalty.targetPlayerIds, ['p0']);

  const matchDevil = createMatchState({ seed: 999, includeDevil: true });
  matchDevil.players[0].hand = [
    { id: 'D-1', rank: 'D', labelVi: 'Devil' },
    { id: 'K-1', rank: 'K', labelVi: 'K' }
  ];
  playCards(matchDevil, 'p0', ['D-1']);
  callLiar(matchDevil, 'p1');
  assert.equal(matchDevil.pendingPenalty.isDevilTrap, true);
  assert.equal(matchDevil.pendingPenalty.verdictTag, 'DEVIL');
  assert.deepEqual(matchDevil.pendingPenalty.targetPlayerIds, ['p1', 'p2', 'p3']);
});

test('AC-04: Multi-Round Elimination Loop — Sub-Round Empty-Hand Safe & Continues Until 1 Survivor Left', () => {
  // 4 players start: p0 empties hand and p1 passes -> p0 becomes safeForRound, remaining 3 players keep playing!
  const match = createMatchState({ seed: 123, playerCount: 4 });
  match.tableRank = 'Q';
  match.players[0].hand = [
    { id: 'Q-1', rank: 'Q', labelVi: 'Q' },
    { id: 'Q-2', rank: 'Q', labelVi: 'Q' }
  ];
  playCards(match, 'p0', ['Q-1', 'Q-2']);
  assert.equal(match.phase, PHASES.FINAL_CHALLENGE_WINDOW);
  passFinalChallenge(match, 'p1');

  // p0 won the sub-round (safeForRound = true), and the remaining 3 players continue the round!
  assert.equal(match.players[0].safeForRound, true);
  assert.equal(match.players[0].stats.subRoundWins, 1);
  assert.equal(match.phase, PHASES.TURN_PLAY_OR_CHALLENGE);

  // Now simulate 2 players dying (p1 and p2 dead), leaving p0 and p3 in a 1v1!
  match.players[1].alive = false;
  match.players[2].alive = false;
  startNewRound(match);
  assert.equal(match.players.filter((p) => p.alive).length, 2);
  assert.equal(match.players[0].hand.length, 5);
  assert.equal(match.players[1].hand.length, 0); // Dead player gets 0 cards!
  assert.equal(match.players[2].hand.length, 0); // Dead player gets 0 cards!
  assert.equal(match.players[3].hand.length, 5);

  // In 1v1, when p3 dies on lethal shot, match ends with p0 as LAST_SURVIVOR_VICTORY!
  match.tableRank = 'K';
  match.currentTurnIndex = 3;
  match.players[3].hand = [{ id: 'Q-1', rank: 'Q', labelVi: 'Q' }];
  match.players[3].revolver.chamberIndex = 0;
  match.players[3].revolver.bulletIndex = 0;
  playCards(match, 'p3', ['Q-1']);
  callLiar(match, 'p0');
  pullTrigger(match, 'p3', { forceFatal: true });
  assert.equal(match.players[3].alive, false);
  assert.equal(match.phase, PHASES.GAME_OVER);
  assert.equal(match.winnerId, 'p0');
  assert.equal(match.winnerReason, 'LAST_SURVIVOR_VICTORY');
});

test('AC-05: Progressive 6-Chamber Russian Roulette (BLANK, FATAL, and 1% MIRACLE DODGE)', () => {
  const match = createMatchState({ seed: 555 });
  const victim = match.players[1];

  // Test 1% Miracle Dodge ("Hú hồn, né được nhé!")
  victim.revolver.chamberIndex = 0;
  victim.revolver.bulletIndex = 0;
  match.tableRank = 'K';
  match.currentTurnIndex = 1;
  victim.hand = [{ id: 'Q-1', rank: 'Q', labelVi: 'Q' }];
  playCards(match, 'p1', ['Q-1']);
  callLiar(match, 'p2');
  pullTrigger(match, 'p1', { forceDodge: true });

  assert.equal(victim.alive, true);
  assert.equal(match.lastRouletteResult.outcomeType, 'DODGE');
  assert.equal(match.lastRouletteResult.isMiracleDodge, true);
  assert.equal(victim.lastSpeech, 'Hú hồn, may mà né được, lêu lêu con gà kia!');
  assert.equal(match.phase, PHASES.ROUND_END);

  // Test Fatal Shot
  startNewRound(match);
  victim.revolver.chamberIndex = 0;
  victim.revolver.bulletIndex = 0;
  match.tableRank = 'K';
  match.currentTurnIndex = 1;
  victim.hand = [{ id: 'Q-1', rank: 'Q', labelVi: 'Q' }];
  playCards(match, 'p1', ['Q-1']);
  callLiar(match, 'p2');
  pullTrigger(match, 'p1', { forceFatal: true });

  assert.equal(victim.alive, false);
  assert.equal(match.lastRouletteResult.outcomeType, 'FATAL');
  assert.equal(match.lastRouletteResult.isFatal, true);
  // 3 players still alive -> ROUND_END (not GAME_OVER yet!)
  assert.equal(match.phase, PHASES.ROUND_END);
});

test('AC-06: Tactical AI Bot makes valid moves across all game phases', () => {
  const match = createMatchState({ seed: 2026 });
  playCards(match, 'p0', [match.players[0].hand[0].id]);

  let safetySteps = 0;
  while (match.phase !== PHASES.GAME_OVER && safetySteps < 60) {
    safetySteps += 1;
    if (match.phase === PHASES.ROULETTE_PENALTY) {
      const targetId = match.pendingPenalty.targetPlayerIds[0];
      pullTrigger(match, targetId);
      continue;
    }
    if (match.phase === PHASES.ROUND_END) {
      startNewRound(match);
      continue;
    }
    const currentPlayer = match.players[match.currentTurnIndex];
    const decision = chooseAIAction(match, currentPlayer.id);
    assert.ok(['PLAY', 'CALL_LIAR', 'PASS_FINAL'].includes(decision.action));
    if (decision.action === 'PLAY') {
      playCards(match, currentPlayer.id, decision.cardIds, decision.speechVi);
    } else if (decision.action === 'CALL_LIAR') {
      callLiar(match, currentPlayer.id);
    } else if (decision.action === 'PASS_FINAL') {
      passFinalChallenge(match, currentPlayer.id);
    }
  }
  assert.ok(safetySteps > 0);
});

test('AC-09: Full-Stack HTTP Server & REST API contract verification', async () => {
  const server = createAppServer({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');

    const newRes = await fetch(`${baseUrl}/api/match/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'TEST-999',
        roomName: 'Phòng Test API',
        playerName: 'Tester Việt',
        winMode: WIN_MODES.EMPTY_HAND_WIN,
        includeDevil: true,
        seed: 4242
      })
    });
    assert.equal(newRes.status, 200);
    const newData = await newRes.json();
    assert.equal(newData.ok, true);
    assert.equal(newData.state.players[0].hand.length, 5);

    const firstCardId = newData.state.players[0].hand[0].id;
    const playRes = await fetch(`${baseUrl}/api/match/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'TEST-999',
        type: 'PLAY_CARDS',
        playerId: 'p0',
        cardIds: [firstCardId]
      })
    });
    assert.equal(playRes.status, 200);
    const playData = await playRes.json();
    assert.equal(playData.ok, true);
    assert.equal(playData.state.pileCount, 1);
    assert.equal(playData.state.lastEvent.type, 'PLAY_CARDS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('AC-10: 30% Devil Card per sub-round (only 1 Devil) & 5% Hú hồn on 6th chamber', () => {
  let devilRounds = 0;
  const totalTrials = 200;
  const match = createMatchState({ seed: 98765, includeDevil: false, devilProbability: 0.30 });
  for (let i = 0; i < totalTrials; i += 1) {
    startNewRound(match);
    const devilsInHands = match.players
      .flatMap((p) => p.hand)
      .filter((c) => c.rank === SPECIAL_CARDS.DEVIL);
    assert.ok(devilsInHands.length <= 1, 'Devil card must appear at most once per sub-round');
    if (match.roundHasDevil) devilRounds += 1;
  }
  const ratio = devilRounds / totalTrials;
  assert.ok(ratio >= 0.18 && ratio <= 0.42, `Expected ~30% Devil rounds, got ${ratio}`);

  // Test 5% Hú hồn on 6th chamber (chamberIndex === 5)
  let dodges = 0;
  for (let t = 0; t < 400; t += 1) {
    const m = createMatchState({ seed: 1000 + t, playerCount: 2 });
    const victim = m.players[1];
    victim.revolver.chamberIndex = 5;
    victim.revolver.bulletIndex = 5;
    victim.revolver.shotsTaken = 5;
    m.phase = PHASES.ROULETTE_PENALTY;
    m.pendingPenalty = { targetPlayerIds: ['p1'], verdictTag: 'FAKE', wasLying: true };
    pullTrigger(m, 'p1');
    if (m.lastRouletteResult.isMiracleDodge) dodges += 1;
  }
  const dodgeRate = dodges / 400;
  assert.ok(dodgeRate > 0.01 && dodgeRate < 0.12, `Expected ~5% dodge on 6th chamber, got ${dodgeRate}`);
});
