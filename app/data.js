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

  async function adoptOriginals(workspace, history=[]) {
    for(const entry of history??[]){
      const hash=entry.imported?.hash;
      if(!hash || !/^[a-f0-9]{64}$/.test(hash))continue;
      const key=workspace+':payslip-file:'+hash;
      if(await get(key))continue;
      const old=await get('payslip-file:'+hash);
      if(old)await change(key,existing=>existing??old);
    }
    await change(workspace,current=>({...current,originalsMigrated:true}));
  }
  async function moveGuest(key,guest,reviewed,next){
    const db=await open;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('records','readwrite'),records=tx.objectStore('records');
      tx.oncomplete=resolve;tx.onabort=()=>reject(Error('Records changed. Reload and review the import again.'));
      const old=records.get('guest'),active=records.get('active-account');
      const legacyReminder=records.get('device-reminder'),reminder=records.get(key+':reminder'),current=records.get(key);
      current.onsuccess=()=>{
        if(old.result?.movedTo||JSON.stringify(old.result?.data)!==JSON.stringify(guest.data)||
           JSON.stringify(current.result?.data)!==JSON.stringify(reviewed.data)){tx.abort();return;}
        if(!active.result && legacyReminder.result && !reminder.result?.configured){
          records.put({...legacyReminder.result,configured:true},key+':reminder');
        }
        for(const entry of next.calculator?.history??[]){
          const hash=entry.imported?.hash;
          if(!hash || !/^[a-f0-9]{64}$/.test(hash))continue;
          const scoped=key+':payslip-file:'+hash;
          const existing=records.get(scoped),original=records.get('payslip-file:'+hash);
          original.onsuccess=()=>{if(!existing.result&&original.result)records.put(original.result,scoped);};
        }
        records.put({...current.result,data:next},key);records.put({movedTo:key},'guest');
      };
    });
  }
  window.WageWiseData = {get, change, adoptOriginals,moveGuest};
})();
