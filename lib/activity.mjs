import crypto from 'node:crypto';

// Notifications are bounded, transient events. The permanent file history remains in state.json.
export class Activity {
  constructor(transfers, storage) {
    this.transfers = transfers;
    this.storage = storage;
    this.instance = crypto.randomUUID();
    this.cursor = 0;
    this.events = [];
    this.clients = new Set();
    this.deliveries = new Map();
    this.touched = new Map();
  }
  authorized(actor) { return actor.admin || this.storage.state.devices.some(device => device.id === actor.id); }
  visible(actor, item) { return actor.admin || item.actorId === actor.id || (item.kind === 'upload' && item.actorId === 'desktop'); }
  record(type, file, actor, extra = {}) {
    const event = {
      id: ++this.cursor, type, kind: type.startsWith('upload-') ? 'upload' : 'delivery',
      fileId: file.id, name: file.name, size: file.size,
      actorId: actor.id, actorName: actor.name, at: Date.now(), ...extra
    };
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    this.broadcast();
    return event;
  }
  touch(id) { this.touched.set(id, Date.now()); this.broadcast(); }
  active(actor) {
    const uploads = [...this.transfers.uploads.values()].map(item => ({
      id: item.id, fileId: item.id, name: item.name, size: item.size, total: item.size, bytes: item.offset,
      actorId: item.owner, kind: 'upload',
      status: this.transfers.busy.has(item.id) || Date.now() - (this.touched.get(item.id) || 0) < 15000 ? (item.offset === item.size ? 'verifying' : 'receiving') : 'pending'
    }));
    return [...uploads, ...this.deliveries.values()].filter(item => this.visible(actor, item));
  }
  snapshot(actor, after = 0) {
    return { instance: this.instance, cursor: this.cursor, serverTime: Date.now(), events: this.events.filter(event => event.id > after && this.visible(actor, event)), active: this.active(actor) };
  }
  subscribe(request, response, actor, after) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    const client = { response, actor: { id: actor.id, name: actor.name, admin: actor.admin }, after };
    this.clients.add(client);
    this.send(client);
    const heartbeat = setInterval(() => {
      if (!this.authorized(client.actor)) return response.end();
      response.write(': brisa\n\n');
    }, 15000);
    heartbeat.unref();
    response.on('close', () => { clearInterval(heartbeat); this.clients.delete(client); });
  }
  send(client) {
    if (!this.authorized(client.actor) || client.response.writableLength > 262144) return client.response.end();
    const snapshot = this.snapshot(client.actor, client.after);
    client.response.write(`id: ${this.instance}:${snapshot.cursor}\ndata: ${JSON.stringify(snapshot)}\n\n`);
    client.after = snapshot.cursor;
  }
  broadcast() { for (const client of this.clients) this.send(client); }
  beginDelivery(file, actor, total, partial) {
    const delivery = { id: crypto.randomUUID(), fileId: file.id, name: file.name, size: file.size, total, bytes: 0, kind: 'delivery', status: 'delivering', actorId: actor.id, actorName: actor.name, partial };
    this.deliveries.set(delivery.id, delivery);
    this.record('delivery-started', file, actor, { deliveryId: delivery.id, partial });
    let finished = false; let lastUpdate = 0;
    return {
      progress: amount => {
        delivery.bytes = amount;
        if (Date.now() - lastUpdate > 250) { lastUpdate = Date.now(); this.broadcast(); }
      },
      finish: complete => {
        if (finished) return;
        finished = true;
        this.deliveries.delete(delivery.id);
        this.record(complete ? 'delivery-completed' : 'delivery-interrupted', file, actor, { deliveryId: delivery.id, partial });
      }
    };
  }
  close() { for (const client of this.clients) client.response.end(); this.clients.clear(); }
}
