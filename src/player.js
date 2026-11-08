// 動画プレーヤー: YouTube 公式の埋め込み(iframe API)を1つだけ作り、画面を移っても使い回す(小さい再生窓になる)。
// 広告や動画そのものには手を加えない。こちらが行うのは、操作ボタン・続きからの再開・字幕を出さない設定だけ。
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { html, fmtTime, watchUrl, clsx, leaveWatch } from './util.js';
import { getState as appState, setProgress, flushProgress, videoInfo, videoDetail, toast, setPref, whenLoaded } from './store.js';

// ------------------------------------------------------------------ プレーヤーの状態(アプリの状態とは別。0.5秒ごとに変わるため)
let ps = {
  id: '',
  mode: 'none', // 'full' | 'mini' | 'none'
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
  if (!player || !ps.id || ps.live) return;
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
export async function load(id, { queue } = {}) {
  if (!id) return;
  if (queue) setPs({ queue });
  ensureAlive();
  if (ps.id === id && (player || creating || want)) {
    if (ps.mode !== 'full') setPs({ mode: 'full' });
    return;
  }
  if (ps.id) saveNow(true);
  clearNext();
  captionsOffFor = '';
  setPs({ id, mode: 'full', st: -1, time: 0, dur: videoInfo(id).dur || 0, error: '', live: false, upNext: null });
  // 別の端末で見た位置が届く前に始めると、古い位置から流して上書きしてしまうので、読み込み中なら少し待つ
  await whenLoaded(3500);
  if (ps.id !== id) return; // 待っている間に別の動画が選ばれた
  const start = resumePoint(id);
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
  if (!ps.id || (ps.mode !== 'full' && !ps.fs)) return;
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
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function Icon({ d, size = 24 }) {
  return html`<svg viewBox="0 0 24 24" width=${size} height=${size} aria-hidden="true"><path d=${d} fill="currentColor" /></svg>`;
}
export const IC = {
  play: 'M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  back10: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8zm-1.1 11h-.9v-3.3l-1 .3v-.7l1.8-.6h.1V16zm4.3-1.8c0 .6-.1 1.1-.4 1.4-.3.3-.6.5-1.1.5s-.8-.2-1.1-.5c-.3-.3-.4-.8-.4-1.4v-.7c0-.6.1-1.1.4-1.4.3-.3.6-.5 1.1-.5s.8.2 1.1.5c.3.3.4.8.4 1.4v.7zm-.9-.8c0-.4 0-.6-.1-.8-.1-.2-.3-.3-.5-.3s-.4.1-.5.3c-.1.2-.1.4-.1.8v.9c0 .4 0 .6.1.8.1.2.3.3.5.3s.4-.1.5-.3c.1-.2.1-.5.1-.8v-.9z',
  fwd10: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8zm-1.1 11h-.9v-3.3l-1 .3v-.7l1.8-.6h.1V16zm4.3-1.8c0 .6-.1 1.1-.4 1.4-.3.3-.6.5-1.1.5s-.8-.2-1.1-.5c-.3-.3-.4-.8-.4-1.4v-.7c0-.6.1-1.1.4-1.4.3-.3.6-.5 1.1-.5s.8.2 1.1.5c.3.3.4.8.4 1.4v.7zm-.9-.8c0-.4 0-.6-.1-.8-.1-.2-.3-.3-.5-.3s-.4.1-.5.3c-.1.2-.1.4-.1.8v.9c0 .4 0 .6.1.8.1.2.3.3.5.3s.4-.1.5-.3c.1-.2.1-.5.1-.8v-.9z',
  next: 'M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z',
  down: 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  fs: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fsExit: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  hand: 'M13 2a1.5 1.5 0 0 0-1.5 1.5V11h-1V4.5a1.5 1.5 0 0 0-3 0V13l-1.8-1.9a1.5 1.5 0 0 0-2.2 2.1l4.4 5A6 6 0 0 0 12.4 20H14a6 6 0 0 0 6-6V7.5a1.5 1.5 0 0 0-3 0V11h-1V5a1.5 1.5 0 0 0-1.5-1.5V3.5A1.5 1.5 0 0 0 13 2z',
};

function Controls() {
  const st = usePlayer((p) => p.st);
  const time = usePlayer((p) => p.time);
  const dur = usePlayer((p) => p.dur);
  const fs = usePlayer((p) => p.fs);
  const rate = usePlayer((p) => p.rate);
  const pass = usePlayer((p) => p.pass);
  const started = usePlayer((p) => p.started);
  const err = usePlayer((p) => p.error);
  const id = usePlayer((p) => p.id);
  const live = usePlayer((p) => p.live);
  const buffering = usePlayer((p) => p.buffering);
  const upNext = usePlayer((p) => p.upNext);
  const [show, setShow] = useState(true);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState(null);
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
  const playing = st === 1 || st === 3;

  const poke = () => {
    setShow(true);
    clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => {
      if (getPs().st === 1) setShow(false);
    }, 3200);
  };
  useEffect(() => {
    if (playing) poke();
    else setShow(true);
    return () => clearTimeout(hideRef.current);
  }, [playing]);

  const onTap = (e) => {
    if (e.target.closest('button, input, .pc-menu')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const now = Date.now();
    const tr = tapRef.current;
    if (now - tr.t < 280 && Math.abs(x - tr.x) < 0.25) {
      clearTimeout(tr.timer);
      tr.t = 0;
      if (x < 0.4 || x > 0.6) {
        const d = x < 0.4 ? -10 : 10;
        seekBy(d);
        setRipple({ side: d < 0 ? 'l' : 'r', k: now });
        setTimeout(() => setRipple((r) => (r?.k === now ? null : r)), 650);
      }
      return;
    }
    tr.t = now;
    tr.x = x;
    tr.timer = setTimeout(() => {
      setMenu(false);
      if (show && playing) {
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

  return html`<div class=${clsx('pc', show && 'on')} onClick=${onTap}>
    ${ripple && html`<div class=${'pc-ripple ' + ripple.side} key=${ripple.k}><span>${ripple.side === 'l' ? '« 10秒' : '10秒 »'}</span></div>`}
    ${buffering && html`<div class="pc-spin"></div>`}
    ${err &&
    html`<div class="pc-err" onClick=${(e) => e.stopPropagation()}>
      <p>${err}</p>
      <div class="row">
        <a class="btn" href=${watchUrl(id, resumePoint(id))} target="_blank" rel="noopener">YouTubeで開く</a>
        ${nextCandidate() && html`<button class="btn ghost" onClick=${() => playNext()}>次の動画へ</button>`}
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
      ${!fs && html`<button class="pc-ib" aria-label="小さくする" onClick=${leaveWatch}><${Icon} d=${IC.down} size=${28} /></button>`}
      ${fs && html`<div class="pc-title">${videoInfo(id).title}</div>`}
      <span class="sp"></span>
      <button class="pc-chip" onClick=${() => setMenu(menu === 'rate' ? false : 'rate')}>${rate || 1}x</button>
      <button class="pc-ib" aria-label="その他" onClick=${() => setMenu(menu === 'more' ? false : 'more')}><${Icon} d=${IC.more} /></button>
    </div>
    ${menu === 'rate' &&
    html`<div class="pc-menu">
      <div class="pc-menu-h">再生速度</div>
      ${RATES.map((r) => html`<button key=${r} class=${clsx('pc-mi', r === (rate || 1) && 'sel')} onClick=${() => { setRate(r); setMenu(false); poke(); }}>${r === 1 ? '標準' : r + 'x'}</button>`)}
      <label class="pc-mi chk"><input type="checkbox" checked=${appState().prefs.rate === (rate || 1)} onChange=${(e) => { setPref('rate', e.target.checked ? rate || 1 : 1); setMenu(false); }} /> この速さをいつもの速さにする</label>
    </div>`}
    ${menu === 'more' &&
    html`<div class="pc-menu">
      <button class="pc-mi" onClick=${() => { restart(); setMenu(false); }}>最初から再生</button>
      <button class="pc-mi" onClick=${() => { setPass(true); setMenu(false); }}>YouTube の画面を直接さわる<small>広告の「スキップ」を押すときなど</small></button>
      <a class="pc-mi" href=${watchUrl(id, time)} target="_blank" rel="noopener" onClick=${() => { try { player?.pauseVideo(); } catch (_) {} setMenu(false); }}>YouTubeで開く(いまの位置から)</a>
      <div class="pc-mi dim">字幕はいつも出さない設定です</div>
    </div>`}
    <div class="pc-mid">
      <button class="pc-ib big2" aria-label="10秒戻る" onClick=${() => { seekBy(-10); poke(); }}><${Icon} d=${IC.back10} size=${34} /></button>
      <button class="pc-ib big" aria-label=${playing ? '一時停止' : '再生'} onClick=${() => { togglePlay(); poke(); }}><${Icon} d=${playing ? IC.pause : IC.play} size=${44} /></button>
      <button class="pc-ib big2" aria-label="10秒進む" onClick=${() => { seekBy(10); poke(); }}><${Icon} d=${IC.fwd10} size=${34} /></button>
    </div>
    <div class="pc-bottom">
      <div class="pc-time">${live ? html`<span class="live">● ライブ</span>` : `${fmtTime(shown)} / ${fmtTime(dur)}`}</div>
      <span class="sp"></span>
      ${nextCandidate() && html`<button class="pc-ib" aria-label="次の動画" onClick=${() => playNext()}><${Icon} d=${IC.next} /></button>`}
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
    <button class="pc-ib dark" aria-label=${playing ? '一時停止' : '再生'} onClick=${togglePlay}><${Icon} d=${playing ? IC.pause : IC.play} /></button>
    <button class="pc-ib dark" aria-label="閉じる" onClick=${close}><${Icon} d=${IC.close} /></button>
    <div class="mini-line" style=${{ width: (dur ? (time / dur) * 100 : 0) + '%' }}></div>
  </div>`;
}

export function PlayerShell() {
  const mode = usePlayer((p) => p.mode);
  const fs = usePlayer((p) => p.fs);
  const id = usePlayer((p) => p.id);
  const hostRef = useRef(null);
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
  return html`<div class=${clsx('ph', fs ? 'fs' : mode)} aria-hidden=${mode === 'none' ? 'true' : 'false'}>
    <div class="ph-video">
      <div class="ph-host" ref=${hostRef}></div>
      ${id && (mode === 'full' || fs) && html`<${Controls} />`}
      ${id && mode === 'mini' && !fs && html`<button class="mini-cover" aria-label="大きくする" onClick=${() => (location.hash = `#/w/${id}`)}></button>`}
    </div>
    ${id && mode === 'mini' && !fs && html`<${MiniBar} />`}
  </div>`;
}

export { flushProgress };
