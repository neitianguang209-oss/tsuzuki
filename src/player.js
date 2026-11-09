// 動画プレーヤー: YouTube 公式の埋め込み(iframe API)を1つだけ作り、画面を移っても使い回す(小さい再生窓になる)。
// 広告や動画そのものには手を加えない。こちらが行うのは、操作ボタン・続きからの再開・字幕を出さない設定だけ。
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { html, fmtTime, watchUrl, clsx, leaveWatch } from './util.js';
import { getState as appState, subscribe as subscribeApp, setProgress, flushProgress, videoInfo, videoDetail, toast, setPref, whenLoaded } from './store.js';

// ------------------------------------------------------------------ プレーヤーの状態(アプリの状態とは別。0.5秒ごとに変わるため)
let ps = {
  id: '',
  mode: 'none', // 'full' | 'mini' | 'short' | 'none'
  st: -1, // YouTube の状態 -1 未開始 0 終了 1 再生 2 一時停止 3 読み込み 5 頭出し済み
  time: 0,
  dur: 0,
  started: false, // このページで一度でも再生が始まったか(iPhone は最初の1回だけ動画を直接タップする必要がある)
  pass: true, // true のとき、タップを YouTube の画面にそのまま渡す
  manualPass: false, // 本人が「YouTube の操作」に切りかえたか
  fs: false,
  error: '',
  upNext: null, // { id, ms }(終わったあと、次の動画へ進むまでの待ち)
  queue: [],
  rate: 1,
  ready: false,
  live: false,
  buffering: false,
};
const pl = new Set();
const pEmit = () => pl.forEach((l) => l());
function setPs(patch) {
  ps = { ...ps, ...patch };
  pEmit();
}
export const getPs = () => ps;
export function usePlayer(sel) {
  const r = useRef(sel);
  r.current = sel;
  return useSyncExternalStore((l) => (pl.add(l), () => pl.delete(l)), () => r.current(ps));
}

// ------------------------------------------------------------------ iframe API の読み込み
let apiPromise = null;
function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev && prev();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('YouTube のプレーヤーを読み込めませんでした'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

let player = null; // YT.Player
let hostEl = null; // iframe を入れる箱(React の外で作る)
let want = null; // プレーヤーの準備ができる前に頼まれた、いちばん新しい { id, start }(閉じたら null)
let creating = null; // プレーヤーを作っている途中の Promise
let createdId = ''; // プレーヤーを作ったときの動画
let lastSaved = 0;
let captionsOffFor = '';

export function attachHost(el) {
  hostEl = el;
}

function noCaptions() {
  // 字幕を出さない: 字幕の仕組みそのものを外す(動画やアカウントの設定で自動表示になっていても消える)
  if (!player) return;
  for (const m of ['captions', 'cc']) {
    try { player.unloadModule(m); } catch (_) { /* 無いときは何もしない */ }
  }
  try { player.setOption('captions', 'track', {}); } catch (_) { /* 同上 */ }
}

// どこから始めるか: 途中まで見ていたらそこから(2秒だけ手前)
export function resumePoint(id) {
  const p = appState().progress[id];
  if (!p || p.done) return 0;
  const pos = Number(p.pos) || 0;
  const dur = Number(p.dur) || 0;
  if (pos < 8) return 0;
  if (dur && pos > dur - 15) return 0;
  return Math.max(0, pos - 2);
}

function create() {
  if (creating || player) return creating;
  creating = (async () => {
    let YT;
    try {
      YT = await loadApi();
    } catch (e) {
      setPs({ error: e.message });
      return;
    } finally {
      creating = null;
    }
    // 待っている間に別の動画が選ばれた・閉じられたときは、いちばん新しい指示に従う
    const w = want;
    if (player || !w || !ps.id || !hostEl) return;
    want = null;
    createdId = w.id;
    const div = document.createElement('div');
    hostEl.innerHTML = '';
    hostEl.appendChild(div);
    player = new YT.Player(div, {
      host: 'https://www.youtube-nocookie.com',
      videoId: w.id,
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        playsinline: 1,
        controls: 0,
        rel: 0,
        fs: 0,
        disablekb: 1,
        iv_load_policy: 3,
        cc_load_policy: 0,
        cc_lang_pref: 'ja',
        hl: 'ja',
        start: Math.floor(w.start || 0),
        origin: location.origin,
        enablejsapi: 1,
      },
      events: {
        onReady: () => {
          setPs({ ready: true });
          noCaptions();
          try { player.setPlaybackRate(appState().prefs.rate || 1); } catch (_) { /* 速さを変えられない動画 */ }
          const w2 = want;
          want = null;
          if (!ps.id) {
            try { player.stopVideo(); } catch (_) { /* 閉じたあと */ }
            return;
          }
          if (w2 && w2.id !== createdId) player.loadVideoById({ videoId: w2.id, startSeconds: w2.start });
          else {
            try { player.playVideo(); } catch (_) { /* iPhone は最初はタップが要る */ }
          }
        },
        onStateChange: (e) => onState(e.data),
        onError: (e) => onError(e.data),
        onApiChange: () => noCaptions(),
        onPlaybackRateChange: (e) => setPs({ rate: e.data }),
      },
    });
  })();
  return creating;
}

