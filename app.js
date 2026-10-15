'use strict';
const $ = s => document.querySelector(s);
const audio = $('#audio');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};

const S = {
  cfg: store.get('cfg', { key: '', links: '' }),
  library: store.get('library', []),
  playlists: store.get('playlists', []),
  queue: [], idx: -1,
  shuffle: store.get('shuffle', false),
  repeat: store.get('repeat', 0), // 0 tat, 1 lap ca danh sach, 2 lap 1 bai
  tab: 'library', openPl: null, status: ''
};
const save = () => { store.set('cfg', S.cfg); store.set('library', S.library); store.set('playlists', S.playlists); };
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = t => isFinite(t) ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Google Drive ---------- */
const API = 'https://www.googleapis.com/drive/v3/files';
const srcUrl = id => `${API}/${id}?alt=media&key=${encodeURIComponent(S.cfg.key)}`;
const isAudio = f => /^audio\//.test(f.mimeType) || /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(f.name);

function parseLink(s) {
  s = s.trim();
  let m = s.match(/\/folders\/([\w-]+)/); if (m) return { type: 'folder', id: m[1] };
  m = s.match(/\/file\/d\/([\w-]+)/); if (m) return { type: 'file', id: m[1] };
  m = s.match(/[?&]id=([\w-]+)/); if (m) return { type: s.includes('folder') ? 'folder' : 'file', id: m[1] };
  if (/^[\w-]{20,}$/.test(s)) return { type: 'folder', id: s };
  return null;
}
async function gfetch(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = r.status;
    try { msg = (await r.json()).error.message; } catch { }
    throw new Error(`Drive loi ${r.status}: ${msg}`);
  }
  return r.json();
}
async function listFolder(id, out, depth = 0) {
  let token = '';
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
    const url = `${API}?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType)&key=${encodeURIComponent(S.cfg.key)}${token ? '&pageToken=' + token : ''}`;
    const d = await gfetch(url);
    for (const f of d.files) {
      if (f.mimeType === 'application/vnd.google-apps.folder') { if (depth < 3) await listFolder(f.id, out, depth + 1); }
      else if (isAudio(f)) out.push({ id: f.id, name: f.name.replace(/\.[^.]+$/, '') });
    }
    token = d.nextPageToken || '';
  } while (token);
}
async function syncLibrary() {
  if (!S.cfg.key) return setStatus('Chua nhap API key.');
  const links = S.cfg.links.split(/\s+/).map(parseLink).filter(Boolean);
  if (!links.length) return setStatus('Chua co link Google Drive hop le.');
  setStatus('Dang quet Google Drive...');
  const out = [];
  try {
    for (const l of links) {
      if (l.type === 'folder') await listFolder(l.id, out);
      else {
        const f = await gfetch(`${API}/${l.id}?fields=id,name,mimeType&key=${encodeURIComponent(S.cfg.key)}`);
        out.push({ id: f.id, name: f.name.replace(/\.[^.]+$/, '') });
      }
    }
    const seen = new Set();
    S.library = out.filter(s => !seen.has(s.id) && seen.add(s.id)).sort((a, b) => a.name.localeCompare(b.name));
    save();
    setStatus(`Da quet xong: ${S.library.length} bai.`);
  } catch (e) { setStatus(String(e.message || e)); }
}
function setStatus(t) { S.status = t; render(); }

