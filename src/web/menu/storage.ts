import type { StorageBackend } from '../../core/player';

/** IndexedDB: one object store of string values. */
class IdbBackend implements StorageBackend {
  constructor(private readonly db: IDBDatabase) {}
  private run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
    });
  }
  async get(key: string): Promise<string | undefined> { return (await this.run('readonly', (s) => s.get(key))) as string | undefined; }
  async set(key: string, value: string): Promise<void> { await this.run('readwrite', (s) => s.put(value, key)); }
  async delete(key: string): Promise<void> { await this.run('readwrite', (s) => s.delete(key)); }
  async keys(): Promise<string[]> { return (await this.run('readonly', (s) => s.getAllKeys())).map(String); }
}

/** localStorage fallback (private windows, blocked IndexedDB). Smaller, so old ride files may not fit. */
class LocalBackend implements StorageBackend {
  private readonly prefix = 'overreach.player.';
  async get(key: string): Promise<string | undefined> { return localStorage.getItem(this.prefix + key) ?? undefined; }
  async set(key: string, value: string): Promise<void> { localStorage.setItem(this.prefix + key, value); }
  async delete(key: string): Promise<void> { localStorage.removeItem(this.prefix + key); }
  async keys(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
    }
    return out;
  }
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('overreach', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is unavailable'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked'));
  });
}

/**
 * The browser's storage for the player. If nothing has been saved yet but the
 * Stage 5 start-screen settings exist, they are carried in as a version 1
 * document so the migration picks them up.
 */
export async function browserBackend(): Promise<{ backend: StorageBackend; kind: 'indexeddb' | 'localstorage' }> {
  let backend: StorageBackend;
  let kind: 'indexeddb' | 'localstorage' = 'indexeddb';
  try {
    backend = new IdbBackend(await openIdb());
    await backend.get('player');
  } catch {
    backend = new LocalBackend();
    kind = 'localstorage';
  }
  try {
    if ((await backend.get('player')) === undefined) {
      const old = localStorage.getItem('overreach.settings');
      if (old && 'ftp' in (JSON.parse(old) as object)) await backend.set('player', old);
    }
  } catch { /* nothing to carry over */ }
  return { backend, kind };
}
