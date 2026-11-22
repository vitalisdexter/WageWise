(function () {
  'use strict';

  const open = new Promise((resolve, reject) => {
    const request = indexedDB.open('wagewise', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  async function get(key) {
    const db = await open;
    return new Promise((resolve, reject) => {
      const request = db.transaction('records').objectStore('records').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function change(key, update) {
    const db = await open;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      const records = transaction.objectStore('records');
      let next;
      let error;
      transaction.oncomplete = () => resolve(next);
      transaction.onabort = () => reject(error ?? transaction.error ?? Error('Could not save WageWise data.'));
      const request = records.get(key);
      request.onsuccess = () => {
        try {
          next = update(request.result, records);
          if (next === undefined) records.delete(key);
          else records.put(next, key);
        } catch (reason) {
          error = reason;
          transaction.abort();
        }
      };
    });
  }

  window.WageWiseData = {get, change};
})();
