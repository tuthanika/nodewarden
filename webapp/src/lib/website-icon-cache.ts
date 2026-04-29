type WebsiteIconStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface WebsiteIconRecord {
  status: WebsiteIconStatus;
  promise: Promise<WebsiteIconStatus> | null;
  listeners: Set<(status: WebsiteIconStatus) => void>;
}

const iconRecords = new Map<string, WebsiteIconRecord>();

function ensureRecord(host: string): WebsiteIconRecord {
  let record = iconRecords.get(host);
  if (!record) {
    record = {
      status: 'idle',
      promise: null,
      listeners: new Set(),
    };
    iconRecords.set(host, record);
  }
  return record;
}

function notifyRecord(host: string, status: WebsiteIconStatus): void {
  const record = ensureRecord(host);
  record.status = status;
  for (const listener of Array.from(record.listeners)) {
    listener(status);
  }
}

export function getWebsiteIconStatus(host: string): WebsiteIconStatus {
  if (!host) return 'idle';
  return ensureRecord(host).status;
}

export function subscribeWebsiteIconStatus(host: string, listener: (status: WebsiteIconStatus) => void): () => void {
  if (!host) return () => undefined;
  const record = ensureRecord(host);
  record.listeners.add(listener);
  return () => {
    record.listeners.delete(listener);
  };
}

export function markWebsiteIconLoaded(host: string): void {
  if (!host) return;
  const record = ensureRecord(host);
  record.promise = null;
  notifyRecord(host, 'loaded');
}

export function markWebsiteIconErrored(host: string): void {
  if (!host) return;
  const record = ensureRecord(host);
  record.promise = null;
  notifyRecord(host, 'error');
}

export function preloadWebsiteIcon(host: string, src: string): Promise<WebsiteIconStatus> {
  if (!host) return Promise.resolve('error');

  const record = ensureRecord(host);
  if (record.status === 'loaded' || record.status === 'error') {
    return Promise.resolve(record.status);
  }
  if (record.promise) {
    return record.promise;
  }

  record.status = 'loading';
  record.promise = new Promise<WebsiteIconStatus>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      markWebsiteIconLoaded(host);
      resolve('loaded');
    };
    img.onerror = () => {
      markWebsiteIconErrored(host);
      resolve('error');
    };
    img.src = src;
  });

  return record.promise;
}
