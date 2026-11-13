// 图像和历史快照走异步存储，避免把大文件带入新标签页的同步启动路径。
const databases = new Map();

function open(name, store, index) {
  if (databases.has(name)) return databases.get(name);
  const promise = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const objects = request.result.createObjectStore(store);
      if (index) objects.createIndex(index, index);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); databases.delete(name); };
      db.onclose = () => databases.delete(name);
      resolve(db);
    };
  });
  databases.set(name, promise);
  promise.catch(() => databases.delete(name));
  return promise;
}

export async function transaction(name, store, mode, run, index) {
  const db = await open(name, store, index);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    tx.onabort = () => reject(tx.error || new Error('存储操作已中止'));
    let result;
    tx.oncomplete = () => resolve(result);
    try {
      result = run(tx.objectStore(store));
    } catch (err) {
      tx.abort();
      reject(err);
    }
  });
}
