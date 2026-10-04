const HOLD_MS = 1000;

function createHold(mode) {
  let started = false,
    cancelled = false,
    done = false;
  return {
    get done() {
      return done;
    },
    cancel() {
      cancelled = true;
    },
    advance(held, elapsed) {
      if (done) return [];
      if (!held) {
        done = true;
        const events = [{ event: 'hold', data: { progress: 0 } }];
        if (started && !cancelled && mode === 'push')
          events.push({ event: 'voice', data: { action: 'stop' } });
        return events;
      }
      if (cancelled || started) return [];
      const events = [{ event: 'hold', data: { progress: Math.min(1, elapsed / HOLD_MS) } }];
      if (elapsed >= HOLD_MS) {
        started = true;
        events.push({ event: 'voice', data: { action: 'start' } });
      }
      return events;
    },
  };
}

module.exports = { createHold, HOLD_MS };
