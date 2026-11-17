/**
 * 2D Pixel Art Tavern & Step-by-Step Cinematic Cutscene Renderer for Liar's Bar 2D
 * Implements slow, clear, unmistakable 2D Pixel animations for:
 * 1. DEAL_ROUND: Center deck shuffle -> Flip top card as Key Card -> Deal cards flying with zoom to each alive player
 * 2. PLAY_CARDS: Show Player Name + Card Count -> Cards appear large in center and shrink down onto the table
 * 3. CALL_LIAR_REVEAL: Show Challenger Name + 2D Stop/Challenge symbol -> Pull cards up & zoom -> Flip one by one -> REAL / FAKE
 * 4. ROULETTE_STAGE & SHOT:
 *    - Show REAL / FAKE + Zoomed Shooter Avatar + Zoomed Revolver spinning 1 full cylinder turn
 *    - User clicks Shoot:
 *      * FATAL: Bullet shatters the Shooter's Avatar into flying pixel fragments
 *      * BLANK: No flash/explosion; cylinder rotates 1 notch + "TÍCH! (KHÔNG CÓ ĐẠN)"
 *      * DODGE (1%): Avatar shrinks and jumps high as bullet streaks past underneath + "HÚ HỒN, NÉ ĐƯỢC NHÉ!"
 */

const PIXEL_PALETTES = {
  human: {
    main: '#d99b66',
    hat: '#3b281e',
    band: '#f4b41b',
    shirt: '#2a4d69',
    eye: '#120d0a'
  },
  fox: {
    main: '#d95b26',
    ear: '#f2a65a',
    muzzle: '#f5e6d3',
    shirt: '#4a2511',
    eye: '#120d0a'
  },
  wolf: {
    main: '#6c757d',
    ear: '#adb5bd',
    muzzle: '#dee2e6',
    shirt: '#3a1f2d',
    eye: '#f4b41b'
  },
  pig: {
    main: '#e5989b',
    ear: '#b56576',
    muzzle: '#ffb4a2',
    shirt: '#2d4739',
    eye: '#120d0a'
  }
};

const RANK_COLORS = {
  K: '#f4b41b',
  Q: '#e85d75',
  A: '#4ea8de',
  J: '#3cd070',
  D: '#e03c3c'
};

export class PixelTableRenderer {
  constructor(canvas, soundFX = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sound = soundFX;
    this.state = null;
    this.tick = 0;
    this.shakeFrames = 0;
    this.muzzleFlashFrames = 0;
    this.animFrameId = null;

    // Active step-by-step cutscene state
    this.cutscene = null;
    // Cylinder spin timer when entering ROULETTE_PENALTY stage
    this.rouletteStageEnteredAt = 0;
  }

  setState(newState) {
    const enteringRoulette =
      newState?.phase === 'ROULETTE_PENALTY' &&
      this.state?.phase !== 'ROULETTE_PENALTY';
    this.state = newState;
    if (enteringRoulette) {
      this.rouletteStageEnteredAt = performance.now();
    }
  }

  isCutscenePlaying() {
    return Boolean(this.cutscene);
  }

  /**
   * Starts a timed cutscene and resolves a Promise when the animation finishes
   */
  playCutscene(type, payload = {}, durationMs = 2400) {
    return new Promise((resolve) => {
      this.cutscene = {
        type,
        payload,
        startTime: performance.now(),
        durationMs,
        triggeredMarks: new Set(),
        resolve
      };
    });
  }

  triggerGunshotEffect(isFatal = false) {
    this.shakeFrames = isFatal ? 28 : 0;
    this.muzzleFlashFrames = isFatal ? 14 : 0;
  }

  startLoop() {
    const loop = (now) => {
      this.tick += 1;
      this.render(now || performance.now());
      this.animFrameId = window.requestAnimationFrame(loop);
    };
    this.animFrameId = window.requestAnimationFrame(loop);
  }