// 画面から外れた古い箱に入ったプレーヤーは捨てて、新しい箱で作り直す
function ensureAlive() {
  if (!player || !hostEl) return;
  let iframe = null;
  try { iframe = player.getIframe?.(); } catch (_) { /* 壊れている */ }
  if (iframe && hostEl.contains(iframe)) return;
  try { player.destroy(); } catch (_) { /* 何もしない */ }
  player = null;
  setPs({ ready: false, st: -1 });
}

function onState(st) {
  const patch = { st, buffering: st === 3 };
  if (st === 1) {
    if (ps.upNext) clearNext();
    if (!ps.started) {
      patch.started = true;
      if (!ps.manualPass) patch.pass = false;
    }
    patch.error = '';
    if (captionsOffFor !== ps.id) {
      captionsOffFor = ps.id;
      noCaptions();
      try { player.setPlaybackRate(appState().prefs.rate || 1); } catch (_) { /* 同上 */ }
    }
    try {
      const vd = player.getVideoData?.();
      patch.live = !!vd?.isLive;
    } catch (_) { /* 古いAPI */ }
  }
  setPs(patch);
  if (st === 2) saveNow(true);
  if (st === 0 && ps.mode === 'short') {
    // ショートは YouTube アプリと同じく、くり返し流す
    try {
      player.seekTo(0, true);
      player.playVideo();
    } catch (_) { /* 何もしない */ }
    return;
  }
  if (st === 0) {
    saveNow(true, true);
    // 小さい窓で流しているときは、勝手に再生画面へ移らない
    if (ps.mode === 'full' || ps.fs) scheduleNext();
  }
}

const ERR = {
  2: '動画の番号が正しくありません',
  5: 'この動画はここでは再生できません',
  100: '動画が見つかりません(削除・非公開の可能性)',
  101: '投稿者がほかのサイトでの再生を許可していない動画です',
  150: '投稿者がほかのサイトでの再生を許可していない動画です',
  153: 'この動画はここでは再生できません',
};
function onError(code) {
  setPs({ error: ERR[code] || `再生できませんでした(${code})`, pass: false });
}

// ------------------------------------------------------------------ 再生位置の記録
function saveNow(flush = false, ended = false) {
  if (!player || !ps.id || ps.live || ps.mode === 'short') return;
  let t = 0;
  let d = 0;
  try {
    t = player.getCurrentTime() || 0;
    d = player.getDuration() || 0;
  } catch (_) {
    return;
  }
  if (!d || t < 1) return;
  // 動画を切りかえた直後は、前の動画の時間がまだ返ってくるので記録しない
  try {
    const vd = player.getVideoData?.();
    if (!vd || vd.video_id !== ps.id) return;
  } catch (_) {
    return;
  }
  const info = videoInfo(ps.id);
  const done = ended || d - t <= Math.min(30, Math.max(2, d * 0.05));
  setProgress(ps.id, { pos: Math.round(t), dur: Math.round(d), done, title: info.title || undefined, ch: info.chId || undefined, cht: info.cht || undefined }, { flush });
  lastSaved = Date.now();
}

