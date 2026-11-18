/**
 * SQLite Persistence Layer (Node.js built-in node:sqlite)
 * Stores player profiles (id, token, name, avatarKey, wins, losses)
 * and match history records.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'liars_bar.db');

export class GameDatabase {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this._initSchema();
  }

  _initSchema() {
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        token TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        avatar_key TEXT NOT NULL DEFAULT 'human',
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        matches_played INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS match_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL,
        room_name TEXT NOT NULL,
        game_type TEXT NOT NULL,
        result TEXT NOT NULL,
        placement INTEGER NOT NULL DEFAULT 0,
        total_players INTEGER NOT NULL DEFAULT 0,
        rounds_played INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players(id)
      );

      CREATE INDEX IF NOT EXISTS idx_players_token ON players(token);
      CREATE INDEX IF NOT EXISTS idx_history_player ON match_history(player_id, created_at DESC);
    `);
  }

  createOrGetPlayer({ playerId, token, name, avatarKey }) {
    if (token) {
      const existing = this.getPlayerByToken(token);
      if (existing) {
        return existing;
      }
    }

    const now = Date.now();
    const id = playerId || `u-${crypto.randomUUID().slice(0, 12)}`;
    const newToken = crypto.randomBytes(24).toString('hex');
    const cleanName = sanitizeName(name) || 'Tay Chơi Bí Ẩn';
    const cleanAvatar = sanitizeAvatar(avatarKey);

    const stmt = this.db.prepare(`
      INSERT INTO players (id, token, name, avatar_key, wins, losses, matches_played, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)
    `);
    stmt.run(id, newToken, cleanName, cleanAvatar, now, now);

    return this.getPlayerById(id);
  }

  getPlayerByToken(token) {
    if (!token || typeof token !== 'string') return null;
    const row = this.db.prepare(`SELECT * FROM players WHERE token = ?`).get(token);
    return row ? this._mapPlayer(row) : null;
  }

  getPlayerById(id) {
    if (!id || typeof id !== 'string') return null;
    const row = this.db.prepare(`SELECT * FROM players WHERE id = ?`).get(id);
    return row ? this._mapPlayer(row) : null;
  }

  updateProfile(token, { name, avatarKey }) {
    const existing = this.getPlayerByToken(token);
    if (!existing) return null;

    const cleanName = name !== undefined ? sanitizeName(name) : existing.name;
    if (!cleanName) {
      throw new Error('Tên người chơi không hợp lệ (2 - 24 ký tự).');
    }
    const cleanAvatar = avatarKey !== undefined ? sanitizeAvatar(avatarKey) : existing.avatarKey;
    const now = Date.now();

    this.db
      .prepare(`UPDATE players SET name = ?, avatar_key = ?, updated_at = ? WHERE id = ?`)
      .run(cleanName, cleanAvatar, now, existing.id);

    return this.getPlayerById(existing.id);
  }

  recordMatchResult(playerId, { roomName, gameType, result, placement = 0, totalPlayers = 0, roundsPlayed = 0 }) {
    const player = this.getPlayerById(playerId);
    if (!player) return null;

    const isWin = result === 'WIN';
    const now = Date.now();

    this.db
      .prepare(
        `UPDATE players
         SET wins = wins + ?, losses = losses + ?, matches_played = matches_played + 1, updated_at = ?
         WHERE id = ?`
      )
      .run(isWin ? 1 : 0, isWin ? 0 : 1, now, playerId);

    this.db
      .prepare(
        `INSERT INTO match_history (player_id, room_name, game_type, result, placement, total_players, rounds_played, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        playerId,
        String(roomName || 'Phòng Chơi').slice(0, 60),
        String(gameType || 'LIARS_DECK'),
        isWin ? 'WIN' : 'LOSS',
        Number(placement) || 0,
        Number(totalPlayers) || 0,
        Number(roundsPlayed) || 0,
        now
      );

    return this.getPlayerById(playerId);
  }

  getMatchHistory(playerId, limit = 20) {
    const rows = this.db
      .prepare(
        `SELECT id, room_name, game_type, result, placement, total_players, rounds_played, created_at
         FROM match_history
         WHERE player_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(playerId, Math.min(50, Math.max(1, Number(limit) || 20)));

    return rows.map((r) => ({
      id: r.id,
      roomName: r.room_name,
      gameType: r.game_type,
      result: r.result,
      placement: r.placement,
      totalPlayers: r.total_players,
      roundsPlayed: r.rounds_played,
      createdAt: r.created_at
    }));
  }

  _mapPlayer(row) {
    return {
      id: row.id,
      token: row.token,
      name: row.name,
      avatarKey: row.avatar_key,
      wins: row.wins,
      losses: row.losses,
      matchesPlayed: row.matches_played,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  close() {
    this.db.close();
  }
}

export const ALLOWED_AVATARS = ['human', 'fox', 'wolf', 'pig', 'cat', 'owl'];

export function sanitizeName(name) {
  const cleaned = String(name || '')
    .replace(/[\r\n\t<>]/g, '')
    .trim()
    .slice(0, 24);
  if (cleaned.length < 2) return '';
  return cleaned;
}

export function sanitizeAvatar(avatarKey) {
  return ALLOWED_AVATARS.includes(avatarKey) ? avatarKey : 'human';
}
