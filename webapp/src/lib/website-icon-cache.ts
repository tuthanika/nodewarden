type WebsiteIconStatus = 'idle' | 'loading' | 'loaded' | 'error';

const ICON_LOAD_TIMEOUT_MS = 5000;

interface WebsiteIconRecord {
  status: WebsiteIconStatus;
  promise: Promise<WebsiteIconStatus> | null;
  imageUrl: string | null;
  listeners: Set<(status: WebsiteIconStatus) => void>;
}

const iconRecords = new Map<string, WebsiteIconRecord>();

function ensureRecord(host: string): WebsiteIconRecord {
  let record = iconRecords.get(host);
  if (!record) {
    record = {
      status: 'idle',
      promise: null,
      imageUrl: null,
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

export function getWebsiteIconImageUrl(host: string): string {
  if (!host) return '';
  return ensureRecord(host).imageUrl || '';
}

export function subscribeWebsiteIconStatus(host: string, listener: (status: WebsiteIconStatus) => void): () => void {
  if (!host) return () => undefined;
  const record = ensureRecord(host);
  record.listeners.add(listener);
  return () => {
    record.listeners.delete(listener);
  };
}

export function markWebsiteIconLoaded(host: string, imageUrl?: string): void {
  if (!host) return;
  const record = ensureRecord(host);
  record.promise = null;
  if (imageUrl) {
    record.imageUrl = imageUrl;
  }
  notifyRecord(host, 'loaded');
}

export function markWebsiteIconErrored(host: string): void {
  if (!host) return;
  const record = ensureRecord(host);
  record.promise = null;
  record.imageUrl = null;
  notifyRecord(host, 'error');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read icon'));
    reader.readAsDataURL(blob);
  });
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

  notifyRecord(host, 'loading');
  record.promise = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), ICON_LOAD_TIMEOUT_MS);
    try {
      const resp = await fetch(src, {
        cache: 'force-cache',
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error('Icon unavailable');
      const contentType = String(resp.headers.get('Content-Type') || '').toLowerCase();
      if (!contentType.startsWith('image/')) throw new Error('Icon response is not an image');
      const blob = await resp.blob();
      if (!blob.size) throw new Error('Icon response is empty');
      const imageUrl = await blobToDataUrl(blob);
      if (!imageUrl) throw new Error('Icon response is empty');
      markWebsiteIconLoaded(host, imageUrl);
      return 'loaded';
    } catch {
      markWebsiteIconErrored(host);
      return 'error';
    } finally {
      window.clearTimeout(timeout);
    }
  })();

  return record.promise;
}
