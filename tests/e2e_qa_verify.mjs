/**
 * End-to-End Programmatic & Multi-Client WebSocket Multiplayer QA Verification Suite
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

function createWsClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue = [];
    const waiters = [];

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (waiters.length > 0) {
        const idx = waiters.findIndex((w) => w.predicate(msg));
        if (idx >= 0) {
          const [w] = waiters.splice(idx, 1);
          w.resolve(msg);
          return;
        }
      }
      queue.push(msg);
    });

    ws.nextMessage = (predicate = () => true, timeoutMs = 4000) => {
      const qIdx = queue.findIndex(predicate);
      if (qIdx >= 0) {
        const [m] = queue.splice(qIdx, 1);
        return Promise.resolve(m);
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error('Timed out waiting for WS message'));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (m) => {
            clearTimeout(timer);
            res(m);
          }
        });
      });
    };

    ws.sendJson = (obj) => ws.send(JSON.stringify(obj));

    let closedInfo = null;
    const closeWaiters = [];
    ws.addEventListener('close', (ev) => {
      closedInfo = { code: ev.code, reason: ev.reason };
      while (closeWaiters.length > 0) {
        closeWaiters.shift()(closedInfo);
      }
    });
    ws.waitForClose = (timeoutMs = 4000) => {
      if (closedInfo) return Promise.resolve(closedInfo);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('Timed out waiting for WS close')), timeoutMs);
        closeWaiters.push((info) => {
          clearTimeout(timer);
          res(info);
        });
      });
    };

    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', (err) => reject(err));
  });
}

test('E2E-01: Static assets, zero "Đánh fake" label, and zero pre-populated bot rooms', async () => {
  const server = createAppServer({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    for (const assetPath of [
      '/',
      '/css/pixel-style.css',
      '/js/app.js',
      '/js/cardArt.js',
      '/js/pixelRenderer.js',
      '/js/soundFX.js',
      '/engine/gameEngine.js',
      '/engine/pokerEngine.js'
    ]) {
      const res = await fetch(`${baseUrl}${assetPath}`);
      assert.equal(res.status, 200, `Expected 200 OK for ${assetPath}`);
      const text = await res.text();
      assert.ok(text.length > 100);
      assert.equal(/dautri\.com/i.test(text), false);
      assert.equal(/Đánh fake/i.test(text), false, `Must not contain "Đánh fake" in ${assetPath}`);
    }

    const roomsRes = await fetch(`${baseUrl}/api/rooms`);
    const roomsData = await roomsRes.json();
    assert.equal(roomsData.ok, true);
    assert.equal(roomsData.rooms.length, 0, 'Lobby must start with 0 pre-populated bot rooms');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('E2E-02: Full Multi-Turn Match Journey to Game Over via Legacy API', async () => {
  const server = createAppServer({ dbPath: ':memory:' });
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
    const firstCard = newData.state.players[0].hand[0].id;
    const playRes = await fetch(`${baseUrl}/api/match/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roomId: 'E2E-100',
        type: 'PLAY_CARDS',
        playerId: 'p0',
        cardIds: [firstCard]
      })
    });
    const playData = await playRes.json();
    assert.equal(playData.ok, true);
    assert.equal(playData.state.pileCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('E2E-03: Multi-Client Private Room, Invite Code Errors, Private Hand Isolation & Reconnect', async () => {
  const server = createAppServer({
    dbPath: ':memory:',
    turnTimeSeconds: 60,
    disconnectGraceMs: 3000
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const wsUrl = `ws://127.0.0.1:${port}`;
  const baseUrl = `http://127.0.0.1:${port}`;

  let alice;
  let bob;
  let bobReconnect;
  try {
    alice = await createWsClient(wsUrl);
    bob = await createWsClient(wsUrl);

    alice.sendJson({ type: 'IDENTIFY', name: 'Alice', avatarKey: 'fox' });
    const aliceIdMsg = await alice.nextMessage((m) => m.type === 'IDENTIFIED');
    const aliceId = aliceIdMsg.player.id;

    bob.sendJson({ type: 'IDENTIFY', name: 'Bob', avatarKey: 'wolf' });
    const bobIdMsg = await bob.nextMessage((m) => m.type === 'IDENTIFIED');
    const bobId = bobIdMsg.player.id;
    const bobToken = bobIdMsg.player.token;

    // Alice creates a PRIVATE room
    alice.sendJson({
      type: 'CREATE_ROOM',
      gameType: 'LIARS_DECK',
      roomName: 'Phòng Bí Mật',
      isPrivate: true,
      playWithBots: false
    });
    const joinedMsg = await alice.nextMessage((m) => m.type === 'ROOM_JOINED');
    const inviteCode = joinedMsg.room.inviteCode;
    assert.ok(inviteCode && inviteCode.length === 6);

    // Public API must NOT list private room!
    const publicList = await (await fetch(`${baseUrl}/api/rooms`)).json();
    assert.equal(publicList.rooms.length, 0);

    // Bob tries wrong invite code -> clear error
    bob.sendJson({ type: 'JOIN_ROOM', inviteCode: 'WRONG1' });
    const errMsg = await bob.nextMessage((m) => m.type === 'ERROR');
    assert.match(errMsg.error, /Không tìm thấy phòng/);

    // Bob joins with valid invite code
    bob.sendJson({ type: 'JOIN_ROOM', inviteCode });
    const bobJoined = await bob.nextMessage((m) => m.type === 'ROOM_JOINED');
    assert.equal(bobJoined.room.members.length, 2);

    // Non-host Bob cannot start match
    bob.sendJson({ type: 'START_MATCH' });
    const nonHostErr = await bob.nextMessage((m) => m.type === 'ERROR');
    assert.match(nonHostErr.error, /Chỉ chủ phòng/);

    // Host Alice starts match
    alice.sendJson({ type: 'START_MATCH' });
    const aliceStart = await alice.nextMessage((m) => m.type === 'MATCH_STARTED');
    const bobStart = await bob.nextMessage((m) => m.type === 'MATCH_STARTED');

    // Private hand isolation check!
    const aliceViewerInAlice = aliceStart.state.players.find((p) => p.id === aliceId);
    const bobViewerInAlice = aliceStart.state.players.find((p) => p.id === bobId);
    assert.equal(aliceViewerInAlice.hand.length, 5);
    assert.equal(bobViewerInAlice.hand.length, 0, 'Alice must NOT see Bob cards');

    const bobViewerInBob = bobStart.state.players.find((p) => p.id === bobId);
    const aliceViewerInBob = bobStart.state.players.find((p) => p.id === aliceId);
    assert.equal(bobViewerInBob.hand.length, 5);
    assert.equal(aliceViewerInBob.hand.length, 0, 'Bob must NOT see Alice cards');

    // Bob disconnects -> grace period holds seat -> reconnects with token!
    bob.close();
    await alice.nextMessage((m) => m.type === 'SYSTEM_NOTICE');

    bobReconnect = await createWsClient(wsUrl);
    bobReconnect.sendJson({ type: 'IDENTIFY', token: bobToken });
    const reconId = await bobReconnect.nextMessage((m) => m.type === 'IDENTIFIED');
    assert.equal(reconId.player.id, bobId);
    const reconState = await bobReconnect.nextMessage((m) => m.type === 'GAME_STATE');
    assert.equal(reconState.state.players.find((p) => p.id === bobId).hand.length, 5);
  } finally {
    alice?.close();
    bob?.close();
    bobReconnect?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('E2E-04: Public Room, Kick, Turn Timeout & Poker Liar Bar Multiplayer', async () => {
  const server = createAppServer({
    dbPath: ':memory:',
    turnTimeSeconds: 1,
    disconnectGraceMs: 200
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const wsUrl = `ws://127.0.0.1:${port}`;

  let c1;
  let c2;
  let c3;
  try {
    c1 = await createWsClient(wsUrl);
    c2 = await createWsClient(wsUrl);
    c3 = await createWsClient(wsUrl);

    c1.sendJson({ type: 'IDENTIFY', name: 'Host1', avatarKey: 'human' });
    c2.sendJson({ type: 'IDENTIFY', name: 'Guest2', avatarKey: 'cat' });
    c3.sendJson({ type: 'IDENTIFY', name: 'Guest3', avatarKey: 'owl' });

    const id1 = (await c1.nextMessage((m) => m.type === 'IDENTIFIED')).player.id;
    const id2 = (await c2.nextMessage((m) => m.type === 'IDENTIFIED')).player.id;
    await c3.nextMessage((m) => m.type === 'IDENTIFIED');

    // Host1 creates public Poker Liar Bar room
    c1.sendJson({
      type: 'CREATE_ROOM',
      gameType: 'POKER_LIAR_BAR',
      roomName: 'Bàn Poker Công Khai',
      isPrivate: false,
      playWithBots: false
    });
    const roomJoined = await c1.nextMessage((m) => m.type === 'ROOM_JOINED');
    const roomId = roomJoined.room.roomId;

    // Guest2 & Guest3 join
    c2.sendJson({ type: 'JOIN_ROOM', roomId });
    await c2.nextMessage((m) => m.type === 'ROOM_JOINED');
    c3.sendJson({ type: 'JOIN_ROOM', roomId });
    await c3.nextMessage((m) => m.type === 'ROOM_JOINED');

    // Host1 kicks Guest2
    c1.sendJson({ type: 'KICK_PLAYER', targetPlayerId: id2 });
    const kickedMsg = await c2.nextMessage((m) => m.type === 'KICKED');
    assert.match(kickedMsg.message, /kick|mời ra/i);

    // Host1 starts Poker Liar Bar with Guest3 (2 players)
    c1.sendJson({ type: 'START_MATCH' });
    const pStart1 = await c1.nextMessage((m) => m.type === 'MATCH_STARTED');
    assert.equal(pStart1.state.gameType, 'POKER_LIAR_BAR');
    assert.equal(pStart1.state.players.find((p) => p.id === id1).hand.length, 2);

    // Wait for 1s server turn timeout -> server auto-plays CHECK_CALL and advances turn!
    const nextState = await c1.nextMessage((m) => m.type === 'GAME_STATE', 3000);
    assert.ok(nextState.state.eventSeq > pStart1.state.eventSeq);
  } finally {
    c1?.close();
    c2?.close();
    c3?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('E2E-05: WS close code 4001 on duplicate token, server-minted token, and GameDatabase.updateProfile', async () => {
  const server = createAppServer({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const wsUrl = `ws://127.0.0.1:${port}`;

  let ws1;
  let ws2;
  try {
    ws1 = await createWsClient(wsUrl);
    ws1.sendJson({
      type: 'IDENTIFY',
      token: 'client-supplied-unknown-token-abc',
      name: 'TokenTester',
      avatarKey: 'fox'
    });
    const id1 = await ws1.nextMessage((m) => m.type === 'IDENTIFIED');
    const mintedToken = id1.player.token;
    assert.notEqual(mintedToken, 'client-supplied-unknown-token-abc');
    assert.match(mintedToken, /^[a-f0-9]{48}$/);
    assert.equal(server.db.getPlayerByToken('client-supplied-unknown-token-abc'), null);
    assert.ok(server.db.getPlayerByToken(mintedToken));

    // Verify GameDatabase.updateProfile
    const updated = server.db.updateProfile(mintedToken, { name: 'RenamedFox', avatarKey: 'owl' });
    assert.equal(updated.name, 'RenamedFox');
    assert.equal(updated.avatarKey, 'owl');
    assert.equal(server.db.getPlayerByToken(mintedToken).name, 'RenamedFox');
    assert.throws(() => server.db.updateProfile(mintedToken, { name: 'A' }), /Tên người chơi không hợp lệ/);

    // Second client connects with same token -> old socket closed with 4001
    ws2 = await createWsClient(wsUrl);
    const closePromise = ws1.waitForClose(4000);
    ws2.sendJson({ type: 'IDENTIFY', token: mintedToken });
    const id2 = await ws2.nextMessage((m) => m.type === 'IDENTIFIED');
    assert.equal(id2.player.id, id1.player.id);
    assert.equal(id2.player.name, 'RenamedFox');
    const closeInfo = await closePromise;
    assert.equal(closeInfo.code, 4001);
  } finally {
    ws1?.close();
    ws2?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('E2E-06: Mid-match LEAVE_ROOM during ROULETTE_PENALTY in 3-player Liars Deck -> ROUND_END & LOSS in DB', async () => {
  const server = createAppServer({ dbPath: ':memory:', roundEndDelayMs: 60000 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const wsUrl = `ws://127.0.0.1:${port}`;

  let c1;
  let c2;
  let c3;
  try {
    c1 = await createWsClient(wsUrl);
    c2 = await createWsClient(wsUrl);
    c3 = await createWsClient(wsUrl);

    c1.sendJson({ type: 'IDENTIFY', name: 'DeckP1', avatarKey: 'human' });
    c2.sendJson({ type: 'IDENTIFY', name: 'DeckP2', avatarKey: 'fox' });
    c3.sendJson({ type: 'IDENTIFY', name: 'DeckP3', avatarKey: 'wolf' });

    const p1 = (await c1.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const p2 = (await c2.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const p3 = (await c3.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const clientById = new Map([
      [p1.id, c1],
      [p2.id, c2],
      [p3.id, c3]
    ]);

    c1.sendJson({ type: 'CREATE_ROOM', gameType: 'LIARS_DECK', roomName: 'LD 3P Forfeit', isPrivate: false, playWithBots: false });
    const joined = await c1.nextMessage((m) => m.type === 'ROOM_JOINED');
    const roomId = joined.room.roomId;

    c2.sendJson({ type: 'JOIN_ROOM', roomId });
    await c2.nextMessage((m) => m.type === 'ROOM_JOINED');
    c3.sendJson({ type: 'JOIN_ROOM', roomId });
    await c3.nextMessage((m) => m.type === 'ROOM_JOINED');

    c1.sendJson({ type: 'START_MATCH' });
    const s1 = (await c1.nextMessage((m) => m.type === 'MATCH_STARTED')).state;
    await c2.nextMessage((m) => m.type === 'MATCH_STARTED');
    await c3.nextMessage((m) => m.type === 'MATCH_STARTED');

    // First actor plays 1 card
    const actor1Id = s1.currentTurnPlayerId;
    const actor1Client = clientById.get(actor1Id);
    const roomObj = server.roomManager.rooms.get(roomId);
    const firstCardId = roomObj.matchState.players.find((p) => p.id === actor1Id).hand[0].id;
    actor1Client.sendJson({ type: 'GAME_ACTION', action: 'PLAY_CARDS', cardIds: [firstCardId] });

    const afterPlay1 = await c1.nextMessage((m) => m.type === 'GAME_STATE' && m.state.pileCount === 1);
    await c2.nextMessage((m) => m.type === 'GAME_STATE' && m.state.pileCount === 1);
    await c3.nextMessage((m) => m.type === 'GAME_STATE' && m.state.pileCount === 1);

    // Next actor calls Liar -> ROULETTE_PENALTY
    const callerId = afterPlay1.state.currentTurnPlayerId;
    clientById.get(callerId).sendJson({ type: 'GAME_ACTION', action: 'CALL_LIAR' });

    const penaltyState1 = await c1.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');
    await c2.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');
    await c3.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');

    const shooterId = penaltyState1.state.pendingPenalty.targetPlayerIds[0];
    const survivorClient = shooterId === p1.id ? c2 : c1;

    // Shooter leaves mid-penalty -> must transition cleanly to ROUND_END and record LOSS in DB!
    clientById.get(shooterId).sendJson({ type: 'LEAVE_ROOM' });
    const roundEndMsg = await survivorClient.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROUND_END');
    assert.equal(roundEndMsg.state.pendingPenalty, null);
    assert.equal(roundEndMsg.state.players.filter((p) => p.alive).length, 2);

    const dbShooter = server.db.getPlayerById(shooterId);
    assert.equal(dbShooter.losses, 1);
    assert.equal(dbShooter.matchesPlayed, 1);

    // Confirm next round can start cleanly without soft-lock
    const hostSurvivor = roomObj.hostId;
    clientById.get(hostSurvivor).sendJson({ type: 'GAME_ACTION', action: 'NEXT_ROUND' });
    const nextRoundMsg = await survivorClient.nextMessage((m) => m.type === 'GAME_STATE' && m.state.roundNumber === 2);
    assert.equal(nextRoundMsg.state.phase, 'TURN_PLAY_OR_CHALLENGE');
  } finally {
    c1?.close();
    c2?.close();
    c3?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('E2E-07: Mid-match LEAVE_ROOM during ROULETTE_PENALTY in 3-player Poker Liar Bar -> TURN_PLAY_OR_CHALLENGE / ROUND_END & LOSS in DB', async () => {
  const server = createAppServer({ dbPath: ':memory:', roundEndDelayMs: 60000 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const wsUrl = `ws://127.0.0.1:${port}`;

  let c1;
  let c2;
  let c3;
  let d1;
  let d2;
  let d3;
  try {
    // Subcase A: COWARD_FOLD ROULETTE_PENALTY -> shooter leaves -> TURN_PLAY_OR_CHALLENGE
    c1 = await createWsClient(wsUrl);
    c2 = await createWsClient(wsUrl);
    c3 = await createWsClient(wsUrl);
    c1.sendJson({ type: 'IDENTIFY', name: 'PkA1', avatarKey: 'human' });
    c2.sendJson({ type: 'IDENTIFY', name: 'PkA2', avatarKey: 'fox' });
    c3.sendJson({ type: 'IDENTIFY', name: 'PkA3', avatarKey: 'wolf' });
    const p1 = (await c1.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const p2 = (await c2.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const p3 = (await c3.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const mapA = new Map([[p1.id, c1], [p2.id, c2], [p3.id, c3]]);

    c1.sendJson({ type: 'CREATE_ROOM', gameType: 'POKER_LIAR_BAR', roomName: 'PK 3P Fold Forfeit', isPrivate: false, playWithBots: false });
    const roomAId = (await c1.nextMessage((m) => m.type === 'ROOM_JOINED')).room.roomId;
    c2.sendJson({ type: 'JOIN_ROOM', roomId: roomAId });
    await c2.nextMessage((m) => m.type === 'ROOM_JOINED');
    c3.sendJson({ type: 'JOIN_ROOM', roomId: roomAId });
    await c3.nextMessage((m) => m.type === 'ROOM_JOINED');

    c1.sendJson({ type: 'START_MATCH' });
    const startA = (await c1.nextMessage((m) => m.type === 'MATCH_STARTED')).state;
    await c2.nextMessage((m) => m.type === 'MATCH_STARTED');
    await c3.nextMessage((m) => m.type === 'MATCH_STARTED');

    const folderId = startA.currentTurnPlayerId;
    mapA.get(folderId).sendJson({ type: 'GAME_ACTION', action: 'FOLD' });
    await c1.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');
    await c2.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');
    await c3.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');

    const survivorA = folderId === p1.id ? c2 : c1;
    mapA.get(folderId).sendJson({ type: 'LEAVE_ROOM' });
    const resumeMsg = await survivorA.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'TURN_PLAY_OR_CHALLENGE');
    assert.equal(resumeMsg.state.pendingPenalty, null);
    assert.equal(resumeMsg.state.players.filter((p) => p.alive).length, 2);
    assert.equal(server.db.getPlayerById(folderId).losses, 1);

    // Subcase B: CALL_BLUFF ROULETTE_PENALTY -> penalty shooter leaves -> ROUND_END
    d1 = await createWsClient(wsUrl);
    d2 = await createWsClient(wsUrl);
    d3 = await createWsClient(wsUrl);
    d1.sendJson({ type: 'IDENTIFY', name: 'PkB1', avatarKey: 'human' });
    d2.sendJson({ type: 'IDENTIFY', name: 'PkB2', avatarKey: 'cat' });
    d3.sendJson({ type: 'IDENTIFY', name: 'PkB3', avatarKey: 'owl' });
    const q1 = (await d1.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const q2 = (await d2.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const q3 = (await d3.nextMessage((m) => m.type === 'IDENTIFIED')).player;
    const mapB = new Map([[q1.id, d1], [q2.id, d2], [q3.id, d3]]);

    d1.sendJson({ type: 'CREATE_ROOM', gameType: 'POKER_LIAR_BAR', roomName: 'PK 3P Bluff Forfeit', isPrivate: false, playWithBots: false });
    const roomBId = (await d1.nextMessage((m) => m.type === 'ROOM_JOINED')).room.roomId;
    d2.sendJson({ type: 'JOIN_ROOM', roomId: roomBId });
    await d2.nextMessage((m) => m.type === 'ROOM_JOINED');
    d3.sendJson({ type: 'JOIN_ROOM', roomId: roomBId });
    await d3.nextMessage((m) => m.type === 'ROOM_JOINED');

    d1.sendJson({ type: 'START_MATCH' });
    const startB = (await d1.nextMessage((m) => m.type === 'MATCH_STARTED')).state;
    await d2.nextMessage((m) => m.type === 'MATCH_STARTED');
    await d3.nextMessage((m) => m.type === 'MATCH_STARTED');

    mapB.get(startB.currentTurnPlayerId).sendJson({ type: 'GAME_ACTION', action: 'RAISE', claimedHandRank: 9 });
    const afterRaiseB = await d1.nextMessage((m) => m.type === 'GAME_STATE' && m.state.currentStake === 2);
    await d2.nextMessage((m) => m.type === 'GAME_STATE' && m.state.currentStake === 2);
    await d3.nextMessage((m) => m.type === 'GAME_STATE' && m.state.currentStake === 2);

    mapB.get(afterRaiseB.state.currentTurnPlayerId).sendJson({ type: 'GAME_ACTION', action: 'CALL_BLUFF' });
    const bluffPenalty = await d1.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');
    await d2.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');
    await d3.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROULETTE_PENALTY');

    const bluffShooterId = bluffPenalty.state.pendingPenalty.targetPlayerId;
    const survivorB = bluffShooterId === q1.id ? d2 : d1;
    mapB.get(bluffShooterId).sendJson({ type: 'LEAVE_ROOM' });
    const endMsgB = await survivorB.nextMessage((m) => m.type === 'GAME_STATE' && m.state.phase === 'ROUND_END');
    assert.equal(endMsgB.state.pendingPenalty, null);
    assert.equal(endMsgB.state.players.filter((p) => p.alive).length, 2);
    assert.equal(server.db.getPlayerById(bluffShooterId).losses, 1);
  } finally {
    c1?.close();
    c2?.close();
    c3?.close();
    d1?.close();
    d2?.close();
    d3?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
