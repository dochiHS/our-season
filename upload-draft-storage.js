(function (global) {
  'use strict';

  const DB_NAME = 'season-photo-upload-draft';
  const STORE_NAME = 'drafts';
  const PHOTO_KEY = 'original-photo';
  const SESSION_KEY = 'season-photo-upload-draft-text';
  const MAX_AGE_MS = 30 * 60 * 1000;
  let databasePromise = null;
  let writeVersion = 0;

  function openDatabase() {
    if (!global.indexedDB) return Promise.reject(new Error('IndexedDB를 사용할 수 없습니다.'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      let request;
      try { request = global.indexedDB.open(DB_NAME, 1); }
      catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB를 열 수 없습니다.'));
      request.onblocked = () => reject(new Error('IndexedDB가 다른 연결에 의해 차단됐습니다.'));
    }).catch(error => { databasePromise = null; throw error; });
    return databasePromise;
  }

  function saveText(value) {
    try { global.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }

  function readText() {
    try {
      const raw = global.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      const savedAt = Number(value && value.savedAt);
      if (!Number.isFinite(savedAt) || Date.now() - savedAt >= MAX_AGE_MS || Date.now() < savedAt) {
        clear();
        return null;
      }
      return value;
    } catch (error) { return null; }
  }

  function savePhoto(file) {
    const version = ++writeVersion;
    return openDatabase().then(database => new Promise((resolve, reject) => {
      if (version !== writeVersion) { resolve(false); return; }
      let transaction;
      try { transaction = database.transaction(STORE_NAME, 'readwrite'); }
      catch (error) { reject(error); return; }
      transaction.objectStore(STORE_NAME).put({ blob: file, name: file.name || 'photo', type: file.type || 'application/octet-stream', lastModified: file.lastModified || Date.now() }, PHOTO_KEY);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error || new Error('원본 사진을 저장하지 못했습니다.'));
      transaction.onabort = () => reject(transaction.error || new Error('원본 사진 저장이 중단됐습니다.'));
    }));
  }

  function loadPhoto() {
    return openDatabase().then(database => new Promise((resolve, reject) => {
      let transaction;
      try { transaction = database.transaction(STORE_NAME, 'readonly'); }
      catch (error) { reject(error); return; }
      const request = transaction.objectStore(STORE_NAME).get(PHOTO_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('저장된 사진을 읽지 못했습니다.'));
    }));
  }

  function clearPhoto() {
    writeVersion += 1;
    return openDatabase().then(database => new Promise(resolve => {
      let transaction;
      try { transaction = database.transaction(STORE_NAME, 'readwrite'); }
      catch (error) { resolve(false); return; }
      transaction.objectStore(STORE_NAME).delete(PHOTO_KEY);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    })).catch(() => false);
  }

  function clear() {
    writeVersion += 1;
    try { global.sessionStorage.removeItem(SESSION_KEY); } catch (error) { /* 저장소를 사용할 수 없는 브라우저 */ }
    return openDatabase().then(database => new Promise(resolve => {
      let transaction;
      try { transaction = database.transaction(STORE_NAME, 'readwrite'); }
      catch (error) { resolve(false); return; }
      transaction.objectStore(STORE_NAME).delete(PHOTO_KEY);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    })).catch(() => false);
  }

  global.DraftStorage = Object.freeze({ saveText, readText, savePhoto, loadPhoto, clearPhoto, clear, maxAgeMs: MAX_AGE_MS });
})(globalThis);
