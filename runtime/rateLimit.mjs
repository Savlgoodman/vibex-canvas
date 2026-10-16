/** Shared gate for every image request. Holds across tasks. */

const WINDOW_MS = 60_000;

export const RATE_LIMIT_BOUNDS = {
  concurrent: { min: 1, max: 20, default: 3 },
  perMinute: { min: 1, max: 60, default: 6 },
};

let maxConcurrent = RATE_LIMIT_BOUNDS.concurrent.default;
let maxPerMinute = RATE_LIMIT_BOUNDS.perMinute.default;
let inFlight = 0;
const startedAt = [];
const queue = [];
let timer = null;

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeRateLimit(raw) {
  return {
    maxConcurrent: clamp(Number(raw?.maxConcurrent), RATE_LIMIT_BOUNDS.concurrent.min, RATE_LIMIT_BOUNDS.concurrent.max, RATE_LIMIT_BOUNDS.concurrent.default),
    maxPerMinute: clamp(Number(raw?.maxPerMinute), RATE_LIMIT_BOUNDS.perMinute.min, RATE_LIMIT_BOUNDS.perMinute.max, RATE_LIMIT_BOUNDS.perMinute.default),
  };
}

export function configureRateLimit(raw) {
  const next = normalizeRateLimit(raw);
  maxConcurrent = next.maxConcurrent;
  maxPerMinute = next.maxPerMinute;
  pump();
  return next;
}

export function withImageSlot(work) {
  const ready = new Promise((resolve) => {
    queue.push({ grant: resolve });
    pump();
  });
  return ready.then(async () => {
    try {
      return await work();
    } finally {
      inFlight = Math.max(0, inFlight - 1);
      pump();
    }
  });
}

function prune(now) {
  while (startedAt.length && now - startedAt[0] >= WINDOW_MS) startedAt.shift();
}

function pump() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const now = Date.now();
  prune(now);
  while (queue.length > 0 && inFlight < maxConcurrent && startedAt.length < maxPerMinute) {
    const waiter = queue.shift();
    inFlight += 1;
    startedAt.push(Date.now());
    waiter.grant();
  }
  if (queue.length > 0 && inFlight < maxConcurrent && startedAt.length > 0 && startedAt.length >= maxPerMinute) {
    const delay = Math.max(20, WINDOW_MS - (now - startedAt[0]) + 5);
    timer = setTimeout(pump, delay);
  }
}