setInterval(() => {
  if (!player || !ps.id || ps.mode === 'none') return;
  let t = ps.time;
  let d = ps.dur;
  try {
    t = player.getCurrentTime?.() ?? t;
    d = player.getDuration?.() ?? d;
  } catch (_) { /* まだ準備中 */ }
  if (Math.abs(t - ps.time) > 0.2 || d !== ps.dur) setPs({ time: t, dur: d });
  if (ps.st === 1 && Date.now() - lastSaved > 5000) saveNow(false);
}, 500);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow(true);
});
addEventListener('pagehide', () => saveNow(true));

// ------------------------------------------------------------------ 操作
export async function load(id, { queue, short = false } = {}) {
  if (!id) return;
  const mode = short ? 'short' : 'full';
  if (queue) setPs({ queue });
  ensureAlive();
  if (ps.id === id && (player || creating || want)) {
    if (ps.mode !== mode) setPs({ mode });
    return;
  }
  if (ps.id) saveNow(true);
  clearNext();
  captionsOffFor = '';
  if (ps.fs) exitFs();
  setPs({ id, mode, st: -1, time: 0, dur: short ? 0 : videoInfo(id).dur || 0, error: '', live: false, upNext: null });
  // 別の端末で見た位置が届く前に始めると、古い位置から流して上書きしてしまうので、読み込み中なら少し待つ
  if (!short) await whenLoaded(3500);
  if (ps.id !== id) return; // 待っている間に別の動画が選ばれた
  const start = short ? 0 : resumePoint(id);
  setPs({ time: start });
  if (!player || !ps.ready) {
    want = { id, start };
    if (!player) create();
    return;
  }
  player.loadVideoById({ videoId: id, startSeconds: start });
  if (start > 5) toast(`${fmtTime(start)} から再開します`, 1800);
}

export function setMode(mode) {
  if (mode === ps.mode) return;
  if (mode !== 'full' && ps.fs) exitFs();
  setPs({ mode });
}

export function close() {
  saveNow(true);
  clearNext();
  want = null;
  try { player?.stopVideo(); } catch (_) { /* 何もしない */ }
  if (ps.fs) exitFs();
  setPs({ id: '', mode: 'none', st: -1, time: 0, dur: 0, error: '', upNext: null });
}

export function togglePlay() {
  if (!player) return;
  if (ps.upNext) clearNext();
  try {
    if (ps.st === 1 || ps.st === 3) player.pauseVideo();
    else player.playVideo();
  } catch (_) { /* 準備中 */ }
}
export function seekTo(sec) {
  if (!player) return;
  const d = ps.dur || player.getDuration?.() || 0;
  const t = Math.max(0, d ? Math.min(sec, d - 0.5) : sec);
  if (ps.upNext) clearNext();
  try {
    player.seekTo(t, true);
    setPs({ time: t });
    if (ps.st !== 1) player.playVideo();
  } catch (_) { /* 準備中 */ }
  lastSaved = 0;
}
export const seekBy = (d) => seekTo((ps.time || 0) + d);
export function setRate(r) {
  try { player?.setPlaybackRate(r); } catch (_) { /* 何もしない */ }
  setPs({ rate: r });
}
export function restart() {
  seekTo(0);
}
// 前の動画: 5秒より先なら頭に戻る。頭なら、続けて再生している並びの1つ前へ
export function hasPrev() {
  const q = ps.queue || [];
  return q.indexOf(ps.id) > 0;
}
export function playPrev() {
  const q = ps.queue || [];
  const i = q.indexOf(ps.id);
  if ((ps.time || 0) > 5 || i <= 0) return seekTo(0);
  clearNext();
  location.hash = `#/w/${q[i - 1]}`;
}
export function setPass(on) {
  setPs({ pass: on, manualPass: on });
}

