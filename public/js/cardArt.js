/**
 * 2D Pixel Art Playing Card & Avatar Renderer (Canvas)
 * Authentic playing-card proportions, corner indices, and pixel-art emblems:
 * - K: Royal Gold Crown
 * - Q: Crimson Tiara & Gem
 * - A: Iconic Ace of Spades pixel emblem
 * - J (Joker): Jester Hat with bells
 * - D (Devil): Horned Devil emblem (no text label)
 * - Poker (2..A + S/H/D/C): Classic Spades, Hearts, Diamonds, Clubs
 */

export const AVATAR_LIST = [
  { key: 'human', label: 'Cao Bồi' },
  { key: 'fox', label: 'Cáo Già' },
  { key: 'wolf', label: 'Sói Độc' },
  { key: 'pig', label: 'Heo Ngầu' },
  { key: 'cat', label: 'Mèo Đen' },
  { key: 'owl', label: 'Cú Đêm' }
];

const AVATAR_PALETTES = {
  human: { main: '#d99b66', hat: '#3b281e', band: '#f4b41b', shirt: '#2a4d69', eye: '#120d0a' },
  fox: { main: '#d95b26', ear: '#f2a65a', muzzle: '#f5e6d3', shirt: '#4a2511', eye: '#120d0a' },
  wolf: { main: '#6c757d', ear: '#adb5bd', muzzle: '#dee2e6', shirt: '#3a1f2d', eye: '#f4b41b' },
  pig: { main: '#e5989b', ear: '#b56576', muzzle: '#ffb4a2', shirt: '#2d4739', eye: '#120d0a' },
  cat: { main: '#2b2d42', ear: '#8d99ae', muzzle: '#edf2f4', shirt: '#5c2a4d', eye: '#3cd070' },
  owl: { main: '#8c5a3c', ear: '#d4a373', muzzle: '#faedcd', shirt: '#283618', eye: '#f4b41b' }
};

export function drawPixelAvatar(canvas, avatarKey = 'human') {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const pal = AVATAR_PALETTES[avatarKey] || AVATAR_PALETTES.human;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.scale(w / 16, h / 16);
  const p = 1;

  ctx.fillStyle = '#2c1d15';
  ctx.fillRect(0, 0, 16, 16);

  if (avatarKey === 'fox' || avatarKey === 'wolf' || avatarKey === 'cat' || avatarKey === 'owl') {
    ctx.fillStyle = pal.main;
    ctx.fillRect(2 * p, 1 * p, 3 * p, 3 * p);
    ctx.fillRect(11 * p, 1 * p, 3 * p, 3 * p);
    ctx.fillStyle = pal.ear;
    ctx.fillRect(3 * p, 2 * p, 1 * p, 2 * p);
    ctx.fillRect(12 * p, 2 * p, 1 * p, 2 * p);
  } else if (avatarKey === 'pig') {
    ctx.fillStyle = pal.ear;
    ctx.fillRect(1 * p, 2 * p, 3 * p, 2 * p);
    ctx.fillRect(12 * p, 2 * p, 3 * p, 2 * p);
  } else {
    ctx.fillStyle = pal.hat;
    ctx.fillRect(1 * p, 2 * p, 14 * p, 2 * p);
    ctx.fillRect(3 * p, 0 * p, 10 * p, 2 * p);
    ctx.fillStyle = pal.band;
    ctx.fillRect(3 * p, 2 * p, 10 * p, 1 * p);
  }

  ctx.fillStyle = pal.main;
  ctx.fillRect(3 * p, 4 * p, 10 * p, 8 * p);

  if (pal.muzzle) {
    ctx.fillStyle = pal.muzzle;
    ctx.fillRect(5 * p, 8 * p, 6 * p, 3 * p);
  }

  ctx.fillStyle = pal.eye;
  ctx.fillRect(4 * p, 6 * p, 2 * p, 2 * p);
  ctx.fillRect(10 * p, 6 * p, 2 * p, 2 * p);

  ctx.fillStyle = '#120d0a';
  ctx.fillRect(6 * p, 10 * p, 4 * p, 1 * p);

  ctx.fillStyle = pal.shirt;
  ctx.fillRect(2 * p, 12 * p, 12 * p, 4 * p);
  ctx.restore();
}

