// A plugin worker for spike S5: answers "run" with the probes, and "spin" with a busy loop.
importScripts("probes.js");
self.onmessage = async (e) => {
  if (e.data === "run") self.postMessage({ probes: await self.runProbes() });
  if (e.data === "spin") {
    const t = Date.now();
    while (Date.now() - t < 1500) {
      // busy
    }
    self.postMessage({ spun: true });
  }
  if (e.data === "forever") {
    for (;;) {
      // never returns: only terminate() ends it
    }
  }
};