/* ---------- Player ---------- */
function playQueue(list, i) {
  S.queue = list.slice(); S.idx = i; load(true);
}
function load(autoplay) {
  const s = S.queue[S.idx];
  if (!s) return;
  audio.src = srcUrl(s.id);
  if (autoplay) audio.play().catch(() => { });
  $('#now').textContent = s.name;
  updateMedia(s);
  store.set('last', { id: s.id, name: s.name });
  render();
}
function next(auto) {
  if (!S.queue.length) return;
  if (auto && S.repeat === 2) { audio.currentTime = 0; audio.play(); return; }
  if (S.shuffle && S.queue.length > 1) {
    let n; do { n = Math.floor(Math.random() * S.queue.length); } while (n === S.idx);
    S.idx = n;
  } else if (S.idx + 1 < S.queue.length) S.idx++;
  else if (S.repeat === 1 || !auto) S.idx = 0;
  else return;
  load(true);
}
function prev() {
  if (!S.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  S.idx = (S.idx - 1 + S.queue.length) % S.queue.length; load(true);
}
function toggle() {
  if (S.idx < 0) { if (S.library.length) playQueue(S.library, 0); return; }
  audio.paused ? audio.play().catch(() => { }) : audio.pause();
}
function updateMedia(s) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: s.name, artist: 'Google Drive', album: 'Music Player',
    artwork: [{ src: 'icon.svg', sizes: '512x512', type: 'image/svg+xml' }]
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { } };
  set('play', () => audio.play()); set('pause', () => audio.pause());
  set('previoustrack', prev); set('nexttrack', () => next(false));
  set('seekto', d => { audio.currentTime = d.seekTime; });
  set('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  set('seekforward', () => { audio.currentTime += 10; });
}
function posState() {
  if ('mediaSession' in navigator && isFinite(audio.duration)) {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch { }
  }
}
audio.addEventListener('ended', () => next(true));
audio.addEventListener('play', () => { $('#play').textContent = 'Dung'; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
audio.addEventListener('pause', () => { $('#play').textContent = 'Phat'; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });
audio.addEventListener('timeupdate', () => {
  $('#cur').textContent = fmt(audio.currentTime);
  $('#dur').textContent = fmt(audio.duration);
  if (!seeking && audio.duration) $('#seek').value = audio.currentTime / audio.duration * 1000;
});
audio.addEventListener('loadedmetadata', posState);
audio.addEventListener('error', () => { setStatus('Khong phat duoc bai nay (kiem tra file da chia se "Bat ky ai co link" va API key). Chuyen bai tiep.'); if (S.queue.length > 1) setTimeout(() => next(true), 1500); });
let seeking = false;
$('#seek').addEventListener('input', () => { seeking = true; });
$('#seek').addEventListener('change', e => { if (audio.duration) audio.currentTime = e.target.value / 1000 * audio.duration; seeking = false; posState(); });
$('#play').onclick = toggle;
$('#next').onclick = () => next(false);
$('#prev').onclick = prev;
$('#shuffle').onclick = () => { S.shuffle = !S.shuffle; store.set('shuffle', S.shuffle); syncBtns(); };
$('#repeat').onclick = () => { S.repeat = (S.repeat + 1) % 3; store.set('repeat', S.repeat); syncBtns(); };
function syncBtns() {
  $('#shuffle').classList.toggle('on', S.shuffle);
  $('#repeat').classList.toggle('on', S.repeat > 0);
  $('#repeat').textContent = ['Lap: tat', 'Lap: tat ca', 'Lap: 1 bai'][S.repeat];
}

/* ---------- Playlists ---------- */
const pl = id => S.playlists.find(p => p.id === id);
function createPlaylist() {
  const name = prompt('Ten playlist moi:');
  if (!name || !name.trim()) return null;
  const p = { id: uid(), name: name.trim(), songs: [] };
  S.playlists.push(p); save(); render(); return p;
}
function addToPlaylist(song) {
  const dlg = $('#pick');
  dlg.innerHTML = `<h3>Them vao playlist</h3>
    ${S.playlists.map(p => `<div class="row"><span class="t">${esc(p.name)}</span><button data-p="${p.id}">Them</button></div>`).join('') || '<div class="msg">Chua co playlist.</div>'}
    <div class="bar" style="margin-top:10px"><button id="np">+ Playlist moi</button><button id="cl">Dong</button></div>`;
  dlg.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p) {
      const p = pl(b.dataset.p);
      if (!p.songs.some(s => s.id === song.id)) p.songs.push({ id: song.id, name: song.name });
      save(); dlg.close(); render();
    } else if (b.id === 'np') {
      const p = createPlaylist();
      if (p) { p.songs.push({ id: song.id, name: song.name }); save(); }
      dlg.close(); render();
    } else dlg.close();
  };
  dlg.showModal();
}

