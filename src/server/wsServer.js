/**
 * Zero-Dependency RFC 6455 WebSocket Server for Node.js
 * Handles HTTP Upgrade handshake, masked frame decoding, JSON messaging,
 * Ping/Pong keepalive, and per-socket rate limiting.
 */

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WebSocketConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.id = crypto.randomUUID();
    this.isAlive = true;
    this.closed = false;
    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentsBytes = 0;

    // Rate limit tracking (window = 1000ms)
    this._rateWindowStart = Date.now();
    this._rateCount = 0;
    this.maxMessagesPerSec = 30;

    this.socket.on('data', (chunk) => this._onData(chunk));
    this.socket.on('close', () => this._handleClose());
    this.socket.on('error', () => this._handleClose());
  }

  _handleClose() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _onData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);

    while (this._buffer.length >= 2) {
      const firstByte = this._buffer[0];
      const secondByte = this._buffer[1];
      const fin = (firstByte & 0x80) !== 0;
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this._buffer.length < 4) return;
        payloadLength = this._buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this._buffer.length < 10) return;
        const high = this._buffer.readUInt32BE(2);
        const low = this._buffer.readUInt32BE(6);
        payloadLength = high * 0x100000000 + low;
        offset = 10;
      }

      if (payloadLength > 65536) {
        this.close(1009, 'Payload too large');
        return;
      }

      const maskLength = isMasked ? 4 : 0;
      if (!isMasked) {
        this.close(1002, 'Client frames must be masked');
        return;
      }
      if (this._buffer.length < offset + maskLength + payloadLength) {
        return;
      }

      let payload = this._buffer.subarray(offset + maskLength, offset + maskLength + payloadLength);
      if (isMasked) {
        const mask = this._buffer.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(payloadLength);
        for (let i = 0; i < payloadLength; i += 1) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      this._buffer = this._buffer.subarray(offset + maskLength + payloadLength);

      if (opcode === 0x8) {
        // Close
        this.close(1000, 'Client closed');
        return;
      }
      if (opcode === 0x9) {
        // Ping -> Pong
        this._sendFrame(0x0a, payload);
        continue;
      }
      if (opcode === 0x0a) {
        // Pong
        this.isAlive = true;
        continue;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        this._fragmentsBytes += payload.length;
        if (this._fragmentsBytes > 65536) {
          this._fragments = [];
          this._fragmentsBytes = 0;
          this.close(1009, 'Fragmented message too large');
          return;
        }
        this._fragments.push(payload);
        if (!fin) continue;
        const fullPayload = Buffer.concat(this._fragments);
        this._fragments = [];
        this._fragmentsBytes = 0;

        const now = Date.now();
        if (now - this._rateWindowStart > 1000) {
          this._rateWindowStart = now;
          this._rateCount = 0;
        }
        this._rateCount += 1;
        if (this._rateCount > this.maxMessagesPerSec) {
          this.send({ type: 'ERROR', error: 'Bạn gửi thao tác quá nhanh. Vui lòng chậm lại!' });
          continue;
        }

        const text = fullPayload.toString('utf8');
        try {
          const parsed = JSON.parse(text);
          this.emit('message', parsed);
        } catch {
          this.send({ type: 'ERROR', error: 'Dữ liệu WebSocket không hợp lệ.' });
        }
      }
    }
  }

  _sendFrame(opcode, payloadBuf) {
    if (this.closed || this.socket.destroyed) return;
    const length = payloadBuf.length;
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(length, 6);
    }
    try {
      this.socket.write(Buffer.concat([header, payloadBuf]));
    } catch {
      this._handleClose();
    }
  }

  send(obj) {
    if (this.closed) return;
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    this._sendFrame(0x1, buf);
  }

  ping() {
    this._sendFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    try {
      const reasonBuf = Buffer.from(reason, 'utf8');
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      this._sendFrame(0x8, payload);
    } catch {
      // ignore
    }
    this.closed = true;
    try {
      this.socket.end();
    } catch {
      // ignore
    }
    this.emit('close');
  }
}

export function attachWebSocketServer(httpServer, onConnection) {
  const clients = new Set();

  httpServer.on('upgrade', (req, socket, head) => {
    const upgradeHeader = (req.headers.upgrade || '').toLowerCase();
    const key = req.headers['sec-websocket-key'];
    if (upgradeHeader !== 'websocket' || !key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(`${key}${WS_MAGIC}`)
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ].join('\r\n');

    socket.write(headers);
    const conn = new WebSocketConnection(socket, req);
    clients.add(conn);
    conn.on('close', () => clients.delete(conn));
    onConnection(conn);
    if (head && head.length > 0) {
      conn._onData(head);
    }
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.close(1001, 'Ping timeout');
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 25000);
  heartbeat.unref();

  return {
    clients,
    closeAll() {
      clearInterval(heartbeat);
      for (const client of clients) {
        client.close(1001, 'Server shutting down');
      }
    }
  };
}
