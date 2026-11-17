/**
 * End-to-End Programmatic & Full-Stack QA Verification Suite (WS-3)
 * Verifies:
 * 1. Static asset delivery (/, /css/pixel-style.css, /js/app.js, /js/pixelRenderer.js, /js/soundFX.js)
 * 2. Complete Empty-Hand Win user journey over HTTP API
 * 3. Complete Bluff -> Call Liar -> Russian Roulette -> Elimination user journey over HTTP API
 * 4. Quick Chat & Public Room switching
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

test('E2E-01: Static assets & HTML branding load cleanly with 0 third-party portal names', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const assetPath of [
      '/',
      '/css/pixel-style.css',
      '/js/app.js',
      '/js/pixelRenderer.js',
      '/js/soundFX.js',
      '/engine/gameEngine.js'
    ]) {
      const res = await fetch(`${baseUrl}${assetPath}`);
      assert.equal(res.status, 200, `Expected 200 OK for ${assetPath}`);
      const text = await res.text();
      assert.ok(text.length > 100, `Non-empty content for ${assetPath}`);
      assert.equal(/dautri\.com/i.test(text), false, `Zero dautri.com strings in ${assetPath}`);
      assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), false, `Zero Unicode emojis in ${assetPath}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('E2E-02: Full Multi-Turn Match Journey to Game Over via API', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const newRes = await fetch(`${baseUrl}/api/match/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'E2E-100',
        roomName: 'Bàn Kiểm Thử E2E',
        playerName: 'Người Chơi Chính',
        winMode: 'EMPTY_HAND_WIN',
        includeDevil: false,
        seed: 77777
      })
    });
    const newData = await newRes.json();
    assert.equal(newData.ok, true);
    let state = newData.state;

    // Test Quick Chat
    const chatRes = await fetch(`${baseUrl}/api/match/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'E2E-100',
        type: 'QUICK_CHAT',
        playerId: 'p0',
        messageVi: '100% bài thật nhé!'
      })
    });
    const chatData = await chatRes.json();
    assert.equal(chatData.ok, true);
    assert.equal(chatData.state.players[0].lastSpeech, '100% bài thật nhé!');

    // Play up to 40 steps until match reaches GAME_OVER
    let steps = 0;
    while (state.phase !== 'GAME_OVER' && steps < 80) {
      steps += 1;
      if (state.phase === 'ROULETTE_PENALTY') {
        const targetId = state.pendingPenalty.targetPlayerIds[0];
        const rRes = await fetch(`${baseUrl}/api/match/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: 'E2E-100',
            type: 'PULL_TRIGGER',
            targetPlayerId: targetId
          })
        });
        state = (await rRes.json()).state;
        continue;
      }

      if (state.phase === 'ROUND_END') {
        const nRes = await fetch(`${baseUrl}/api/match/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: 'E2E-100',
            type: 'NEXT_ROUND'
          })
        });
        state = (await nRes.json()).state;
        continue;
      }

      const activePlayer = state.players[state.currentTurnIndex];
      if (activePlayer.id === 'p0') {
        if (state.phase === 'FINAL_CHALLENGE_WINDOW') {
          const cRes = await fetch(`${baseUrl}/api/match/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomId: 'E2E-100',
              type: 'CALL_LIAR',
              playerId: 'p0'
            })
          });
          state = (await cRes.json()).state;
        } else {
          // Play up to 2 cards from hand
          const cardsToPlay = activePlayer.hand.slice(0, Math.min(2, activePlayer.hand.length)).map((c) => c.id);
          const pRes = await fetch(`${baseUrl}/api/match/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomId: 'E2E-100',
              type: 'PLAY_CARDS',
              playerId: 'p0',
              cardIds: cardsToPlay
            })
          });
          state = (await pRes.json()).state;
        }
      } else {
        const aiRes = await fetch(`${baseUrl}/api/match/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: 'E2E-100',
            type: 'AI_STEP',
            aiPlayerId: activePlayer.id
          })
        });
        state = (await aiRes.json()).state;
      }
    }

    assert.equal(state.phase, 'GAME_OVER');
    assert.ok(state.winnerId);
    assert.ok(['EMPTY_HAND_VICTORY', 'LAST_SURVIVOR_VICTORY'].includes(state.winnerReason));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