  stopLoop() {
    if (this.animFrameId) {
      window.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  _fitTextToWidth(ctx, text, maxWidth) {
    const str = String(text || '').trim();
    if (!str) return '';
    if (ctx.measureText(str).width <= maxWidth) {
      return str;
    }
    let trimmed = str;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}..`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}..`;
  }

  render(now = performance.now()) {
    const { ctx, canvas } = this;
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.imageSmoothingEnabled = false;

    ctx.save();
    if (this.shakeFrames > 0) {
      this.shakeFrames -= 1;
      const mag = Math.min(10, this.shakeFrames * 0.6);
      const dx = Math.round((Math.random() - 0.5) * mag * 2);
      const dy = Math.round((Math.random() - 0.5) * mag * 2);
      ctx.translate(dx, dy);
    }

    // 1. Dark Tavern Pixel Background
    this._drawTavernBackground(ctx, w, h);

    // 2. Pixel Tavern Table
    this._drawTavernTable(ctx, w, h);

    if (this.state) {
      // 3. Draw Center Pot & Key Card Banner
      this._drawCenterPotAndReveal(ctx, w, h, this.state);

      // 4. Draw 4 Player Seats around the table
      this._drawPlayersAroundTable(ctx, w, h, this.state);

      // 5. If an active cutscene is running, draw the cinematic cutscene overlay!
      if (this.cutscene) {
        this._renderActiveCutscene(ctx, w, h, now);
      } else if (this.state.phase === 'ROULETTE_PENALTY') {
        // Pre-shot Russian Roulette Stage (Zoomed Gun + Zoomed Avatar + 1-turn Cylinder Spin)
        this._drawRouletteReadyStage(ctx, w, h, this.state, now);
      }
    }

    // 6. Muzzle Flash overlay when fatal gun fires
    if (this.muzzleFlashFrames > 0) {
      this.muzzleFlashFrames -= 1;
      ctx.fillStyle =
        this.muzzleFlashFrames > 6 ? 'rgba(255, 230, 128, 0.55)' : 'rgba(224, 60, 60, 0.32)';
      ctx.fillRect(0, 0, w, h);
    }

    ctx.restore();
  }

  _renderActiveCutscene(ctx, w, h, now) {
    const cs = this.cutscene;
    if (!cs) return;

    const elapsed = Math.max(0, now - cs.startTime);
    const progress = Math.min(1, elapsed / cs.durationMs);

    if (cs.type === 'DEAL_ROUND') {
      this._drawDealRoundCutscene(ctx, w, h, cs, elapsed, progress);
    } else if (cs.type === 'PLAY_CARDS') {
      this._drawPlayCardsCutscene(ctx, w, h, cs, elapsed, progress);
    } else if (cs.type === 'CALL_LIAR_REVEAL') {
      this._drawCallLiarRevealCutscene(ctx, w, h, cs, elapsed, progress);
    } else if (cs.type === 'ROULETTE_SHOT') {
      this._drawRouletteShotCutscene(ctx, w, h, cs, elapsed, progress);
    }

    if (progress >= 1) {
      const doneResolve = cs.resolve;
      this.cutscene = null;
      if (typeof doneResolve === 'function') {
        doneResolve();
      }
    }
  }

  /**
   * CUTSCENE 1: DEAL_ROUND (Duration ~3800ms)
   * - 0.00 -> 0.28: Deck in center shuffles (left & right packets riffle together)
   * - 0.28 -> 0.56: Top card zooms up and flips open to reveal the KEY CARD of the round (K / Q / A)
   * - 0.56 -> 1.00: Deck deals cards flying to each alive player with zoom-in/zoom-out and whoosh SFX
   */
  _drawDealRoundCutscene(ctx, w, h, cs, elapsed, progress) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const { roundNumber = 1, tableRank = 'K' } = cs.payload;

    // Semi-transparent stage backdrop
    ctx.fillStyle = 'rgba(12, 8, 6, 0.72)';
    ctx.fillRect(0, 0, w, h);

    // Stage 1: Deck Shuffle (0.0 -> 0.28)
    if (progress < 0.28) {
      if (!cs.triggeredMarks.has('shuffle') && this.sound) {
        cs.triggeredMarks.add('shuffle');
        this.sound.deckShuffle();
      }
      const localP = progress / 0.28;
      const splitOffset = Math.sin(localP * Math.PI * 6) * 34;

      this._drawHeadlineBanner(
        ctx,
        cx,
        cy - 118,
        `VÁN ${roundNumber} — ĐANG XÀO BỘ BÀI 20 LÁ...`,
        'Chuẩn bị lật lá bài KEY (Bài Chủ) của ván đấu',
        '#f4b41b'
      );

      // Left half & Right half of deck riffling together
      for (let i = 0; i < 6; i += 1) {
        const lx = Math.floor(cx - 32 - splitOffset + (i % 2) * 3);
        const rx = Math.floor(cx - 32 + splitOffset - (i % 2) * 3);
        const y = cy - 36 - i * 3;
        this._drawLargeCardBack(ctx, lx, y, 64, 88);
        this._drawLargeCardBack(ctx, rx, y, 64, 88);
      }
      return;
    }

    // Stage 2: Flip Top Card to Reveal the KEY CARD of the Round (0.28 -> 0.58)
    if (progress < 0.58) {
      if (!cs.triggeredMarks.has('keyReveal') && this.sound) {
        cs.triggeredMarks.add('keyReveal');
        this.sound.keyCardReveal();
      }
      const localP = (progress - 0.28) / 0.3;
      const zoom = 1.0 + Math.sin(Math.min(1, localP * 1.4) * (Math.PI / 2)) * 0.95;
      const flipCos = Math.cos(Math.min(1, localP * 1.5) * Math.PI);
      const scaleX = Math.max(0.08, Math.abs(flipCos));
      const showFace = flipCos <= 0;

      this._drawHeadlineBanner(
        ctx,
        cx,
        cy - 126,
        `KEY CỦA VÁN ${roundNumber}: BÀN LÁ ${tableRank}`,
        `Mọi lượt đánh úp trong ván này đều phải tuyên bố là Lá ${tableRank}!`,
        RANK_COLORS[tableRank] || '#f4b41b'
      );

      // Draw deck stack underneath
      this._drawLargeCardBack(ctx, cx - 32, cy - 26, 64, 88);

      // Draw zooming & flipping Key Card
      const cardW = Math.round(68 * zoom * scaleX);
      const cardH = Math.round(94 * zoom);
      const cardX = Math.floor(cx - cardW / 2);
      const cardY = Math.floor(cy - 18 - cardH / 2);

      if (!showFace) {
        this._drawLargeCardBack(ctx, cardX, cardY, cardW, cardH);
      } else {
        this._drawLargeCardFace(ctx, cardX, cardY, cardW, cardH, tableRank, 'KEY VÁN', true);
      }
      return;
    }

    // Stage 3: Deal cards flying out to each alive player (0.58 -> 1.0)
    const dealP = (progress - 0.58) / 0.42;
    const alivePlayers = (this.state?.players || []).filter((p) => p.alive);
    const seatCoords = this._getSeatCoordinates(w, h);
    const totalFlights = Math.max(1, alivePlayers.length * 2); // 2 visible waves of flying cards
    const activeFlightIdx = Math.min(totalFlights - 1, Math.floor(dealP * totalFlights));
    const singleFlightP = (dealP * totalFlights) % 1;

    const markKey = `deal-${activeFlightIdx}`;
    if (!cs.triggeredMarks.has(markKey) && this.sound) {
      cs.triggeredMarks.add(markKey);
      this.sound.cardDealWhoosh(activeFlightIdx);
    }

    const targetPlayer = alivePlayers[activeFlightIdx % alivePlayers.length] || alivePlayers[0];
    const targetSeat = seatCoords[targetPlayer?.seatIndex || 0] || { x: cx, y: h - 60 };

    this._drawHeadlineBanner(
      ctx,
      cx,
      cy - 126,
      `ĐANG CHIA BÀI — KEY VÁN ${roundNumber}: BÀN ${tableRank}`,
      `Chia 5 lá cho ${targetPlayer?.name || ''} (Người đã chết không được chia bài)`,
      RANK_COLORS[tableRank] || '#f4b41b'
    );

    // Center deck
    this._drawLargeCardBack(ctx, cx - 28, cy - 30, 56, 78);

    // Flying card with zoom-up in mid-air then shrink into player's seat
    const fx = cx + (targetSeat.x - cx) * singleFlightP;
    const fy = cy + (targetSeat.y - cy) * singleFlightP - Math.sin(singleFlightP * Math.PI) * 42;
    const zoomScale = 0.9 + Math.sin(singleFlightP * Math.PI) * 0.95;
    const cw = Math.round(52 * zoomScale);
    const ch = Math.round(72 * zoomScale);
    this._drawLargeCardBack(ctx, Math.floor(fx - cw / 2), Math.floor(fy - ch / 2), cw, ch);
  }

  /**
   * CUTSCENE 2: PLAY_CARDS (Duration ~2100ms)
   * - Shows Player Name + Number of Cards Played
   * - Shows the 1..3 face-down cards LARGE in center of screen, then shrinks them down into the table pot
   */
  _drawPlayCardsCutscene(ctx, w, h, cs, elapsed, progress) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const {
      playerName = 'Người Chơi',
      cardCount = 1,
      claimedRank = 'K',
      emptiedHand = false
    } = cs.payload;

    ctx.fillStyle = 'rgba(12, 8, 6, 0.58)';
    ctx.fillRect(0, 0, w, h);

    // Headline showing Player Name and Card Count clearly below it
    this._drawHeadlineBanner(
      ctx,
      cx,
      cy - 126,
      `${playerName.toUpperCase()}`,
      `ĐÁNH ${cardCount} LÁ BÀI ÚP — TUYÊN BỐ: "${cardCount} LÁ ${claimedRank}"${
        emptiedHand ? ' (ĐÃ HẾT BÀI TRÊN TAY!)' : ''
      }`,
      '#f4b41b'
    );

    // Cards start HUGE (scale 2.15) for first 38% of cutscene, then shrink down (2.15 -> 0.95) into table center
    const shrinkP = progress < 0.38 ? 0 : (progress - 0.38) / 0.62;
    const easeP = 1 - Math.pow(1 - shrinkP, 3);
    const scale = 2.15 - easeP * 1.2;
    const yOffset = -28 + easeP * 26;