// ------------------------------------------------------------------ 全画面
export function enterFs() {
  setPs({ fs: true });
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch (_) { /* iPhone は画面いっぱいの表示だけ */ }
}
export function exitFs() {
  setPs({ fs: false });
  try {
    screen.orientation?.unlock?.();
  } catch (_) { /* 何もしない */ }
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && ps.fs) setPs({ fs: false });
});

// ------------------------------------------------------------------ 次の動画
let nextTimer = 0;
function clearNext() {
  clearTimeout(nextTimer);
  if (ps.upNext) setPs({ upNext: null });
}
export function nextCandidate() {
  const q = ps.queue || [];
  const i = q.indexOf(ps.id);
  const prog = appState().progress;
  if (i >= 0) {
    for (let k = i + 1; k < q.length; k++) if (!prog[q[k]]?.done) return q[k];
  }
  const rel = videoDetail(ps.id)?.related || [];
  const r = rel.find((v) => !prog[v.id]?.done && !v.live) || rel[0];
  return r?.id || '';
}
function scheduleNext() {
  if (!appState().prefs.autoNext) return;
  const id = nextCandidate();
  if (!id) return;
  setPs({ upNext: { id, ms: 6000 } });
  clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    if (ps.upNext?.id === id) playNext();
  }, 6000);
}
export function playNext() {
  const id = ps.upNext?.id || nextCandidate();
  clearNext();
  if (id) location.hash = `#/w/${id}`;
}
export function cancelNext() {
  clearNext();
}

