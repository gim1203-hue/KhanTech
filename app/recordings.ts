export type SavedRecording = {
  id: string;
  blob: Blob;
  createdAt: number;
  durationMs: number;
  mimeType: string;
};

const DB_NAME = 'khantech-local-vault';
const STORE_NAME = 'recordings';
const DAY_MS = 24 * 60 * 60 * 1000;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listRecordings(): Promise<SavedRecording[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const items = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as SavedRecording[];
  database.close();
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveRecording(blob: Blob, durationMs: number): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put({
    id: crypto.randomUUID(),
    blob,
    createdAt: Date.now(),
    durationMs,
    mimeType: blob.type || 'video/webm',
  } satisfies SavedRecording);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  await pruneRecordings();
}

export async function pruneRecordings(): Promise<void> {
  const items = await listRecordings();
  const cutoff = Date.now() - DAY_MS;
  const expired = items.filter((item) => item.createdAt < cutoff);
  if (!expired.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  expired.forEach((item) => transaction.objectStore(STORE_NAME).delete(item.id));
  await new Promise<void>((resolve) => { transaction.oncomplete = () => resolve(); });
  database.close();
}

export async function deleteRecording(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(id);
  await new Promise<void>((resolve) => { transaction.oncomplete = () => resolve(); });
  database.close();
}
