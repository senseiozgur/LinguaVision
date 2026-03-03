export class JobQueue {
  constructor({ processFn, pollIntervalMs = 25 }) {
    this.processFn = processFn;
    this.pollIntervalMs = pollIntervalMs;
    this.q = [];
    this.running = false;
    this.busy = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
  }

  enqueue(payload) {
    this.q.push(payload);
    return this.q.length;
  }

  async loop() {
    while (this.running) {
      if (this.busy || this.q.length === 0) {
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        continue;
      }

      const next = this.q.shift();
      this.busy = true;
      try {
        await this.processFn(next);
      } catch {
        // worker errors are persisted by processFn path
      } finally {
        this.busy = false;
      }
    }
  }
}