// ------------------------------------------------------------------ キーボード(パソコン)
addEventListener('keydown', (e) => {
  if (!ps.id || (ps.mode !== 'full' && ps.mode !== 'short' && !ps.fs)) return;
  const tag = (e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ' || k === 'k') togglePlay();
  else if (k === 'j') seekBy(-10);
  else if (k === 'l') seekBy(10);
  else if (k === 'ArrowLeft') seekBy(-5);
  else if (k === 'ArrowRight') seekBy(5);
  else if (k === 'f') (ps.fs ? exitFs() : enterFs());
  else if (k === 'Escape' && ps.fs) exitFs();
  else if (k === '>' ) setRate(Math.min(2, (ps.rate || 1) + 0.25));
  else if (k === '<') setRate(Math.max(0.5, (ps.rate || 1) - 0.25));
  else return;
  e.preventDefault();
});

// ------------------------------------------------------------------ 画面
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function Icon({ d, size = 24 }) {
  return html`<svg viewBox="0 0 24 24" width=${size} height=${size} aria-hidden="true"><path d=${d} fill="currentColor" fill-rule="evenodd" /></svg>`;
}
export const IC = {
  play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
  pause: 'M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z',
  next: 'M5 18l8.5-6L5 6v12zm11-12v12h2.5V6H16z',
  prev: 'M5.5 6H8v12H5.5zm3.5 6 8.5 6V6z',
  down: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  fs: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fsExit: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  gear: 'M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.48.48 0 0 0 13.92 2h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.72 8.47a.48.48 0 0 0 .12.61l2.03 1.58c-.04.31-.07.63-.07.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
  speed: 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z',
  restart: 'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  hand: 'M13 2a1.5 1.5 0 0 0-1.5 1.5V11h-1V4.5a1.5 1.5 0 0 0-3 0V13l-1.8-1.9a1.5 1.5 0 0 0-2.2 2.1l4.4 5A6 6 0 0 0 12.4 20H14a6 6 0 0 0 6-6V7.5a1.5 1.5 0 0 0-3 0V11h-1V5a1.5 1.5 0 0 0-1.5-1.5V3.5A1.5 1.5 0 0 0 13 2z',
  open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  cc: 'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H5V6h14v12zM7 15h3a1 1 0 0 0 1-1v-1H9.5v.5h-2v-3h2v.5H11v-1a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1zm7 0h3a1 1 0 0 0 1-1v-1h-1.5v.5h-2v-3h2v.5H18v-1a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1z',
  ff: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
  rw: 'M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z',
  autoplay: 'M8 6.5v11l9-5.5z',
};

// 設定の窓(YouTube アプリと同じく、下から出る)
let settingsOpen = null;
function PlayerSheet() {
  const [page, setPage] = useState(null); // null | 'main' | 'rate'
  settingsOpen = setPage;
  const rate = usePlayer((p) => p.rate);
  const id = usePlayer((p) => p.id);
  const time = usePlayer((p) => p.time);
  const autoNext = useSyncExternalStore(subscribeApp, () => appState().prefs.autoNext);
  if (!page) return null;
  const done = () => setPage(null);
  return html`<div class="sheet-bg pl-sheet" onClick=${done}>
    <div class="sheet" onClick=${(e) => e.stopPropagation()}>
      <div class="sheet-grip"></div>
      ${page === 'main' && html`
        <button class="sheet-i" onClick=${() => setPage('rate')}><${Icon} d=${IC.speed} /><span>再生速度</span><span class="sp"></span><span class="sheet-v">${(rate || 1) === 1 ? '標準' : (rate || 1) + 'x'}</span></button>
        <button class="sheet-i" onClick=${() => { setPref('autoNext', !autoNext); done(); }}><${Icon} d=${IC.autoplay} /><span>自動再生</span><span class="sp"></span><span class="sheet-v">${autoNext ? 'オン' : 'オフ'}</span></button>
        <button class="sheet-i" onClick=${() => { restart(); done(); }}><${Icon} d=${IC.restart} /><span>最初から再生</span></button>
        <div class="sheet-i dim"><${Icon} d=${IC.cc} /><span>字幕</span><span class="sp"></span><span class="sheet-v">オフ(いつも)</span></div>
        <button class="sheet-i" onClick=${() => { setPass(true); done(); }}><${Icon} d=${IC.hand} /><span>YouTube の画面を直接さわる<small>広告の「スキップ」を押すときなど</small></span></button>
        <a class="sheet-i" href=${watchUrl(id, time)} target="_blank" rel="noopener" onClick=${() => { try { player?.pauseVideo(); } catch (_) {} done(); }}><${Icon} d=${IC.open} /><span>YouTube で開く(いまの位置から)</span></a>
      `}
      ${page === 'rate' && html`
        <div class="sheet-head"><button class="ib sm" onClick=${() => setPage('main')} aria-label="戻る"><${Icon} d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></button><b>再生速度</b></div>
        ${RATES.map((r) => html`<button key=${r} class=${clsx('sheet-i rate', r === (rate || 1) && 'sel')} onClick=${() => { setRate(r); setPref('rate', r); done(); }}>
          <span class="chk">${r === (rate || 1) ? '✓' : ''}</span><span>${r === 1 ? '標準' : r + 'x'}</span></button>`)}
      `}
    </div>
  </div>`;
}

function Controls() {
  const st = usePlayer((p) => p.st);
  const time = usePlayer((p) => p.time);
  const dur = usePlayer((p) => p.dur);
  const fs = usePlayer((p) => p.fs);
  const pass = usePlayer((p) => p.pass);
  const started = usePlayer((p) => p.started);
  const err = usePlayer((p) => p.error);
  const id = usePlayer((p) => p.id);
  const live = usePlayer((p) => p.live);
  const buffering = usePlayer((p) => p.buffering);
  const upNext = usePlayer((p) => p.upNext);
  const autoNext = useSyncExternalStore(subscribeApp, () => appState().prefs.autoNext);
  const [show, setShow] = useState(true);
  const [drag, setDrag] = useState(null);
  const [boost, setBoost] = useState(false);
  const dragRef = useRef(null);
  // つまみを離したときに1回だけ飛ぶ(動かしている間は表示だけ変える)
  const commitDrag = () => {
    if (dragRef.current == null) return;
    const v = dragRef.current;
    dragRef.current = null;
    seekTo(v);
    setDrag(null);
  };
  const [ripple, setRipple] = useState(null);
  const tapRef = useRef({ t: 0, timer: 0, x: 0 });
  const hideRef = useRef(0);
  const g = useRef({});
  const playing = st === 1 || st === 3;

  const poke = () => {
    setShow(true);
    clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => {
      const st2 = getPs().st;
      if (st2 === 1 || st2 === 3) setShow(false);
    }, 3000);
  };
  useEffect(() => {
    if (playing) poke();
    else setShow(true);
    return () => clearTimeout(hideRef.current);
  }, [playing]);

  // 指の動き: 下へ → 小さくする / 上へ → 全画面 / 全画面で下へ → 戻す / 長押し → 2倍速
  const onDown = (e) => {
    if (e.target.closest('button, input, a, .pc-err, .pc-next')) return;
    const s = { x: e.clientX, y: e.clientY, moved: false, drag: false, long: false, dy: 0 };
    s.lt = setTimeout(() => {
      if (!s.moved && getPs().st === 1) {
        s.long = true;
        s.prevRate = getPs().rate || 1;
        setRate(2);
        setBoost(true);
        setShow(false);
      }
    }, 450);
    g.current = s;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* 何もしない */ }
  };
  const onMove = (e) => {
    const s = g.current;
    if (s.x == null) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) > 10) {
      s.moved = true;
      clearTimeout(s.lt);
      if (!s.long && Math.abs(dy) > Math.abs(dx)) s.drag = true;
    }
    if (s.drag) {
      s.dy = dy;
      if (!getPs().fs) document.documentElement.style.setProperty('--wdrag', Math.max(0, dy) + 'px');
    }
  };
  const onUp = (e, cancel) => {
    const s = g.current;
    if (s.x == null) return;
    clearTimeout(s.lt);
    s.x = null;
    if (s.long) {
      setRate(s.prevRate);
      setBoost(false);
      s.suppress = true;
    } else if (s.drag) {
      s.suppress = true;
      document.documentElement.style.removeProperty('--wdrag');
      if (cancel) return;
      const fsNow = getPs().fs;
      if (!fsNow && s.dy > 90) leaveWatch();
      else if (!fsNow && s.dy < -50) enterFs();
      else if (fsNow && s.dy > 60) exitFs();
    }
  };

  const onTap = (e) => {
    if (g.current.suppress) {
      g.current.suppress = false;
      return;
    }
    if (e.target.closest('button, input, a')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const now = Date.now();
    const tr = tapRef.current;
    if (now - tr.t < 300 && Math.abs(x - tr.x) < 0.25) {
      clearTimeout(tr.timer);
      tr.t = 0;
      if (x < 0.4 || x > 0.6) {
        const side = x < 0.4 ? 'l' : 'r';
        seekBy(side === 'l' ? -10 : 10);
        setShow(false);
        setRipple((r) => ({ side, k: now, n: r && r.side === side && now - r.k < 900 ? r.n + 10 : 10 }));
        setTimeout(() => setRipple((r) => (r?.k === now ? null : r)), 800);
      }
      return;
    }
    tr.t = now;
    tr.x = x;
    tr.timer = setTimeout(() => {
      if (show) {
        setShow(false);
        clearTimeout(hideRef.current);
      } else poke();
    }, 300);
  };

  if (pass) {
    return html`<div class="pc-pass">
      ${!started && !err
        ? html`<div class="pc-hint">動画の ▶ を押して再生</div>`
        : html`<button class="pc-chip pc-back" onClick=${() => setPass(false)}>操作ボタンに戻す</button>`}
    </div>`;
  }

  const shown = drag != null ? drag : time;
  const pct = dur ? Math.min(100, (shown / dur) * 100) : 0;
  const nextInfo = upNext ? videoInfo(upNext.id) : null;
  const hasNext = !!nextCandidate();

  return html`<div class=${clsx('pc', show && 'on')} onClick=${onTap}
      onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${(e) => onUp(e, false)} onPointerCancel=${(e) => onUp(e, true)}>
    ${ripple && html`<div class=${'pc-ripple ' + ripple.side} key=${ripple.side}>
      <div class="pc-rip-in"><${Icon} d=${ripple.side === 'l' ? IC.rw : IC.ff} size=${26} /><span>${ripple.n} 秒</span></div>
    </div>`}
    ${boost && html`<div class="pc-boost">2x <${Icon} d=${IC.ff} size=${16} /></div>`}
    ${buffering && !show && html`<div class="pc-spin"></div>`}
    ${err &&
    html`<div class="pc-err" onClick=${(e) => e.stopPropagation()}>
      <p>${err}</p>
      <div class="row">
        <a class="btn" href=${watchUrl(id, resumePoint(id))} target="_blank" rel="noopener">YouTubeで開く</a>
        ${hasNext && html`<button class="btn ghost" onClick=${() => playNext()}>次の動画へ</button>`}
      </div>
    </div>`}
    ${nextInfo &&
    html`<div class="pc-next" onClick=${(e) => e.stopPropagation()}>
      <div class="pc-next-t">次の動画</div>
      <div class="pc-next-title">${nextInfo.title || '次の動画'}</div>
      <div class="row">
        <button class="btn ghost" onClick=${cancelNext}>キャンセル</button>
        <button class="btn" onClick=${playNext}>今すぐ再生</button>
      </div>
      <div class="pc-next-bar" key=${upNext.id} style=${{ animationDuration: upNext.ms + 'ms' }}></div>
    </div>`}
    <div class="pc-shade"></div>
    <div class="pc-top">
      ${fs
        ? html`<button class="pc-ib" aria-label="全画面をやめる" onClick=${exitFs}><${Icon} d=${IC.down} size=${28} /></button><div class="pc-title">${videoInfo(id).title}</div>`
        : html`<button class="pc-ib" aria-label="小さくする" onClick=${leaveWatch}><${Icon} d=${IC.down} size=${30} /></button>`}
      <span class="sp"></span>
      <button class=${clsx('pc-auto', autoNext && 'on')} aria-label="自動再生" onClick=${() => { setPref('autoNext', !autoNext); poke(); toast(autoNext ? '自動再生はオフです' : '自動再生はオンです', 1500); }}>
        <i><${Icon} d=${autoNext ? IC.play : IC.pause} size=${12} /></i>
      </button>
      <button class="pc-ib" aria-label="字幕(いつもオフ)" onClick=${() => toast('字幕はいつも出さない設定です', 1500)}><${Icon} d=${IC.cc} size=${22} /></button>
      <button class="pc-ib" aria-label="設定" onClick=${() => { settingsOpen?.('main'); }}><${Icon} d=${IC.gear} size=${22} /></button>
    </div>
    <div class="pc-mid">
      <button class=${clsx('pc-ib big2', !hasPrev() && 'off')} aria-label="前の動画" onClick=${() => { playPrev(); poke(); }}><${Icon} d=${IC.prev} size=${30} /></button>
      <button class="pc-ib big" aria-label=${playing ? '一時停止' : '再生'} onClick=${() => { togglePlay(); poke(); }}><${Icon} d=${playing ? IC.pause : IC.play} size=${40} /></button>
      <button class=${clsx('pc-ib big2', !hasNext && 'off')} aria-label="次の動画" onClick=${() => { if (hasNext) playNext(); poke(); }}><${Icon} d=${IC.next} size=${30} /></button>
    </div>
    <div class="pc-bottom">
      <div class="pc-time">${live ? html`<span class="live">● ライブ</span>` : html`${fmtTime(shown)} <span class="dur">/ ${fmtTime(dur)}</span>`}</div>
      <span class="sp"></span>
      <button class="pc-ib" aria-label=${fs ? '全画面をやめる' : '全画面'} onClick=${() => (fs ? exitFs() : enterFs())}><${Icon} d=${fs ? IC.fsExit : IC.fs} /></button>
    </div>
    ${!live &&
    html`<div class="pc-seek" style=${{ '--p': pct + '%' }}>
      <input type="range" min="0" max=${Math.max(1, Math.floor(dur))} step="1" value=${Math.floor(shown)} aria-label="再生位置"
        onInput=${(e) => { dragRef.current = Number(e.target.value); setDrag(dragRef.current); poke(); }}
        onChange=${(e) => { dragRef.current = Number(e.target.value); setDrag(dragRef.current); }}
        onPointerUp=${commitDrag} onTouchEnd=${commitDrag} onKeyUp=${commitDrag} onBlur=${commitDrag} />
    </div>`}
    <div class="pc-line" style=${{ width: pct + '%' }}></div>
  </div>`;
}