/* ---------- Views ---------- */
function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  const v = $('#view'), cur = S.queue[S.idx]?.id;
  const st = S.status ? `<div class="msg">${esc(S.status)}</div>` : '';
  if (S.tab === 'library') {
    v.innerHTML = `<div class="bar"><button id="sync">Quet lai Drive</button><button id="playall">Phat tat ca</button></div>${st}
      <input type="text" id="q" placeholder="Tim bai hat..." value="${esc(S.q || '')}">
      <div id="list"></div>`;
    $('#sync').onclick = syncLibrary;
    $('#playall').onclick = () => S.library.length && playQueue(S.library, 0);
    const draw = () => {
      const q = (S.q || '').toLowerCase();
      const items = S.library.filter(s => s.name.toLowerCase().includes(q));
      $('#list').innerHTML = items.map(s => `<div class="row"><span class="t ${s.id === cur ? 'playing' : ''}" data-play="${s.id}">${esc(s.name)}</span><button data-add="${s.id}">+</button></div>`).join('')
        || '<div class="msg">Trong. Vao Cai dat de nhap link Drive roi bam "Quet lai Drive".</div>';
      $('#list').onclick = e => {
        const a = e.target.closest('[data-add]'), p = e.target.closest('[data-play]');
        if (a) addToPlaylist(S.library.find(s => s.id === a.dataset.add));
        else if (p) playQueue(items, items.findIndex(s => s.id === p.dataset.play));
      };
    };
    $('#q').oninput = e => { S.q = e.target.value; draw(); };
    draw();
  } else if (S.tab === 'playlists') {
    if (!S.openPl || !pl(S.openPl)) {
      S.openPl = null;
      v.innerHTML = `<div class="bar"><button id="newpl">+ Tao playlist</button></div>` +
        (S.playlists.map(p => `<div class="row"><span class="t" data-open="${p.id}">${esc(p.name)} (${p.songs.length})</span><button data-open="${p.id}">Mo</button></div>`).join('') || '<div class="msg">Chua co playlist.</div>');
      $('#newpl').onclick = createPlaylist;
      v.onclick = e => { const o = e.target.closest('[data-open]'); if (o) { S.openPl = o.dataset.open; render(); } };
    } else {
      const p = pl(S.openPl);
      v.innerHTML = `<div class="bar"><button id="back">&lt; Quay lai</button><button id="pa">Phat</button><button id="rn">Doi ten</button><button id="del">Xoa</button></div>
        <h3>${esc(p.name)}</h3>` +
        (p.songs.map((s, i) => `<div class="row"><span class="t ${s.id === cur ? 'playing' : ''}" data-play="${i}">${esc(s.name)}</span>
          <button data-up="${i}">^</button><button data-dn="${i}">v</button><button data-rm="${i}">x</button></div>`).join('') || '<div class="msg">Playlist trong. Them bai tu Thu vien bang nut +.</div>');
      $('#back').onclick = () => { S.openPl = null; render(); };
      $('#pa').onclick = () => p.songs.length && playQueue(p.songs, 0);
      $('#rn').onclick = () => { const n = prompt('Ten moi:', p.name); if (n && n.trim()) { p.name = n.trim(); save(); render(); } };
      $('#del').onclick = () => { if (confirm('Xoa playlist nay?')) { S.playlists = S.playlists.filter(x => x !== p); S.openPl = null; save(); render(); } };
      v.onclick = e => {
        const b = e.target.closest('[data-play],[data-up],[data-dn],[data-rm]'); if (!b) return;
        const d = b.dataset;
        if (d.play !== undefined) return playQueue(p.songs, +d.play);
        if (d.rm !== undefined) p.songs.splice(+d.rm, 1);
        if (d.up !== undefined && +d.up > 0) { const i = +d.up; [p.songs[i - 1], p.songs[i]] = [p.songs[i], p.songs[i - 1]]; }
        if (d.dn !== undefined && +d.dn < p.songs.length - 1) { const i = +d.dn; [p.songs[i + 1], p.songs[i]] = [p.songs[i], p.songs[i + 1]]; }
        save(); render();
      };
    }
  } else {
    v.innerHTML = `
      <label>Google API key (YouTube/Drive API key cua ban, bat Google Drive API)</label>
      <input type="text" id="key" value="${esc(S.cfg.key)}" placeholder="AIza...">
      <label>Link thu muc hoac file Google Drive (moi dong 1 link; phai chia se "Bat ky ai co link")</label>
      <textarea id="links" placeholder="https://drive.google.com/drive/folders/...">${esc(S.cfg.links)}</textarea>
      <div class="bar"><button id="savecfg">Luu va quet Drive</button></div>${st}
      <div class="msg">Cach lay API key: console.cloud.google.com > tao project > APIs & Services > bat "Google Drive API" > Credentials > Create API key. Nen gioi han key theo ten mien noi host app.</div>`;
    $('#savecfg').onclick = () => { S.cfg.key = $('#key').value.trim(); S.cfg.links = $('#links').value.trim(); save(); syncLibrary().then(() => { S.tab = 'library'; render(); }); };
  }
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; S.status = ''; $('#view').onclick = null; render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
syncBtns();
const last = store.get('last', null);
if (last) { S.queue = [last]; S.idx = 0; audio.src = srcUrl(last.id); $('#now').textContent = last.name; updateMedia(last); }
if (!S.cfg.key) S.tab = 'settings';
render();
