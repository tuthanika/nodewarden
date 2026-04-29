import type { Cipher, Folder, Send } from '../types';
import { getVaultRevisionDate } from './auth';
import { loadCachedVaultCoreSnapshot, saveCachedVaultCoreSnapshot, type VaultCoreSnapshot } from '../vault-cache';
import { parseJson, type AuthedFetch } from './shared';

interface VaultSyncResponse {
  ciphers?: Cipher[];
  folders?: Folder[];
  sends?: Send[];
}

const pendingVaultCoreRequests = new Map<string, Promise<VaultCoreSnapshot>>();
const memoryVaultCoreCache = new Map<string, { revisionStamp: number; snapshot: VaultCoreSnapshot }>();

function normalizeSnapshot(body: VaultSyncResponse | null | undefined): VaultCoreSnapshot {
  return {
    ciphers: Array.isArray(body?.ciphers) ? body!.ciphers! : [],
    folders: Array.isArray(body?.folders) ? body!.folders! : [],
  };
}

export async function getCachedVaultCoreSnapshot(cacheKey: string): Promise<VaultCoreSnapshot | null> {
  const normalizedKey = String(cacheKey || '').trim();
  if (!normalizedKey) return null;
  const memory = memoryVaultCoreCache.get(normalizedKey);
  if (memory) return memory.snapshot;
  const cached = await loadCachedVaultCoreSnapshot(normalizedKey);
  if (!cached?.snapshot) return null;
  memoryVaultCoreCache.set(normalizedKey, {
    revisionStamp: cached.revisionStamp,
    snapshot: cached.snapshot,
  });
  return cached.snapshot;
}

export async function loadVaultCoreSyncSnapshot(authedFetch: AuthedFetch, cacheKey: string): Promise<VaultCoreSnapshot> {
  const normalizedKey = String(cacheKey || '').trim();
  if (!normalizedKey) return { ciphers: [], folders: [] };

  const existing = pendingVaultCoreRequests.get(normalizedKey);
  if (existing) return existing;

  const request = (async () => {
    const revisionStamp = await getVaultRevisionDate(authedFetch);
    const memory = memoryVaultCoreCache.get(normalizedKey);
    if (memory?.revisionStamp === revisionStamp) {
      return memory.snapshot;
    }

    const cached = await loadCachedVaultCoreSnapshot(normalizedKey);
    if (cached?.revisionStamp === revisionStamp && cached.snapshot) {
      memoryVaultCoreCache.set(normalizedKey, {
        revisionStamp,
        snapshot: cached.snapshot,
      });
      return cached.snapshot;
    }

    const resp = await authedFetch('/api/sync?excludeSends=true&excludeDomains=true', {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    if (!resp.ok) throw new Error('Failed to load vault');
    const body = await parseJson<VaultSyncResponse>(resp);
    const snapshot = normalizeSnapshot(body);
    memoryVaultCoreCache.set(normalizedKey, { revisionStamp, snapshot });
    void saveCachedVaultCoreSnapshot(normalizedKey, revisionStamp, snapshot);
    return snapshot;
  })();

  pendingVaultCoreRequests.set(normalizedKey, request);
  try {
    return await request;
  } finally {
    if (pendingVaultCoreRequests.get(normalizedKey) === request) {
      pendingVaultCoreRequests.delete(normalizedKey);
    }
  }
}
