/*
 * Offline-first API helper for the Mario Store frontend.
 * Keep this file loaded before app.js when integrating API-backed features.
 * It queues sales in IndexedDB and retries with the same clientSaleId so the
 * server's idempotency constraint prevents duplicate checkout on reconnect.
 */
(() => {
  const DB_NAME = 'mario-store-offline-v1';
  const STORE = 'pending-sales';
  const TOKEN_KEY = 'mario_store_api_token';
  const API_BASE = window.MARIO_STORE_API_BASE || '';
  function openDB() {
    return new Promise((resolve,reject) => {
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'clientSaleId'});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  async function tx(mode, callback) {
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const t=db.transaction(STORE,mode), store=t.objectStore(STORE);
      let result;
      try { result=callback(store); } catch(e) { reject(e); db.close(); return; }
      t.oncomplete=()=>{db.close();resolve(result);};
      t.onerror=()=>{db.close();reject(t.error);};
      t.onabort=()=>{db.close();reject(t.error);};
    });
  }
  function requestValue(req) {
    return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  }
  async function api(path, options={}) {
    const token=localStorage.getItem(TOKEN_KEY);
    const response=await fetch(`${API_BASE}/api${path}`,{
      ...options, headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(options.headers||{})}
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }
  async function queueSale({items,note='',clientSaleId=crypto.randomUUID()}) {
    const record={clientSaleId,items:items.map(i=>({productId:i.productId,quantity:Number(i.quantity)})),note:String(note),createdAt:new Date().toISOString(),status:'pending'};
    await tx('readwrite',s=>s.put(record));
    // A pending sale is safely stored on this device even when offline.
    syncPendingSales().catch(()=>{});
    return {clientSaleId,queued:true};
  }
  async function syncPendingSales() {
    if(!navigator.onLine) return {synced:0,offline:true};
    const db=await openDB();
    const pending=await new Promise((resolve,reject)=>{
      const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    db.close();
    let synced=0;
    for(const sale of pending) {
      try {
        await api('/sales',{method:'POST',body:JSON.stringify(sale)});
        await tx('readwrite',s=>s.delete(sale.clientSaleId));
        synced++;
      } catch(error) {
        // Keep queued records for network errors and temporary server failures.
        // A 4xx (e.g. stock conflict) needs user review; keep it in the queue.
        console.warn('Sale sync deferred:',sale.clientSaleId,error.message);
        break;
      }
    }
    window.dispatchEvent(new CustomEvent('mario-store-sync',{detail:{synced,pending:pending.length-synced}}));
    return {synced,pending:pending.length-synced};
  }
  async function pendingSales() {
    const db=await openDB();
    const rows=await new Promise((resolve,reject)=>{
      const r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    db.close(); return rows;
  }
  window.MarioStoreAPI = { api, queueSale, syncPendingSales, pendingSales, setToken(token){if(token)localStorage.setItem(TOKEN_KEY,token);else localStorage.removeItem(TOKEN_KEY);}, getToken(){return localStorage.getItem(TOKEN_KEY);} };
  window.addEventListener('online',()=>syncPendingSales().catch(console.error));
})();