function MiniBar() {
  const id = usePlayer((p) => p.id);
  const st = usePlayer((p) => p.st);
  const time = usePlayer((p) => p.time);
  const dur = usePlayer((p) => p.dur);
  const info = videoInfo(id);
  const playing = st === 1 || st === 3;
  return html`<div class="mini-body">
    <button class="mini-open" onClick=${() => (location.hash = `#/w/${id}`)} aria-label="大きくする">
      <div class="mini-title">${info.title || '再生中'}</div>
      <div class="mini-sub">${info.cht}</div>
    </button>
    <button class="pc-ib dark" aria-label=${playing ? '一時停止' : '再生'} onClick=${togglePlay}><${Icon} d=${playing ? IC.pause : IC.play} size=${26} /></button>
    <button class="pc-ib dark" aria-label="閉じる" onClick=${close}><${Icon} d=${IC.close} size=${26} /></button>
    <div class="mini-line" style=${{ width: (dur ? (time / dur) * 100 : 0) + '%' }}></div>
  </div>`;
}

export function PlayerShell() {
  const mode = usePlayer((p) => p.mode);
  const fs = usePlayer((p) => p.fs);
  const id = usePlayer((p) => p.id);
  const hostRef = useRef(null);
  const prevMode = useRef(mode);
  const [enter, setEnter] = useState(false);
  const mg = useRef({});
  useEffect(() => {
    attachHost(hostRef.current);
    // 箱が付き直したとき: 古いプレーヤーは捨て、頼まれていた動画があれば作る
    ensureAlive();
    if (!player && ps.id) {
      if (!want) want = { id: ps.id, start: resumePoint(ps.id) };
      create();
    }
    return () => attachHost(null);
  }, []);
  // 小さい窓 → 再生画面 のときだけ、下からせり上がる
  useEffect(() => {
    const was = prevMode.current;
    prevMode.current = mode;
    if (mode === 'full' && (was === 'mini' || was === 'none')) {
      setEnter(true);
      const t = setTimeout(() => setEnter(false), 320);
      return () => clearTimeout(t);
    }
  }, [mode]);
  // 小さい窓: 上へはらう → 大きく / 下へはらう → 閉じる
  const mini = mode === 'mini' && !fs;
  const mDown = (e) => {
    if (e.target.closest('.pc-ib')) return;
    mg.current = { y: e.clientY };
  };
  const mMove = (e) => {
    const s = mg.current;
    if (s.y == null) return;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) > 8) {
      s.moved = true;
      e.currentTarget.style.translate = `0 ${dy > 0 ? dy : dy / 3}px`;
    }
  };
  const mUp = (e) => {
    const s = mg.current;
    if (s.y == null) return;
    const dy = e.clientY - s.y;
    mg.current = { justMoved: !!s.moved };
    setTimeout(() => { mg.current.justMoved = false; }, 350);
    e.currentTarget.style.translate = '';
    if (dy < -30) location.hash = `#/w/${id}`;
    else if (dy > 40) close();
  };
  return html`<${React.Fragment}>
    <div class=${clsx('ph', fs ? 'fs' : mode, enter && 'enter')} aria-hidden=${mode === 'none' ? 'true' : 'false'}
      onPointerDown=${mini ? mDown : null} onPointerMove=${mini ? mMove : null} onPointerUp=${mini ? mUp : null} onPointerCancel=${mini ? mUp : null}
      onClickCapture=${mini ? (e) => { if (mg.current.justMoved) { e.stopPropagation(); e.preventDefault(); } } : null}>
      <div class="ph-video">
        <div class="ph-host" ref=${hostRef}></div>
        ${id && (mode === 'full' || fs) && html`<${Controls} />`}
        ${id && mini && html`<button class="mini-cover" aria-label="大きくする" onClick=${() => (location.hash = `#/w/${id}`)}></button>`}
      </div>
      ${id && mini && html`<${MiniBar} />`}
    </div>
    <${PlayerSheet} />
  </${React.Fragment}>`;
}

export { flushProgress };