const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };

function drawPixelSpade(ctx, cx, cy, s, color) {
  ctx.fillStyle = color;
  // Pointed top
  ctx.fillRect(cx - s, cy - 5 * s, 2 * s, 2 * s);
  ctx.fillRect(cx - 3 * s, cy - 3 * s, 6 * s, 2 * s);
  ctx.fillRect(cx - 5 * s, cy - 1 * s, 10 * s, 3 * s);
  ctx.fillRect(cx - 4 * s, cy + 2 * s, 3 * s, 1 * s);
  ctx.fillRect(cx + 1 * s, cy + 2 * s, 3 * s, 1 * s);
  // Stem
  ctx.fillRect(cx - 1 * s, cy + 2 * s, 2 * s, 3 * s);
  ctx.fillRect(cx - 3 * s, cy + 4 * s, 6 * s, 1 * s);
}

function drawPixelCrown(ctx, cx, cy, s, goldCol, gemCol) {
  ctx.fillStyle = goldCol;
  ctx.fillRect(cx - 6 * s, cy + 2 * s, 12 * s, 3 * s);
  ctx.fillRect(cx - 6 * s, cy - 2 * s, 2 * s, 4 * s);
  ctx.fillRect(cx - 1 * s, cy - 4 * s, 2 * s, 6 * s);
  ctx.fillRect(cx + 4 * s, cy - 2 * s, 2 * s, 4 * s);
  ctx.fillRect(cx - 4 * s, cy, 3 * s, 2 * s);
  ctx.fillRect(cx + 1 * s, cy, 3 * s, 2 * s);
  // Jewels
  ctx.fillStyle = gemCol;
  ctx.fillRect(cx - 6 * s, cy - 4 * s, 2 * s, 2 * s);
  ctx.fillRect(cx - 1 * s, cy - 6 * s, 2 * s, 2 * s);
  ctx.fillRect(cx + 4 * s, cy - 4 * s, 2 * s, 2 * s);
  ctx.fillRect(cx - 1 * s, cy + 3 * s, 2 * s, 1 * s);
}

function drawPixelTiara(ctx, cx, cy, s, mainCol, accentCol) {
  ctx.fillStyle = mainCol;
  ctx.fillRect(cx - 5 * s, cy + 2 * s, 10 * s, 2 * s);
  ctx.fillRect(cx - 4 * s, cy - 1 * s, 2 * s, 3 * s);
  ctx.fillRect(cx - 1 * s, cy - 4 * s, 2 * s, 6 * s);
  ctx.fillRect(cx + 2 * s, cy - 1 * s, 2 * s, 3 * s);
  ctx.fillStyle = accentCol;
  ctx.fillRect(cx - 1 * s, cy - 6 * s, 2 * s, 2 * s);
  ctx.fillRect(cx - 5 * s, cy - 2 * s, 1 * s, 1 * s);
  ctx.fillRect(cx + 4 * s, cy - 2 * s, 1 * s, 1 * s);
}

function drawPixelDevil(ctx, cx, cy, s) {
  // Curved Devil Horns
  ctx.fillStyle = '#ff3b3b';
  ctx.fillRect(cx - 6 * s, cy - 6 * s, 2 * s, 3 * s);
  ctx.fillRect(cx - 5 * s, cy - 4 * s, 2 * s, 2 * s);
  ctx.fillRect(cx + 4 * s, cy - 6 * s, 2 * s, 3 * s);
  ctx.fillRect(cx + 3 * s, cy - 4 * s, 2 * s, 2 * s);
  // Devil Head
  ctx.fillStyle = '#c9182b';
  ctx.fillRect(cx - 4 * s, cy - 3 * s, 8 * s, 7 * s);
  ctx.fillRect(cx - 3 * s, cy + 4 * s, 6 * s, 2 * s);
  // Glowing Eyes
  ctx.fillStyle = '#ffe066';
  ctx.fillRect(cx - 3 * s, cy - 1 * s, 2 * s, 2 * s);
  ctx.fillRect(cx + 1 * s, cy - 1 * s, 2 * s, 2 * s);
  // Sinister Grin
  ctx.fillStyle = '#12080a';
  ctx.fillRect(cx - 2 * s, cy + 2 * s, 4 * s, 2 * s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 2 * s, cy + 2 * s, 1 * s, 1 * s);
  ctx.fillRect(cx + 1 * s, cy + 2 * s, 1 * s, 1 * s);
}

