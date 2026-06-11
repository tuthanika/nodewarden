export type NetworkStatus = 'online' | 'offline';

const STATUS_PROBE_TIMEOUT_MS = 3500;
const STATUS_PROBE_CACHE_MS = 5000;
const listeners = new Set<(status: NetworkStatus) => void>();
let currentStatus: NetworkStatus = getInitialNetworkStatus();
let pendingProbe: Promise<boolean> | null = null;
let lastProbeAt = 0;
let lastProbeResult = currentStatus === 'online';

export function browserReportsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function getInitialNetworkStatus(): NetworkStatus {
  return browserReportsOffline() ? 'offline' : 'online';
}

export function getCurrentNetworkStatus(): NetworkStatus {
  return currentStatus;
}

export function setCurrentNetworkStatus(status: NetworkStatus): void {
  if (currentStatus === status) return;
  currentStatus = status;
  for (const listener of Array.from(listeners)) {
    listener(status);
  }
}

export function subscribeNetworkStatus(listener: (status: NetworkStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function probeNodeWardenService(): Promise<boolean> {
  if (browserReportsOffline()) {
    setCurrentNetworkStatus('offline');
    return false;
  }

  const now = Date.now();
  if (pendingProbe) return pendingProbe;
  if (now - lastProbeAt < STATUS_PROBE_CACHE_MS) return lastProbeResult;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? window.setTimeout(() => controller.abort(), STATUS_PROBE_TIMEOUT_MS)
    : 0;

  pendingProbe = (async () => {
    await fetch(`/api/web-bootstrap?statusProbe=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller?.signal,
    });
    // Any same-origin HTTP response proves the server is reachable. A 4xx/5xx
    // response may be an application problem, but it is not offline mode.
    return true;
  })()
    .catch(() => false)
    .then((result) => {
      lastProbeAt = Date.now();
      lastProbeResult = result;
      setCurrentNetworkStatus(result ? 'online' : 'offline');
      return result;
    })
    .finally(() => {
      if (timer) window.clearTimeout(timer);
      pendingProbe = null;
    });

  return pendingProbe;
}
