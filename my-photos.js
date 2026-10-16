(function (global) {
  'use strict';

  const SEASON_FALLBACK = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
  let screen = null;
  let list = null;
  let messageNode = null;
  let emptyNode = null;
  let currentUser = null;
  let rows = [];
  let active = false;
  let resolvingAuth = false;
  let openingPromise = null;
  let openVersion = 0;

  function createScreen() {
    if (screen) return screen;
    const home = document.getElementById('home-screen');
    const parent = home && home.parentNode || document.getElementById('app') || document.body;
    screen = document.createElement('section');
    screen.id = 'my-photos-screen';
    screen.className = 'screen my-photos-screen';
    screen.hidden = true;
    screen.setAttribute('aria-label', '내가 올린 사진');

    const header = document.createElement('header');
    header.className = 'screen-topbar my-photos-topbar';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'back-button my-photos-back';
    back.setAttribute('aria-label', '첫 화면으로 돌아가기');
    back.textContent = '‹';
    back.addEventListener('click', () => { global.location.hash = '#/'; });
    const title = document.createElement('h1');
    title.className = 'my-photos-title';
    title.textContent = '내가 올린 사진';
    const spacer = document.createElement('span');
    spacer.className = 'my-photos-topbar-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    header.append(back, title, spacer);

    const content = document.createElement('main');
    content.className = 'my-photos-content';
    messageNode = document.createElement('p');
    messageNode.className = 'my-photos-message';
    messageNode.setAttribute('role', 'status');
    messageNode.setAttribute('aria-live', 'polite');
    messageNode.hidden = true;
    list = document.createElement('div');
    list.className = 'my-photos-list';
    list.setAttribute('aria-live', 'polite');
    emptyNode = document.createElement('p');
    emptyNode.className = 'my-photos-empty';
    emptyNode.textContent = '아직 올린 사진이 없어요.';
    const note = document.createElement('p');
    note.className = 'my-photos-note';
    note.textContent = '로그인 전에 올린 사진은 여기 보이지 않아요. 지우고 싶으면 운영자에게 말해 주세요.';
    content.append(messageNode, list, note);
    screen.append(header, content);
    parent.appendChild(screen);
    return screen;
  }

  function setMessage(text, type) {
    if (!messageNode) return;
    messageNode.textContent = text || '';
    messageNode.hidden = !text;
    messageNode.classList.toggle('is-error', type === 'error');
    messageNode.classList.toggle('is-success', type === 'success');
  }

  function seasonName(code) {
    const labels = global.SpotData && global.SpotData.SEASONS_KO;
    return labels && labels[code] || SEASON_FALLBACK[code] || code || '계절 미상';
  }

  function dateText(value) {
    if (!value) return '날짜 미상';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}.${values.month}.${values.day}`;
  }

  function placeName(row) {
    if (row.kind === 'free') {
      const area = global.FreePlaces && typeof global.FreePlaces.placeLabel === 'function'
        ? global.FreePlaces.placeLabel(row.city, row.district)
        : [row.city, row.district].filter(Boolean).join(' ');
      return [row.place_name, area].filter(Boolean).join(' · ') || '이름 없는 장소';
    }
    const spot = global.SpotData && typeof global.SpotData.getSpotById === 'function'
      ? global.SpotData.getSpotById(row.spot_id)
      : null;
    return spot && spot.name || row.spot_id || '명소';
  }

  function makeText(className, text) {
    const node = document.createElement('p');
    node.className = className;
    node.textContent = text;
    return node;
  }

  function renderRows() {
    if (!list) return;
    list.replaceChildren();
    if (!rows.length) {
      list.appendChild(emptyNode);
      return;
    }
    const client = global.OurAuth && global.OurAuth.getClient();
    rows.forEach(row => {
      const card = document.createElement('article');
      card.className = 'my-photo-card';
      if (client && row.photo_path) {
        const result = client.storage.from('season-photos').getPublicUrl(row.photo_path);
        const image = document.createElement('img');
        image.className = 'my-photo-thumbnail';
        image.src = result && result.data && result.data.publicUrl || '';
        image.alt = '내가 올린 사진';
        image.loading = 'lazy';
        card.appendChild(image);
      }
      const body = document.createElement('div');
      body.className = 'my-photo-body';
      const place = makeText('my-photo-place', placeName(row));
      const season = makeText('my-photo-meta', seasonName(row.season));
      const date = makeText('my-photo-meta', `찍은 날짜: ${dateText(row.taken_at || row.created_at)}`);
      body.append(place, season, date);
      if (row.status === 'approved' || row.status === 'pending') {
        const badge = document.createElement('span');
        badge.className = `my-photo-status is-${row.status}`;
        badge.textContent = row.status === 'approved' ? '공개 중' : '승인 대기';
        body.appendChild(badge);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'my-photo-delete';
      remove.textContent = '삭제';
      remove.addEventListener('click', async () => {
        if (remove.disabled) return;
        await confirmDelete(row, remove);
      });
      body.appendChild(remove);
      card.appendChild(body);
      list.appendChild(card);
    });
  }

  async function loadPhotos(user, version) {
    setMessage('사진을 불러오고 있어요.', '');
    list.replaceChildren();
    const client = global.OurAuth && global.OurAuth.getClient();
    if (!client) throw new Error('Supabase 클라이언트를 사용할 수 없습니다.');
    const result = await client.from('season_photos')
      .select('id, kind, spot_id, point_id, season, place_name, city, district, status, photo_path, taken_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    if (!active || version !== openVersion) return;
    rows = result.data || [];
    setMessage('', '');
    renderRows();
  }

  function closeConfirm(overlay, value, resolve) {
    overlay.classList.remove('open');
    overlay.remove();
    resolve(value);
  }

  function performDelete(row) {
    const client = global.OurAuth && global.OurAuth.getClient();
    if (!client || !currentUser) return Promise.reject(new Error('삭제할 수 없습니다.'));
    return client.from('season_photos').delete()
      .eq('id', row.id)
      .eq('user_id', currentUser.id)
      .select('id')
      .then(async result => {
        if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
          throw new Error('delete failed');
        }
        if (row.photo_path) {
          try { await client.storage.from('season-photos').remove([row.photo_path]); }
          catch (error) { /* 행 삭제가 완료됐으므로 파일 삭제 실패는 무시합니다. */ }
        }
      });
  }

  async function refreshPhotoLists() {
    if (global.FreeRecords && typeof global.FreeRecords.refresh === 'function') {
      try { await global.FreeRecords.refresh(); } catch (error) { /* 목록 갱신 실패는 삭제 결과를 되돌리지 않습니다. */ }
    }
    const app = global.App;
    if (!app) return;
    const reload = app.loadApprovedPhotos || app.refreshPhotos || app.reloadPhotos;
    if (typeof reload === 'function') {
      try { await reload.call(app); } catch (error) { /* 사진 목록 갱신 실패는 삭제 결과를 되돌리지 않습니다. */ }
    }
  }

  function confirmDelete(row, deleteButton) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay my-photos-confirm-modal';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', '사진 삭제 확인');
      const sheet = document.createElement('div');
      sheet.className = 'modal-sheet my-photos-confirm-sheet';
      const header = document.createElement('div');
      header.className = 'sheet-header';
      const title = document.createElement('h2');
      title.className = 'sheet-title';
      title.textContent = '사진 삭제';
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'btn-close-modal';
      closeButton.setAttribute('aria-label', '닫기');
      closeButton.textContent = '×';
      header.append(title, closeButton);
      const copy = document.createElement('p');
      copy.className = 'my-photos-confirm-copy';
      copy.textContent = '이 사진을 지울까요? 지우면 되돌릴 수 없어요.';
      const status = document.createElement('p');
      status.className = 'my-photos-confirm-status';
      status.setAttribute('role', 'status');
      const actions = document.createElement('div');
      actions.className = 'my-photos-confirm-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '취소';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'my-photos-confirm-delete';
      confirm.textContent = '지우기';
      actions.append(cancel, confirm);
      sheet.append(header, copy, status, actions);
      overlay.appendChild(sheet);
      document.body.appendChild(overlay);
      let busy = false;
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        closeConfirm(overlay, value, resolve);
      };
      closeButton.addEventListener('click', () => { if (!busy) finish(false); });
      cancel.addEventListener('click', () => { if (!busy) finish(false); });
      overlay.addEventListener('click', event => {
        if (event.target === overlay && !busy) finish(false);
      });
      confirm.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        confirm.disabled = true;
        cancel.disabled = true;
        closeButton.disabled = true;
        deleteButton.disabled = true;
        try {
          await performDelete(row);
          rows = rows.filter(item => String(item.id) !== String(row.id));
          renderRows();
          setMessage('사진을 지웠어요.', 'success');
          finish(true);
          await refreshPhotoLists();
        } catch (error) {
          setMessage('사진을 지우지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
          finish(false);
        } finally {
          if (deleteButton.isConnected) deleteButton.disabled = false;
        }
      });
      overlay.classList.add('open');
    });
  }

  async function runOpen(version) {
    resolvingAuth = true;
    try {
      let user = await global.OurAuth.getUser();
      if (!user) user = await global.OurAuth.requireLogin();
      if (!active || version !== openVersion) return;
      if (!user) {
        global.location.hash = '#/';
        return;
      }
      currentUser = user;
      await loadPhotos(user, version);
    } catch (error) {
      if (active && version === openVersion) {
        setMessage('사진을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.', 'error');
        list.replaceChildren();
      }
    } finally {
      resolvingAuth = false;
    }
  }

  function open() {
    createScreen();
    screen.hidden = false;
    if (active && openingPromise) return openingPromise;
    if (active && !openingPromise) return Promise.resolve();
    active = true;
    const version = ++openVersion;
    openingPromise = runOpen(version).finally(() => {
      if (version === openVersion) openingPromise = null;
    });
    return openingPromise;
  }

  function close() {
    active = false;
    openVersion += 1;
    openingPromise = null;
    if (screen) screen.hidden = true;
  }

  global.addEventListener('authchange', event => {
    const user = event.detail && event.detail.user || null;
    if (user) {
      currentUser = user;
      return;
    }
    if (active && !resolvingAuth && screen && !screen.hidden) global.location.hash = '#/';
  });

  global.MyPhotos = Object.freeze({ open, close });
})(globalThis);
