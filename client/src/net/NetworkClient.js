export class NetworkClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.ws = null;
    this.playerId = null;
    this.connected = false;
    this.ping = 0;
    this.pingTimer = null;
    this.queue = [];
  }

  connect() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      // Flush any actions clicked right before socket finished connecting
      while (this.queue.length > 0) {
        const msg = this.queue.shift();
        this.ws.send(JSON.stringify(msg));
      }
      this.handlers.onConnect?.();
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === 1) {
          this.send({ type: 'ping', t: performance.now(), ping: this.ping });
        }
      }, 2000);
    };

    this.ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === 'pong') {
        this.ping = Math.max(1, Math.round(performance.now() - msg.t));
        this.handlers.onPing?.(this.ping);
        return;
      }

      if (msg.type === 'welcome') {
        this.playerId = msg.id;
      }
      this.handlers.onMessage?.(msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.handlers.onDisconnect?.();
      setTimeout(() => this.connect(), 1800);
    };
  }

  send(payload) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(payload));
    } else if (['join_room', 'create_room', 'start_race', 'update_player', 'join_live_race'].includes(payload.type)) {
      this.queue.push(payload);
    }
  }
}