    const cardW = Math.round(50 * scale);
    const cardH = Math.round(70 * scale);
    const gap = Math.round(14 * scale);
    const totalW = cardCount * cardW + (cardCount - 1) * gap;
    const startX = Math.floor(cx - totalW / 2);
    const cardY = Math.floor(cy + yOffset - cardH / 2);

    for (let i = 0; i < cardCount; i += 1) {
      const x = startX + i * (cardW + gap);
      this._drawLargeCardBack(ctx, x, cardY, cardW, cardH, `${claimedRank}?`);
    }
  }

  /**
   * CUTSCENE 3: CALL_LIAR_REVEAL (Duration ~3800ms)
   * - 0.00 -> 0.25: Challenger Name + 2D Pixel "STOP / BẮT BÀI" Emblem
   * - 0.25 -> 0.44: Accused player's cards pull up from table pot and zoom up large in center
   * - 0.44 -> 0.80: Cards flip open ONE BY ONE (lật từng lá)
   * - 0.80 -> 1.00: Big REAL or FAKE verdict stamp
   */
  _drawCallLiarRevealCutscene(ctx, w, h, cs, elapsed, progress) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const {
      callerName = 'Người Bắt Bài',
      accusedName = 'Người Đánh',
      tableRank = 'K',
      revealedCards = [],
      verdictTag = 'FAKE',
      shooterName = ''
    } = cs.payload;

    ctx.fillStyle = 'rgba(12, 8, 6, 0.78)';
    ctx.fillRect(0, 0, w, h);

    // Stage 1: Challenger Name + 2D Pixel Stop/Challenge Symbol (0.0 -> 0.25)
    if (progress < 0.25) {
      this._drawHeadlineBanner(
        ctx,
        cx,
        cy - 115,
        `${callerName.toUpperCase()} — HÔ "BẮT BÀI / LẬT BÀI!"`,
        `Yêu cầu kiểm tra ${revealedCards.length} lá bài vừa đánh của ${accusedName}`,
        '#e03c3c'
      );
      this._draw2DChallengeSymbol(ctx, cx, cy + 12);
      return;
    }

    // Stage 2: Pull cards up from table & zoom large (0.25 -> 0.42)
    const count = Math.max(1, revealedCards.length);
    if (progress < 0.42) {
      const pullP = (progress - 0.25) / 0.17;
      const scale = 0.9 + pullP * 1.15;
      const cardW = Math.round(52 * scale);
      const cardH = Math.round(72 * scale);
      const gap = Math.round(14 * scale);
      const totalW = count * cardW + (count - 1) * gap;
      const startX = Math.floor(cx - totalW / 2);
      const cardY = Math.floor(cy + 40 * (1 - pullP) - cardH / 2);

      this._drawHeadlineBanner(
        ctx,
        cx,
        cy - 126,
        `${callerName.toUpperCase()} ĐANG LẬT BÀI CỦA ${accusedName.toUpperCase()}`,
        `Bài chủ hiện tại: BÀN LÁ ${tableRank}`,
        '#f4b41b'
      );

      for (let i = 0; i < count; i += 1) {
        this._drawLargeCardBack(ctx, startX + i * (cardW + gap), cardY, cardW, cardH);
      }
      return;
    }

    // Stage 3 & 4: Flip cards ONE BY ONE (0.42 -> 0.80) and hold with REAL / FAKE verdict (0.80 -> 1.00)
    const flipWindowP = Math.min(1, (progress - 0.42) / 0.38);
    const scale = 2.05;
    const cardW = Math.round(52 * scale);
    const cardH = Math.round(72 * scale);
    const gap = 22;
    const totalW = count * cardW + (count - 1) * gap;
    const startX = Math.floor(cx - totalW / 2);
    const cardY = Math.floor(cy - 12 - cardH / 2);

    this._drawHeadlineBanner(
      ctx,
      cx,
      cy - 132,
      `XÉT TỪNG LÁ BÀI CỦA ${accusedName.toUpperCase()} (BÀN ${tableRank})`,
      progress >= 0.8
        ? verdictTag === 'REAL'
          ? `KẾT QUẢ: REAL (BÀI THẬT 100%) -> ${shooterName} BẮT SAI PHẢI BẮN SÚNG!`
          : `KẾT QUẢ: FAKE (PHÁT HIỆN BÀI GIẢ!) -> ${shooterName} PHẢI BẮN SÚNG!`
        : `Người bắt bài: ${callerName} — Đang lật từng lá...`,
      progress >= 0.8 ? (verdictTag === 'REAL' ? '#3cd070' : '#e03c3c') : '#f4b41b'
    );

    revealedCards.forEach((card, idx) => {
      const slotStart = idx / count;
      const slotEnd = (idx + 1) / count;
      const localFlipP = Math.max(0, Math.min(1, (flipWindowP - slotStart) / (slotEnd - slotStart)));

      const isMatch = card.rank === tableRank || card.rank === 'J';
      const flipMark = `flip-${idx}`;
      if (localFlipP >= 0.5 && !cs.triggeredMarks.has(flipMark) && this.sound) {
        cs.triggeredMarks.add(flipMark);
        this.sound.cardFlip(isMatch);
      }

      const flipCos = Math.cos(localFlipP * Math.PI);
      const curW = Math.max(8, Math.round(cardW * Math.abs(flipCos)));
      const x = startX + idx * (cardW + gap) + Math.floor((cardW - curW) / 2);

      if (flipCos > 0) {
        this._drawLargeCardBack(ctx, x, cardY, curW, cardH);
      } else {
        const tag = card.rank === 'D' ? 'ÁC QUỶ!' : isMatch ? 'REAL / THẬT' : 'FAKE / GIẢ!';
        this._drawLargeCardFace(ctx, x, cardY, curW, cardH, card.rank, tag, isMatch);
      }
    });

    // Stage 4: Big REAL / FAKE Stamp at bottom of cards
    if (progress >= 0.78) {
      const isReal = verdictTag === 'REAL';
      const stampLabel =
        verdictTag === 'DEVIL'
          ? 'DEVIL TRAP! CẢ BÀN PHẢI BẮN SÚNG!'
          : isReal
          ? `REAL (BÀI THẬT!) — ${shooterName.toUpperCase()} BẮT SAI PHẢI BẮN!`
          : `FAKE (NÓI DỐI!) — ${shooterName.toUpperCase()} BỊ PHẠT BẮN SÚNG!`;
      this._drawVerdictStamp(ctx, cx, cy + 98, stampLabel, isReal ? '#3cd070' : '#e03c3c');
    }
  }

  /**
   * PRE-SHOT STAGE (when state.phase === 'ROULETTE_PENALTY' and no cutscene running):
   * Shows REAL / FAKE badge, Zoomed Avatar of person being shot, Zoomed Revolver spinning 1 full turn,
   * waiting for user to click "BÓP CÒ BẮN!"
   */
  _drawRouletteReadyStage(ctx, w, h, state, now) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const pen = state.pendingPenalty;
    if (!pen) return;

    const shooterId = pen.targetPlayerIds?.[0];
    const shooter = state.players.find((p) => p.id === shooterId) || state.players[0];
    const verdictTag = pen.verdictTag || (pen.wasLying ? 'FAKE' : 'REAL');
    const isReal = verdictTag === 'REAL';

    ctx.fillStyle = 'rgba(12, 8, 6, 0.84)';
    ctx.fillRect(0, 0, w, h);

    // Stage frame
    const stageW = 540;
    const stageH = 260;
    const sx = Math.floor(cx - stageW / 2);
    const sy = Math.floor(cy - stageH / 2);

    ctx.fillStyle = isReal ? '#3cd070' : '#e03c3c';
    ctx.fillRect(sx - 3, sy - 3, stageW + 6, stageH + 6);
    ctx.fillStyle = '#18100c';
    ctx.fillRect(sx, sy, stageW, stageH);

    // Top REAL / FAKE Header inside stage
    const headerBanner =
      verdictTag === 'DEVIL'
        ? 'DEVIL TRAP — BẪY ÁC QUỶ KÍCH HOẠT!'
        : isReal
        ? `REAL (BÀI THẬT 100%) — ${shooter.name.toUpperCase()} BẮT SAI PHẢI BẮN!`
        : `FAKE (BÀI GIẢ / NÓI DỐI) — ${shooter.name.toUpperCase()} PHẢI BẮN!`;

    ctx.fillStyle = isReal ? '#3cd070' : '#e03c3c';
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._fitTextToWidth(ctx, headerBanner, stageW - 24), cx, sy + 26);

    // Left: Zoomed Shooter Avatar (96x96)
    const avaX = sx + 56;
    const avaY = sy + 64;
    this._drawScaledCharacterAvatar(ctx, avaX, avaY, 6, shooter.avatarKey, 'sweat', true);
    ctx.fillStyle = '#f5e6d3';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillText(this._fitTextToWidth(ctx, shooter.name, 150), avaX + 48, avaY + 114);

    // Center: Zoomed Revolver pointing at Avatar
    this._drawZoomedRevolver(ctx, cx - 26, sy + 92, false);

    // Right: Giant 6-Chamber Cylinder spinning 1 full revolution (0 -> 360 deg over first 1.1s)
    const elapsedStage = Math.max(0, now - (this.rouletteStageEnteredAt || now));
    const spinProgress = Math.min(1, elapsedStage / 1100);
    const easeSpin = 1 - Math.pow(1 - spinProgress, 3);
    const angleRad = easeSpin * Math.PI * 2;
    this._drawZoomedCylinder(
      ctx,
      sx + stageW - 96,
      sy + 114,
      40,
      shooter.revolver?.shotsTaken || 0,
      angleRad
    );

    ctx.fillStyle = '#f4b41b';
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillText(
      spinProgress < 1
        ? 'ĐANG QUAY 1 VÒNG Ổ ĐẠN...'
        : `ĐÃ QUAY XONG (${shooter.revolver?.shotsTaken || 0}/6) — BẤM NÚT "BẮN SÚNG" BÊN DƯỚI!`,
      cx,
      sy + stageH - 22
    );
  }

  /**
   * CUTSCENE 4: ROULETTE_SHOT (Duration ~3000ms)
   * - 0.00 -> 0.25: Cylinder rotates 1 notch (+60 deg)
   * - 0.25 -> 1.00:
   *   * FATAL: Bullet streaks and shatters Shooter's Avatar into 16 flying pixel pieces!
   *   * BLANK: No muzzle flash/effect; cylinder rotated 1 notch + "TÍCH! KHÔNG CÓ ĐẠN"
   *   * DODGE (1%): Avatar shrinks (0.6x) and jumps high up dodging the bullet + "HÚ HỒN, NÉ ĐƯỢC NHÉ!"
   */
  _drawRouletteShotCutscene(ctx, w, h, cs, elapsed, progress) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const {
      playerName = 'Người Chơi',
      avatarKey = 'human',
      outcomeType = 'BLANK', // 'BLANK' | 'FATAL' | 'DODGE'
      verdictTag = 'FAKE',
      shotsTaken = 1
    } = cs.payload;

    ctx.fillStyle = 'rgba(12, 8, 6, 0.88)';
    ctx.fillRect(0, 0, w, h);

    const stageW = 540;
    const stageH = 268;
    const sx = Math.floor(cx - stageW / 2);
    const sy = Math.floor(cy - stageH / 2);

    const borderCol =
      outcomeType === 'FATAL' ? '#e03c3c' : outcomeType === 'DODGE' ? '#f4b41b' : '#3cd070';
    ctx.fillStyle = borderCol;
    ctx.fillRect(sx - 3, sy - 3, stageW + 6, stageH + 6);
    ctx.fillStyle = '#18100c';
    ctx.fillRect(sx, sy, stageW, stageH);

    // Top REAL / FAKE badge
    ctx.fillStyle = verdictTag === 'REAL' ? '#3cd070' : '#e03c3c';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `PHÁN QUYẾT [${verdictTag}] — PHÁT BẮN CỦA ${playerName.toUpperCase()} (VIÊN ${shotsTaken}/6)`,
      cx,
      sy + 24
    );

    const avaBaseX = sx + 56;
    const avaBaseY = sy + 68;

    // Phase A (0.0 -> 0.25): Cylinder rotates 1 notch before hammer strikes
    const notchP = Math.min(1, progress / 0.25);
    const cylinderAngle = notchP * (Math.PI / 3);
    const afterStrikeP = progress < 0.25 ? 0 : (progress - 0.25) / 0.75;

    // Trigger sound exactly at hammer strike (progress >= 0.25)
    if (progress >= 0.25 && !cs.triggeredMarks.has('shotSfx')) {
      cs.triggeredMarks.add('shotSfx');
      if (outcomeType === 'FATAL') {
        if (this.sound) this.sound.revolverBang();
        this.triggerGunshotEffect(true);
      } else if (outcomeType === 'DODGE') {
        if (this.sound) this.sound.dodgeJump();
      } else {
        if (this.sound) this.sound.revolverClick();
      }
    }

    // Draw Right-side Cylinder rotating 1 notch
    this._drawZoomedCylinder(
      ctx,
      sx + stageW - 96,
      sy + 118,
      40,
      shotsTaken,
      cylinderAngle
    );

    // Draw Center Zoomed Revolver (with muzzle fire only on FATAL or DODGE)
    const showMuzzleFire =
      progress >= 0.25 &&
      progress <= 0.55 &&
      (outcomeType === 'FATAL' || outcomeType === 'DODGE');
    this._drawZoomedRevolver(ctx, cx - 26, sy + 96, showMuzzleFire);

    // Draw Left-side Shooter Avatar according to outcomeType:
    if (progress < 0.25) {
      this._drawScaledCharacterAvatar(ctx, avaBaseX, avaBaseY, 6, avatarKey, 'shock', true);
      ctx.fillStyle = '#f4b41b';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText('Ổ ĐẠN XOAY 1 NẤC... BÓP CÒ!', cx, sy + stageH - 24);
      return;
    }

    if (outcomeType === 'BLANK') {
      // BLANK: No bullet, no explosion, avatar sighs in relief, "TÍCH! KHÔNG CÓ ĐẠN"
      this._drawScaledCharacterAvatar(ctx, avaBaseX, avaBaseY, 6, avatarKey, 'sweat', true);

      // Draw crisp "TÍCH!" mechanical click tag above gun hammer
      ctx.fillStyle = '#3cd070';
      ctx.fillRect(cx - 56, sy + 54, 112, 24);
      ctx.fillStyle = '#120c09';
      ctx.font = 'bold 12px "Courier New", monospace';
      ctx.fillText('TÍCH! (RỖNG)', cx, sy + 66);

      ctx.fillStyle = '#3cd070';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText(
        `TÍCH! Ô ĐẠN KHÔNG CÓ ĐẠN — ${playerName.toUpperCase()} SỐNG SÓT! (${shotsTaken}/6)`,
        cx,
        sy + stageH - 24
      );
    } else if (outcomeType === 'DODGE') {
      // DODGE (1%): Avatar shrinks down (scale 4 instead of 6) and jumps UP following a sine arc while bullet streaks underneath!
      const jumpArc = Math.sin(Math.min(1, afterStrikeP * 1.4) * Math.PI);
      const jumpY = Math.round(avaBaseY - jumpArc * 46);
      const shrinkScale = 4; // shrunk from 6 -> 4
      this._drawScaledCharacterAvatar(
        ctx,
        avaBaseX + 16,
        jumpY,
        shrinkScale,
        avatarKey,
        'victory',
        true
      );

      // Bullet streaking horizontally right past where the head was!
      const bulletX = Math.round((cx - 30) - afterStrikeP * 240);
      const bulletY = avaBaseY + 42;
      if (bulletX > sx + 12) {
        // Golden bullet + speed trail
        ctx.fillStyle = 'rgba(244, 180, 27, 0.45)';
        ctx.fillRect(bulletX + 14, bulletY + 2, 68, 4);
        ctx.fillStyle = '#f4b41b';
        ctx.fillRect(bulletX, bulletY, 14, 8);
      }

      // Speech banner: "HÚ HỒN, NÉ ĐƯỢC NHÉ!"
      ctx.fillStyle = '#f4b41b';
      ctx.fillRect(cx - 170, sy + stageH - 42, 340, 28);
      ctx.fillStyle = '#120c09';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText('1% BẮN HỤT: "HÚ HỒN, NÉ ĐƯỢC NHÉ!"', cx, sy + stageH - 28);
    } else {
      // FATAL: Bullet strikes and SHATTERS the Shooter's Avatar into 16 flying pixel fragments!
      const bulletTravelP = Math.min(1, afterStrikeP * 4.0);
      if (bulletTravelP < 1) {
        const bx = Math.round((cx - 30) - bulletTravelP * ((cx - 30) - (avaBaseX + 48)));
        ctx.fillStyle = '#ff6b6b';
        ctx.fillRect(bx, avaBaseY + 40, 16, 8);
      }

      // Shatter fragments flying outward
      const shatterP = Math.max(0, (afterStrikeP - 0.15) / 0.85);
      this._drawShatteredAvatar(ctx, avaBaseX, avaBaseY, 6, avatarKey, shatterP);

      ctx.fillStyle = '#e03c3c';
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillText(
        `ĐOÀNG!! VIÊN ĐẠN BẮN VỠ AVATAR — ${playerName.toUpperCase()} ĐÃ BỊ LOẠI!`,
        cx,
        sy + stageH - 24
      );
    }
  }

  _drawShatteredAvatar(ctx, x, y, p, avatarKey, shatterP) {
    const pal = PIXEL_PALETTES[avatarKey] || PIXEL_PALETTES.human;
    const cols = 4;
    const rows = 4;
    const pieceSize = 4 * p;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const dirX = (c - 1.5) * 42 * shatterP;
        const dirY = (r - 1.5) * 38 * shatterP + shatterP * shatterP * 28;
        const px = Math.round(x + c * pieceSize + dirX);
        const py = Math.round(y + r * pieceSize + dirY);

        ctx.fillStyle = (r + c) % 2 === 0 ? pal.main : pal.shirt;
        ctx.fillRect(px, py, pieceSize - 2, pieceSize - 2);
        ctx.strokeStyle = '#e03c3c';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, pieceSize - 2, pieceSize - 2);
      }
    }
  }

  _drawZoomedRevolver(ctx, x, y, muzzleFire = false) {
    // Pointing LEFT toward the Shooter's Avatar
    ctx.fillStyle = '#8b9bb4';
    // Barrel pointing left
    ctx.fillRect(x - 44, y + 12, 56, 14);
    ctx.fillStyle = '#5a6988';
    ctx.fillRect(x - 44, y + 22, 56, 4);
    // Cylinder housing
    ctx.fillStyle = '#c0cbdc';
    ctx.fillRect(x + 6, y + 8, 28, 24);
    // Hammer
    ctx.fillStyle = '#f4b41b';
    ctx.fillRect(x + 34, y + 4, 8, 10);
    // Wooden Grip
    ctx.fillStyle = '#6f3d22';
    ctx.fillRect(x + 26, y + 28, 18, 30);

    if (muzzleFire) {
      ctx.fillStyle = '#f4b41b';
      ctx.fillRect(x - 74, y + 4, 28, 28);
      ctx.fillStyle = '#e03c3c';
      ctx.fillRect(x - 66, y + 10, 18, 16);
    }
  }

  _drawZoomedCylinder(ctx, cx, cy, radius, shotsTaken, angleRad) {
    // Outer brass/steel cylinder ring
    ctx.fillStyle = '#2b2520';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#f4b41b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
    ctx.stroke();

    // 6 rotating chambers
    for (let i = 0; i < 6; i += 1) {
      const a = angleRad + (i * Math.PI * 2) / 6 - Math.PI / 2;
      const hx = Math.round(cx + Math.cos(a) * (radius * 0.58));
      const hy = Math.round(cy + Math.sin(a) * (radius * 0.58));
      ctx.fillStyle = i < shotsTaken ? '#e03c3c' : '#120c09';
      ctx.beginPath();
      ctx.arc(hx, hy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8b7d70';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Center axis pin
    ctx.fillStyle = '#f4b41b';
    ctx.fillRect(cx - 4, cy - 4, 8, 8);
  }

  _draw2DChallengeSymbol(ctx, cx, cy) {
    // 2D Pixel Art "BẮT BÀI / DỪNG BÀI" Octagon Shield + Hand/Exclamation Emblem
    const size = 96;
    const x = Math.floor(cx - size / 2);
    const y = Math.floor(cy - size / 2);

    ctx.fillStyle = '#f4b41b';
    ctx.fillRect(x - 4, y - 4, size + 8, size + 8);
    ctx.fillStyle = '#b02a2a';
    ctx.fillRect(x, y, size, size);

    // Inner pixel hand / exclamation mark
    ctx.fillStyle = '#fdf6e3';
    ctx.fillRect(cx - 8, y + 16, 16, 38);
    ctx.fillRect(cx - 8, y + 62, 16, 14);
  }

  _drawHeadlineBanner(ctx, cx, cy, title, subtitle, borderColor = '#f4b41b') {
    const boxW = 620;
    const boxH = 62;
    const bx = Math.floor(cx - boxW / 2);
    const by = Math.floor(cy - boxH / 2);

    ctx.fillStyle = borderColor;
    ctx.fillRect(bx - 3, by - 3, boxW + 6, boxH + 6);
    ctx.fillStyle = '#160f0b';
    ctx.fillRect(bx, by, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = borderColor;
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.fillText(this._fitTextToWidth(ctx, title, boxW - 24), cx, by + 21);

    ctx.fillStyle = '#f5e6d3';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillText(this._fitTextToWidth(ctx, subtitle, boxW - 24), cx, by + 44);
  }

  _drawVerdictStamp(ctx, cx, cy, text, color) {
    ctx.font = 'bold 14px "Courier New", monospace';
    const fitted = this._fitTextToWidth(ctx, text, 540);
    const w = Math.max(260, Math.ceil(ctx.measureText(fitted).width) + 32);
    const h = 34;
    const x = Math.floor(cx - w / 2);
    const y = Math.floor(cy - h / 2);

    ctx.fillStyle = color;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = '#120c09';
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitted, cx, y + Math.floor(h / 2));
  }

  _drawLargeCardBack(ctx, x, y, w, h, badgeText = '') {
    ctx.fillStyle = '#f5e6d3';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = '#8c2222';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#f4b41b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 6, y + 6, Math.max(4, w - 12), Math.max(4, h - 12));

    if (badgeText && w >= 44) {
      ctx.fillStyle = '#f4b41b';
      ctx.font = 'bold 14px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, Math.floor(x + w / 2), Math.floor(y + h / 2));
    }
  }

  _drawLargeCardFace(ctx, x, y, w, h, rank, bottomLabel, isMatch) {
    const borderCol = isMatch ? '#3cd070' : '#e03c3c';
    ctx.fillStyle = borderCol;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = '#fdf6e3';
    ctx.fillRect(x, y, w, h);

    if (w >= 26) {
      ctx.fillStyle = RANK_COLORS[rank] || '#120c09';
      ctx.font = `bold ${Math.max(16, Math.round(h * 0.34))}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rank, Math.floor(x + w / 2), Math.floor(y + h * 0.42));

      if (w >= 48) {
        ctx.fillStyle = isMatch ? '#1b6e38' : '#a61e1e';
        ctx.font = 'bold 11px "Courier New", monospace';
        ctx.fillText(bottomLabel, Math.floor(x + w / 2), Math.floor(y + h * 0.78));
      }
    }
  }

  _drawTavernBackground(ctx, w, h) {
    ctx.fillStyle = '#120c09';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#19110d';
    for (let y = 0; y < h; y += 25) {
      ctx.fillRect(0, y, w, 2);
    }
    for (let x = 0; x < w; x += 60) {
      ctx.fillRect(x, 0, 2, h);
    }

    ctx.strokeStyle = '#3b2416';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    const flicker = Math.sin(this.tick * 0.08) * 5;
    ctx.fillStyle = 'rgba(244, 180, 27, 0.04)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 220 + flicker, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawTavernTable(ctx, w, h) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const rx = 276;
    const ry = 138;

    ctx.fillStyle = '#3d2314';
    this._fillPixelEllipse(ctx, cx, cy, rx + 18, ry + 18);

    ctx.fillStyle = '#5c3822';
    this._fillPixelEllipse(ctx, cx, cy, rx + 10, ry + 10);

    ctx.fillStyle = '#163828';
    this._fillPixelEllipse(ctx, cx, cy, rx, ry);

    ctx.strokeStyle = '#255c42';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 170, cy - 78, 340, 156);

    ctx.fillStyle = '#f4b41b';
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const sx = Math.round(cx + Math.cos(angle) * (rx + 12));
      const sy = Math.round(cy + Math.sin(angle) * (ry + 12));
      ctx.fillRect(sx - 3, sy - 3, 6, 6);
    }
  }

  _fillPixelEllipse(ctx, cx, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _getSeatCoordinates(w, h) {
    return [
      { x: Math.floor(w * 0.5), y: h - 54, align: 'bottom' },
      { x: 122, y: Math.floor(h * 0.5), align: 'left' },
      { x: Math.floor(w * 0.5), y: 54, align: 'top' },
      { x: w - 122, y: Math.floor(h * 0.5), align: 'right' }
    ];
  }

  _drawPlayersAroundTable(ctx, w, h, state) {
    const coords = this._getSeatCoordinates(w, h);
    const penaltyTargets = state.pendingPenalty?.targetPlayerIds || [];

    state.players.forEach((player, idx) => {
      const pos = coords[idx] || coords[0];
      const isTurn =
        state.currentTurnIndex === idx &&
        (state.phase === 'TURN_PLAY_OR_CHALLENGE' || state.phase === 'FINAL_CHALLENGE_WINDOW');
      const isPenaltyTarget =
        state.phase === 'ROULETTE_PENALTY' && penaltyTargets.includes(player.id);

      this._drawSeatNode(ctx, w, h, pos.x, pos.y, pos.align, player, isTurn, isPenaltyTarget);
    });
  }

  _drawSeatNode(ctx, canvasW, canvasH, x, y, align, player, isTurn, isPenaltyTarget) {
    const bob = player.alive ? Math.round(Math.sin((this.tick + player.seatIndex * 15) * 0.1) * 1.5) : 0;

    const boxW = 196;
    const boxH = 76;
    const bx = Math.max(14, Math.min(canvasW - boxW - 14, Math.floor(x - boxW / 2)));
    const by = Math.max(12, Math.min(canvasH - boxH - 12, Math.floor(y - boxH / 2)));

    if (isPenaltyTarget) {
      ctx.fillStyle = this.tick % 16 < 8 ? '#e03c3c' : '#7a1c1c';
      ctx.fillRect(bx - 3, by - 3, boxW + 6, boxH + 6);
    } else if (isTurn) {
      ctx.fillStyle = '#f4b41b';
      ctx.fillRect(bx - 3, by - 3, boxW + 6, boxH + 6);
    } else {
      ctx.fillStyle = '#473021';
      ctx.fillRect(bx - 2, by - 2, boxW + 4, boxH + 4);
    }

    ctx.fillStyle = player.alive ? '#1e140e' : '#140f0d';
    ctx.fillRect(bx, by, boxW, boxH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + 2, by + 2, boxW - 4, boxH - 4);
    ctx.clip();

    const spriteX = bx + 8;
    const spriteY = by + 14 + bob;
    this._drawScaledCharacterAvatar(
      ctx,
      spriteX,
      spriteY,
      3,
      player.avatarKey,
      player.lastEmotion,
      player.alive,
      isPenaltyTarget
    );

    const textStartX = bx + 64;
    const maxTextW = boxW - 64 - 10;

    // Row 1: Player Name
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillStyle = !player.alive ? '#776b63' : isTurn ? '#f4b41b' : '#f5e6d3';
    const fittedName = this._fitTextToWidth(ctx, player.name, maxTextW);
    ctx.fillText(fittedName, textStartX, by + 18);

    // Row 2: Card Count + Pixel Card Icons
    ctx.font = 'bold 11px "Courier New", monospace';
    if (!player.alive) {
      this._drawPixelSkullIcon(ctx, textStartX, by + 33);
      ctx.fillStyle = '#e03c3c';
      ctx.fillText('ĐÃ CHẾT (LOẠI)', textStartX + 14, by + 38);
    } else if (player.safeForRound) {
      ctx.fillStyle = '#3cd070';
      ctx.fillText('THẮNG VÁN CON', textStartX, by + 38);
    } else if (player.handCount === 0) {
      ctx.fillStyle = '#3cd070';
      ctx.fillText('HẾT BÀI (0 LÁ)', textStartX, by + 38);
    } else {
      this._drawPixelCardIcon(ctx, textStartX, by + 32);
      ctx.fillStyle = '#d8c3a5';
      ctx.fillText(`${player.handCount} LÁ`, textStartX + 13, by + 38);

      const cardsStartX = textStartX + 52;
      for (let c = 0; c < Math.min(5, player.handCount); c += 1) {
        const cx = cardsStartX + c * 11;
        ctx.fillStyle = '#c84b31';
        ctx.fillRect(cx, by + 31, 8, 12);
        ctx.fillStyle = '#f5e6d3';
        ctx.fillRect(cx + 1, by + 32, 6, 10);
      }
    }

    // Row 3: 6-Chamber Revolver Status Bar
    const shots = player.revolver?.shotsTaken || 0;
    this._drawPixelGunIcon(ctx, textStartX, by + 54);
    ctx.fillStyle = '#a89984';
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillText(`${shots}/6`, textStartX + 14, by + 58);

    const chamberStartX = textStartX + 44;
    for (let ch = 0; ch < 6; ch += 1) {
      const chX = chamberStartX + ch * 11;
      const chY = by + 52;
      ctx.fillStyle = ch < shots ? '#e03c3c' : '#3c3836';
      ctx.fillRect(chX, chY, 8, 10);
      ctx.fillStyle = ch < shots ? '#ff9b85' : '#665c54';
      ctx.fillRect(chX + 1, chY + 1, 6, 8);
    }

    ctx.restore();

    if (player.lastSpeech && !this.cutscene) {
      this._drawSpeechBubble(ctx, canvasW, canvasH, bx + boxW / 2, by, boxH, align, player.lastSpeech, isPenaltyTarget);
    }
  }

  _drawPixelCardIcon(ctx, x, y) {
    ctx.fillStyle = '#f4b41b';
    ctx.fillRect(x, y, 9, 11);
    ctx.fillStyle = '#18100c';
    ctx.fillRect(x + 2, y + 2, 5, 7);
  }

  _drawPixelGunIcon(ctx, x, y) {
    ctx.fillStyle = '#d5c4a1';
    ctx.fillRect(x, y, 10, 4);
    ctx.fillRect(x, y + 4, 4, 4);
  }

  _drawPixelSkullIcon(ctx, x, y) {
    ctx.fillStyle = '#e03c3c';
    ctx.fillRect(x + 1, y, 8, 7);
    ctx.fillRect(x + 2, y + 7, 6, 3);
    ctx.fillStyle = '#140f0d';
    ctx.fillRect(x + 2, y + 2, 2, 2);
    ctx.fillRect(x + 6, y + 2, 2, 2);
  }

  _drawScaledCharacterAvatar(ctx, x, y, p, avatarKey, emotion, alive, isPenaltyTarget = false) {
    const pal = PIXEL_PALETTES[avatarKey] || PIXEL_PALETTES.human;

    ctx.fillStyle = alive ? '#2c1e16' : '#1a110e';
    ctx.fillRect(x, y, 16 * p, 16 * p);
    ctx.strokeStyle = '#5c3822';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 16 * p - 1, 16 * p - 1);

    if (avatarKey === 'fox' || avatarKey === 'wolf') {
      ctx.fillStyle = pal.main;
      ctx.fillRect(x + 2 * p, y + 1 * p, 3 * p, 3 * p);
      ctx.fillRect(x + 11 * p, y + 1 * p, 3 * p, 3 * p);
      ctx.fillStyle = pal.ear;
      ctx.fillRect(x + 3 * p, y + 2 * p, 1 * p, 2 * p);
      ctx.fillRect(x + 12 * p, y + 2 * p, 1 * p, 2 * p);
    } else if (avatarKey === 'pig') {
      ctx.fillStyle = pal.ear;
      ctx.fillRect(x + 1 * p, y + 2 * p, 3 * p, 2 * p);
      ctx.fillRect(x + 12 * p, y + 2 * p, 3 * p, 2 * p);
    } else {
      ctx.fillStyle = pal.hat;
      ctx.fillRect(x + 1 * p, y + 2 * p, 14 * p, 2 * p);
      ctx.fillRect(x + 3 * p, y + 0 * p, 10 * p, 2 * p);
      ctx.fillStyle = pal.band;
      ctx.fillRect(x + 3 * p, y + 2 * p, 10 * p, 1 * p);
    }

    ctx.fillStyle = alive ? pal.main : '#504945';
    ctx.fillRect(x + 3 * p, y + 4 * p, 10 * p, 8 * p);

    if (pal.muzzle && alive) {
      ctx.fillStyle = pal.muzzle;
      ctx.fillRect(x + 5 * p, y + 8 * p, 6 * p, 3 * p);
    }

    if (!alive || emotion === 'dead') {
      ctx.fillStyle = '#e03c3c';
      ctx.fillRect(x + 4 * p, y + 5 * p, 2 * p, 2 * p);
      ctx.fillRect(x + 10 * p, y + 5 * p, 2 * p, 2 * p);
      // Crack line across dead avatar
      ctx.fillRect(x + 7 * p, y + 4 * p, 1 * p, 8 * p);
    } else if (emotion === 'shock') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 4 * p, y + 5 * p, 2 * p, 2 * p);
      ctx.fillRect(x + 10 * p, y + 5 * p, 2 * p, 2 * p);
      ctx.fillStyle = '#120d0a';
      ctx.fillRect(x + 5 * p, y + 6 * p, 1 * p, 1 * p);
      ctx.fillRect(x + 10 * p, y + 6 * p, 1 * p, 1 * p);
    } else {
      ctx.fillStyle = pal.eye;
      ctx.fillRect(x + 4 * p, y + 6 * p, 2 * p, 1 * p);
      ctx.fillRect(x + 10 * p, y + 6 * p, 2 * p, 1 * p);
    }

    if (alive && (emotion === 'sweat' || isPenaltyTarget)) {
      ctx.fillStyle = '#4ea8de';
      ctx.fillRect(x + 13 * p, y + 5 * p, 1 * p, 2 * p);
    }

    ctx.fillStyle = '#120d0a';
    if (emotion === 'smirk' || emotion === 'victory') {
      ctx.fillRect(x + 6 * p, y + 10 * p, 4 * p, 1 * p);
      ctx.fillRect(x + 10 * p, y + 9 * p, 1 * p, 1 * p);
    } else {
      ctx.fillRect(x + 6 * p, y + 10 * p, 4 * p, 1 * p);
    }

    ctx.fillStyle = pal.shirt;
    ctx.fillRect(x + 2 * p, y + 12 * p, 12 * p, 4 * p);
  }

  _drawSpeechBubble(ctx, canvasW, canvasH, seatCenterX, seatTopY, seatBoxH, align, text, isUrgent) {
    ctx.font = 'bold 11px "Courier New", monospace';
    const maxAllowedTextW = 200;
    const fittedText = this._fitTextToWidth(ctx, text, maxAllowedTextW);
    const measuredW = Math.ceil(ctx.measureText(fittedText).width);

    const bubbleW = Math.max(96, measuredW + 20);
    const bubbleH = 24;

    const bx = Math.max(14, Math.min(canvasW - bubbleW - 14, Math.floor(seatCenterX - bubbleW / 2)));
    const rawBy = align === 'top' ? seatTopY + seatBoxH + 8 : seatTopY - bubbleH - 8;
    const by = Math.max(10, Math.min(canvasH - bubbleH - 10, rawBy));

    ctx.fillStyle = isUrgent ? '#e03c3c' : '#f4b41b';
    ctx.fillRect(bx - 2, by - 2, bubbleW + 4, bubbleH + 4);
    ctx.fillStyle = '#18100c';
    ctx.fillRect(bx, by, bubbleW, bubbleH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + 4, by + 2, bubbleW - 8, bubbleH - 4);
    ctx.clip();

    ctx.fillStyle = isUrgent ? '#ffb4a2' : '#f5e6d3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fittedText, Math.floor(bx + bubbleW / 2), Math.floor(by + bubbleH / 2));
    ctx.restore();
  }

  _drawCenterPotAndReveal(ctx, w, h, state) {
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);

    // 1. Key Card Banner at upper-center of felt
    const rankColor = RANK_COLORS[state.tableRank] || '#f4b41b';
    const titleStr = `KEY VÁN ${state.roundNumber}: BÀN LÁ ${state.tableRank}`;
    ctx.font = 'bold 13px "Courier New", monospace';
    const bannerW = Math.max(210, Math.ceil(ctx.measureText(titleStr).width) + 28);
    const bannerH = 28;
    const bannerX = Math.floor(cx - bannerW / 2);
    const bannerY = cy - 68;

    ctx.fillStyle = rankColor;
    ctx.fillRect(bannerX - 2, bannerY - 2, bannerW + 4, bannerH + 4);
    ctx.fillStyle = '#140d0a';
    ctx.fillRect(bannerX, bannerY, bannerW, bannerH);

    ctx.fillStyle = rankColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(titleStr, cx, bannerY + Math.floor(bannerH / 2));

    // 2. If in ROUND_END or GAME_OVER with revealedCards, draw summary
    const revealed = state.pendingPenalty?.revealedCards || state.lastChallengeResolution?.revealedCards;
    if (
      revealed &&
      revealed.length > 0 &&
      (state.phase === 'ROUND_END' || state.phase === 'GAME_OVER')
    ) {
      const cardW = 46;
      const cardH = 62;
      const gap = 12;
      const totalW = revealed.length * cardW + (revealed.length - 1) * gap;
      const startX = Math.floor(cx - totalW / 2);
      const cardY = cy - 28;

      revealed.forEach((card, i) => {
        const x = startX + i * (cardW + gap);
        this._drawPixelCardFace(ctx, x, cardY, cardW, cardH, card.rank, state.tableRank);
      });

      const res = state.lastRouletteResult;
      const rawStamp = res
        ? res.isMiracleDodge
          ? `[1% NÉ ĐẠN!] ${res.playerName}: "Hú hồn, né được nhé!"`
          : res.isFatal
          ? `[ĐOÀNG!] ${res.playerName} đã bị bắn vỡ Avatar!`
          : `[TÍCH! ĐẠN RỖNG] ${res.playerName} sống sót (${res.shotsTaken}/6)`
        : 'Kết thúc ván con';

      ctx.font = 'bold 11px "Courier New", monospace';
      const fittedStamp = this._fitTextToWidth(ctx, rawStamp, 320);
      const stampW = Math.ceil(ctx.measureText(fittedStamp).width) + 20;
      const stampH = 22;
      const stampX = Math.floor(cx - stampW / 2);
      const stampY = cy + 44;

      ctx.fillStyle = res?.isFatal ? '#e03c3c' : '#3cd070';
      ctx.fillRect(stampX - 2, stampY - 2, stampW + 4, stampH + 4);
      ctx.fillStyle = '#140d0a';
      ctx.fillRect(stampX, stampY, stampW, stampH);

      ctx.fillStyle = res?.isFatal ? '#ff8787' : '#69db7c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fittedStamp, cx, stampY + Math.floor(stampH / 2));
      return;
    }

    // 3. Otherwise draw the face-down center pile and last claim info
    if (state.pileCount > 0) {
      const stackCount = Math.min(5, state.pileCount);
      for (let i = 0; i < stackCount; i += 1) {
        const ox = Math.floor(cx - 20 + (i - (stackCount - 1) / 2) * 6);
        const oy = cy - 26 - i * 2;
        ctx.fillStyle = '#f5e6d3';
        ctx.fillRect(ox - 2, oy - 2, 40, 52);
        ctx.fillStyle = '#9e2a2b';
        ctx.fillRect(ox, oy, 36, 48);
        ctx.fillStyle = '#f4b41b';
        ctx.fillRect(ox + 8, oy + 10, 20, 28);
      }

      ctx.fillStyle = '#f5e6d3';
      ctx.font = 'bold 11px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Tụ bài giữa bàn: ${state.pileCount} lá úp`, cx, cy + 36);

      if (state.lastPlay) {
        const claimStr = this._fitTextToWidth(
          ctx,
          `${state.lastPlay.playerName} vừa đánh: ${state.lastPlay.claimedCount} Lá ${state.lastPlay.claimedRank}`,
          310
        );
        ctx.fillStyle = '#f4b41b';
        ctx.fillText(claimStr, cx, cy + 54);
      }
    } else {
      ctx.fillStyle = '#9ab092';
      ctx.font = 'bold 12px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BÀN TRỐNG — CHỌN 1-3 LÁ ĐỂ ĐÁNH MỞ MÀN', cx, cy + 4);
    }
  }

  _drawPixelCardFace(ctx, x, y, w, h, rank, tableRank) {
    const isMatch = rank === tableRank || rank === 'J';
    const borderCol = isMatch ? '#3cd070' : '#e03c3c';
    ctx.fillStyle = borderCol;
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);

    ctx.fillStyle = '#fdf6e3';
    ctx.fillRect(x, y, w, h);

    const col = RANK_COLORS[rank] || '#120d0a';
    ctx.fillStyle = col;
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rank, Math.floor(x + w / 2), Math.floor(y + h * 0.42));

    ctx.font = 'bold 9px "Courier New", monospace';
    ctx.fillStyle = isMatch ? '#1b6e38' : '#a61e1e';
    ctx.fillText(
      rank === 'D' ? 'ÁC QUỶ' : isMatch ? 'REAL' : 'FAKE',
      Math.floor(x + w / 2),
      Math.floor(y + h * 0.78)
    );
  }
}