function drawPixelJester(ctx, cx, cy, s) {
  ctx.fillStyle = '#2b9348';
  ctx.fillRect(cx - 5 * s, cy + 1 * s, 10 * s, 3 * s);
  ctx.fillRect(cx - 5 * s, cy - 3 * s, 3 * s, 4 * s);
  ctx.fillRect(cx - 1 * s, cy - 5 * s, 2 * s, 6 * s);
  ctx.fillRect(cx + 2 * s, cy - 3 * s, 3 * s, 4 * s);
  ctx.fillStyle = '#f4b41b';
  ctx.fillRect(cx - 6 * s, cy - 4 * s, 2 * s, 2 * s);
  ctx.fillRect(cx - 1 * s, cy - 6 * s, 2 * s, 2 * s);
  ctx.fillRect(cx + 4 * s, cy - 4 * s, 2 * s, 2 * s);
}

export function drawPixelCard(canvas, card, { isKeyCard = false } = {}) {
  if (!canvas || !card) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const isDevil = card.rank === 'D';
  const isJoker = card.rank === 'J' && !card.suit;
  const isRedSuit = card.suit === 'H' || card.suit === 'D';

  // Outer crisp dark border
  ctx.fillStyle = '#0d0907';
  ctx.fillRect(0, 0, w, h);

  // Colored card frame
  const frameCol = isDevil ? '#e03c3c' : isJoker ? '#3cd070' : isKeyCard ? '#f4b41b' : '#c8b69c';
  ctx.fillStyle = frameCol;
  ctx.fillRect(2, 2, w - 4, h - 4);

  // Card body
  ctx.fillStyle = isDevil ? '#1c080c' : isJoker ? '#102418' : '#fdf8ec';
  ctx.fillRect(4, 4, w - 8, h - 8);

  // Subtle inner filigree border
  ctx.strokeStyle = isDevil ? '#7a1622' : isJoker ? '#266b41' : '#e0d3bd';
  ctx.lineWidth = 1;
  ctx.strokeRect(6.5, 6.5, w - 13, h - 13);

  const mainCol = isDevil
    ? '#ff4d4d'
    : isJoker
    ? '#3cd070'
    : card.suit
    ? isRedSuit
      ? '#c92a2a'
      : '#1a1412'
    : card.rank === 'K'
    ? '#b86b00'
    : card.rank === 'Q'
    ? '#b51754'
    : '#1a1412';

  const cornerFontSize = Math.max(11, Math.floor(w * 0.19));
  ctx.fillStyle = mainCol;
  ctx.font = `bold ${cornerFontSize}px "Courier New", monospace`;
  const cornerTxt = card.suit ? `${card.rank}${SUIT_SYMBOLS[card.suit] || ''}` : card.rank;

  // Top-left index
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(cornerTxt, 8, 7);

  // Bottom-right index
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(cornerTxt, w - 8, h - 7);

  // Center artwork
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const s = Math.max(2, Math.floor(w / 24));

  if (isDevil) {
    drawPixelDevil(ctx, cx, cy, s);
  } else if (isJoker) {
    drawPixelJester(ctx, cx, cy, s);
  } else if (card.suit) {
    ctx.fillStyle = mainCol;
    ctx.font = `bold ${Math.floor(w * 0.38)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SUIT_SYMBOLS[card.suit] || card.rank, cx, cy);
  } else if (card.rank === 'K') {
    drawPixelCrown(ctx, cx, cy, s, '#e09f1f', '#e03c3c');
  } else if (card.rank === 'Q') {
    drawPixelTiara(ctx, cx, cy, s, '#d6336c', '#f4b41b');
  } else {
    drawPixelSpade(ctx, cx, cy, s, '#1a1412');
  }
}
