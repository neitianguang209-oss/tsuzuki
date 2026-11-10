// 動画プレーヤー: YouTube 公式の埋め込み(iframe API)を1つだけ作り、画面を移っても使い回す(小さい再生窓になる)。
// 広告や動画そのものには手を加えない。こちらが行うのは、操作ボタン・続きからの再開・字幕を出さない設定だけ。
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { html, fmtTime, watchUrl, clsx, leaveWatch, lsSetJson, lsGetJson, setThemeBlack, parseChapters } from './util.js';
import { fn } from './api.js';
import { getState as appState, subscribe as subscribeApp, setProgress, flushProgress, videoInfo, videoDetail, toast, setPref, whenLoaded, rememberDetail, rememberHits } from './store.js';

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
  autoPass: false, // 自動で始まらなかったので、動画を直接タップしてもらう状態
  userPaused: false,
  sleepAt: 0, // おやすみタイマーが切れる時刻(0 = タイマーなし)
  sleepLeft: 0, // あと何分か
  sleepEnd: false, // 「この動画が終わるまで」
  sleepMin: 0, // 選んだタイマー(0 / 分 / 'end')。設定の窓の ✓ に使う
  sleepWarn: false, // まもなく止まる(1分前)
  rotRev: (() => { try { return localStorage.getItem('tsuzuki:rotDir') === '-90'; } catch (_) { return false; } })(), // 回す向きを反対に
  loadedAt: 0, // この動画を読み込んだ時刻(広告スキップの案内を出す間)
  loadedStart: 0, // この動画を流し始めた位置
  adUsed: false, // (使っていない)
  contentStarted: false, // 本編が流れ始めた(広告が終わった)。「広告をスキップ」を消す合図
  adOver: false, // 読み込みから60秒たった(「広告をスキップ」を出さない)
  chapIdx: -1, // いまのチャプター(曲目)の番号
};

// iPhone・iPad か / ホーム画面のアイコンから開いているか
export const IOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const STANDALONE = (() => {
  try {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  } catch (_) {
    return false;
  }
})();
const TOUCH = (() => {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch (_) {
    return false;
  }
})();
// スマホだけ(iPad・タブレットは、横にしても勝手に全画面にせず、縦の全画面でも回さない)
const PHONE = TOUCH && Math.min(screen.width, screen.height) < 600;
const pl = new Set();
const pEmit = () => pl.forEach((l) => l());
function setPs(patch) {
  ps = { ...ps, ...patch };
  pEmit();
  if ('queue' in patch || 'id' in patch) {
    try { saveQueue(); } catch (_) { /* 起動直後 */ }
  }
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
          if (ps.started) kick(ps.id);
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
  // おやすみタイマーで止めた直後に、自動の次の動画などが勝手に流れ出したら止め直す(本人が画面をさわったら解除)
  if (st === 1 && sleepHoldUntil && Date.now() < sleepHoldUntil) {
    try { player.pauseVideo(); } catch (_) { /* 何もしない */ }
    setPs({ st: 2, buffering: false, userPaused: true });
    return;
  }
  const patch = { st, buffering: st === 3 };
  if (st === 1) {
    if (ps.upNext) clearNext();
    clearTimeout(kickTimer);
    patch.userPaused = false;
    if (!ps.sleepAt && !ps.sleepEnd) autoSleep();
    if (pendingSeek && pendingSeek.id === ps.id && curVid() === pendingSeek.id) {
      const p = pendingSeek;
      pendingSeek = null;
      setTimeout(() => seekTo(p.sec), 0);
    }
    if (!ps.started) {
      patch.started = true;
      if (!ps.manualPass) patch.pass = false;
    }
    if (ps.autoPass) {
      patch.autoPass = false;
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
  if (st === 1) mediaMeta();
  mediaState();
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
    // 「この動画が終わるまで」のおやすみタイマー: 次の動画へ進まず、ここで止める
    if (ps.sleepEnd) {
      setPs({ sleepEnd: false, sleepMin: 0 });
      writeSleep(ps.dur || 0);
      toast('おやすみなさい。動画が終わったので止めました', 4000);
      if (ps.fs) exitFs();
      return;
    }
    // 1本リピート: 頭に戻ってもう一度
    if (appState().prefs.repeat === 'one') {
      try {
        player.seekTo(0, true);
        player.playVideo();
      } catch (_) { /* 何もしない */ }
      return;
    }
    // 小さい窓でも、次の動画へ進む(小さい窓のまま)
    if (ps.mode === 'full' || ps.fs || ps.mode === 'mini') scheduleNext();
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
// ここ(埋め込み)では流せない動画は覚えておき、次からは「次の動画」の候補に入れない
const NOEMB = 'tsuzuki:noembed';
const noEmbed = new Set(lsGetJson(NOEMB, []) || []);
let err5Id = ''; // エラー5は一時的なこともあるので、同じ動画で2回続いたときだけ覚える
function onError(code) {
  const bad = [5, 101, 150, 153].includes(code);
  if (bad && ps.id && (code !== 5 || err5Id === ps.id)) {
    noEmbed.add(ps.id);
    lsSetJson(NOEMB, [...noEmbed].slice(-300));
  }
  if (code === 5) err5Id = ps.id;
  setPs({ error: ERR[code] || `再生できませんでした(${code})`, pass: false });
  // 自動で次へ進んできた動画なら、止めずにその次へ(自分で開いた動画では勝手に進まない)
  if (bad && ps.mode !== 'short' && autoCame) {
    const n = nextInfo();
    if (n.id && (n.from === 'user' || appState().prefs.autoNext)) {
      setPs({ upNext: { id: n.id, ms: 2500 } });
      clearTimeout(nextTimer);
      nextTimer = setTimeout(() => { if (ps.upNext?.id === n.id) playNext(); }, 2500);
    }
  }
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
  // 本編が流れ始めたら(広告のあいだは本編の位置が進まない)、「広告をスキップ」を消し、直接さわる状態も戻す
  if (!ps.contentStarted && ps.st === 1 && t > (ps.loadedStart || 0) + 2 && curVid() === ps.id) {
    setPs({ contentStarted: true });
    if (noEmbed.delete(ps.id)) lsSetJson(NOEMB, [...noEmbed]); // 流せたので「流せない動画」から外す
    if (adPassActive && ps.pass) {
      adPassActive = false;
      setPass(false);
    }
  }
  // チャプター(曲目)が変わったら、ロック画面の曲名も替える
  const ch = chaptersOf(ps.id);
  if (ch.length) {
    let k = 0;
    while (k + 1 < ch.length && ch[k + 1].sec <= t + 0.5) k++;
    if (k !== ps.chapIdx) {
      setPs({ chapIdx: k });
      mediaMeta();
    }
  } else if (ps.chapIdx !== -1) setPs({ chapIdx: -1 });
}, 500);

// チャプター(曲目)。説明欄から作り、動画ごとに覚えておく
const chapCache = new Map();
export function chaptersOf(id) {
  if (!id) return [];
  if (chapCache.has(id)) return chapCache.get(id);
  const d = videoDetail(id);
  if (!d) return [];
  const c = parseChapters(d.desc || '');
  chapCache.set(id, c);
  return c;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow(true);
});
addEventListener('pagehide', () => saveNow(true));

// ------------------------------------------------------------------ 操作
export async function load(id, { queue, short = false, keepMini = false } = {}) {
  if (!id) return;
  const mode = short ? 'short' : keepMini && ps.mode === 'mini' ? 'mini' : 'full';
  if (!short) {
    // 自分で「次に再生」「キューに追加」した動画は、一覧から開き直しても新しい動画のすぐ後ろに残す
    const old = ps.queue || [];
    const anchor = ps.id || restoredId; // アプリを開き直した直後は、前回流していた動画を目印にする
    const oi = anchor ? old.indexOf(anchor) : -1;
    const pend = oi >= 0 ? old.slice(oi + 1).filter((x) => userQueued.has(x) && x !== id) : [];
    restoredId = '';
    if (queue) {
      // 一覧から来た続きのうち、もう見終わった動画は入れない(キューの表示と実際に流れる順番をそろえる)
      const prog = appState().progress;
      const nq = queue.filter((x) => !pend.includes(x) && (x === id || userQueued.has(x) || !prog[x]?.done));
      let at = nq.indexOf(id);
      if (at < 0) {
        nq.unshift(id);
        at = 0;
      }
      if (pend.length) nq.splice(at + 1, 0, ...pend);
      setPs({ queue: nq });
      for (const x of [...userQueued]) if (!nq.includes(x)) userQueued.delete(x); // 使われなかった印は消す
    } else if (!(ps.queue || []).includes(id)) {
      // 並びの外の動画を開いた: その動画から始め直す(自分で入れた分は残す)
      for (const x of [...userQueued]) if (!pend.includes(x)) userQueued.delete(x);
      setPs({ queue: [id, ...pend] });
    }
  }
  ensureAlive();
  if (ps.id === id && (player || creating || want)) {
    if (ps.mode !== mode) setPs({ mode });
    return;
  }
  userQueued.delete(id); // 流し始めたら「自分で追加」の印は外す(2回目は、見終わりなら飛ばす)
  autoCame = autoNextPending === id;
  autoNextPending = '';
  clearTimeout(adTimer);
  adPassActive = false;
  clearTimeout(passTimer);
  if (ps.id) saveNow(true);
  clearNext();
  captionsOffFor = '';
  if (ps.fs && short) exitFs();
  setPs({ id, mode, st: -1, time: 0, dur: short ? 0 : videoInfo(id).dur || 0, error: '', live: false, upNext: null, autoPass: false, userPaused: false, loadedAt: Date.now(), loadedStart: 0, contentStarted: false, adOver: false, chapIdx: -1 });
  adTimer = setTimeout(() => { if (ps.id === id) setPs({ adOver: true }); }, 60e3);
  if (pendingSeek && pendingSeek.id !== id) pendingSeek = null;
  // 前の動画で「直接さわる」にしていたら戻す(最初の1本の「▶ を直接押す」状態はそのまま)
  if (ps.started && ps.pass) setPs({ pass: false, manualPass: false });
  else if (ps.manualPass) setPs({ manualPass: false });
  mediaMeta();
  // 別の端末で見た位置が届く前に始めると、古い位置から流して上書きしてしまうので、アプリを開いた直後の読み込みだけは少し待つ
  // (2本目からは待たない。待つと、押しても切りかわらないように見える)
  if (!short && (!appState().booted || appState().resyncing)) await whenLoaded(3500);
  if (ps.id !== id) return; // 待っている間に別の動画が選ばれた
  const start = short ? 0 : resumePoint(id);
  setPs({ time: start, loadedStart: start });
  if (!player || !ps.ready) {
    want = { id, start };
    if (!player) create();
    return;
  }
  player.loadVideoById({ videoId: id, startSeconds: start });
  kick(id);
  if (start > 5) toast(`${fmtTime(start)} から再開します`, 1800);
}

// 押した動画が自動で始まらないとき(iPhone でときどき起きる): もう一度「再生」を送り、
// それでも動かなければ、動画を直接タップしてもらう状態にする(YouTube の画面への1タップなら必ず始まる)
let kickTimer = 0;
function kick(id) {
  clearTimeout(kickTimer);
  kickTimer = setTimeout(() => {
    if (ps.id !== id || ps.st === 1 || ps.st === 3 || ps.userPaused || ps.error || document.visibilityState === 'hidden') return;
    try { player?.playVideo(); } catch (_) { /* 準備中 */ }
    kickTimer = setTimeout(() => {
      if (ps.id !== id || ps.st === 1 || ps.st === 3 || ps.userPaused || ps.error || document.visibilityState === 'hidden') return;
      setPs({ pass: true, autoPass: true });
    }, 2000);
  }, 2500);
}

export function setMode(mode) {
  if (mode === ps.mode) return;
  if (mode !== 'full' && ps.fs) exitFs();
  setPs({ mode });
}

export function close() {
  saveNow(true);
  clearNext();
  clearTimeout(kickTimer);
  want = null;
  try { player?.stopVideo(); } catch (_) { /* 何もしない */ }
  if (ps.fs) exitFs();
  setPs({ id: '', mode: 'none', st: -1, time: 0, dur: 0, error: '', upNext: null });
}

export function togglePlay() {
  if (!player) return;
  if (ps.upNext) clearNext();
  try {
    if (ps.st === 1 || ps.st === 3) {
      setPs({ userPaused: true });
      player.pauseVideo();
    } else {
      setPs({ userPaused: false });
      player.playVideo();
      kick(ps.id);
    }
  } catch (_) { /* 準備中 */ }
}
export function seekTo(sec) {
  if (!player) return;
  const d = ps.dur || player.getDuration?.() || 0;
  const t = Math.max(0, d ? Math.min(sec, d - 0.5) : sec);
  if (ps.upNext) clearNext();
  try {
    player.seekTo(t, true);
    // 本編が始まる前に飛んだときは、飛んだ先を「流し始めた位置」にする(広告スキップのボタンを正しく消すため)
    setPs(ps.contentStarted ? { time: t } : { time: t, loadedStart: t });
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
  if (ps.mode === 'mini' && !ps.fs) {
    load(q[i - 1], { keepMini: true });
    ensureDetail(q[i - 1]);
  } else location.hash = `#/w/${q[i - 1]}`;
}
let passTimer = 0;
let adPassActive = false; // 「広告をスキップ」で直接さわる状態にしている
let adTimer = 0;
// autoMs: その時間がたったら操作ボタンに自動で戻す(広告のスキップ用)
export function setPass(on, autoMs = 0, forAd = false) {
  clearTimeout(passTimer);
  adPassActive = !!(on && forAd);
  setPs({ pass: on, manualPass: on });
  if (on && autoMs) {
    passTimer = setTimeout(() => {
      if (ps.pass && ps.manualPass) setPs({ pass: false, manualPass: false });
    }, autoMs);
  }
}
// 読み込み前でも、流れ始めたらその位置へ飛ぶ
let pendingSeek = null;
function curVid() {
  try {
    return player?.getVideoData?.()?.video_id || '';
  } catch (_) {
    return '';
  }
}
export function seekWhenReady(id, sec) {
  if (ps.id === id && player && [0, 1, 2, 3].includes(ps.st) && curVid() === id) return seekTo(sec);
  pendingSeek = { id, sec };
}

// ------------------------------------------------------------------ 全画面
let fsTipShown = false;
export function enterFs(fromRotate = false) {
  setPs({ fs: true });
  const el = document.documentElement;
  const can = !!el.requestFullscreen && !fromRotate;
  try {
    const p = can ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
    p?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch (_) { /* iPhone は画面いっぱいの表示だけ */ }
  // 縦のまま回したとき、初めの1回だけ「向きのロックを外すと本当の横画面になる」と案内する
  try {
    if (fsRotated() && !localStorage.getItem('tsuzuki:rotTip')) {
      localStorage.setItem('tsuzuki:rotTip', '1');
      setTimeout(() => toast('コントロールセンターの「画面の向きのロック」をオフにすると、時計の帯も消えた本当の横画面になります', 5000), 400);
    }
  } catch (_) { /* 何もしない */ }
  // iPhone の Chrome・Brave は、ページから上のバーを消せない(Apple の決まり)。ホーム画面のアイコンからなら消える
  if (IOS && !STANDALONE && !el.requestFullscreen && !fsTipShown) {
    fsTipShown = true;
    toast('上のバーを消すには、ホーム画面のアイコンから開いてください(iPhone のブラウザでは消せません)', 4200);
  }
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
// スマホを横にしたら全画面、縦に戻したら元に戻す(YouTube アプリと同じ)
try {
  const mq = matchMedia('(orientation: landscape)');
  mq.addEventListener('change', () => {
    if (!PHONE || !ps.id || ps.mode !== 'full') return;
    if (mq.matches && !ps.fs) enterFs(true);
    else if (!mq.matches && ps.fs && !document.fullscreenElement) exitFs();
  });
} catch (_) { /* 古いブラウザ */ }
// 全画面で、画面の向きが縦に固定されているときは、動画だけ横に回して出す(YouTube アプリと同じ)
export function fsRotated() {
  return ps.fs && PHONE && innerHeight > innerWidth;
}
// 回す向きを反対に(スマホを右に倒したか左に倒したかに合わせる)
export function flipRot() {
  const rev = !ps.rotRev;
  try { localStorage.setItem('tsuzuki:rotDir', rev ? '-90' : '90'); } catch (_) { /* 何もしない */ }
  setPs({ rotRev: rev });
}

// ------------------------------------------------------------------ おやすみタイマー
// 寝落ちしても朝まで流れ続けないように、決めた時間で再生を止める。画面は止めたあと iPhone の自動ロックで消える
// (アプリから電源や画面を消すことはできない)。止まったとき、止まった位置と「最後に画面をさわった位置」を覚えておき、
// その動画を開き直したときに「どこまで見ていたか」を選べるようにする。
const SLEEP_KEY = 'tsuzuki:sleep';
let sleepTimer = 0;
let autoGuard = 0;
let lastTouch = { id: '', pos: 0, at: 0 };
let autoOffFor = ''; // 自分で「オフ」にした動画には、自動のタイマーを入れ直さない
let sleepHoldUntil = 0; // タイマーで止めた直後のしばらくは、勝手に流れ出したら止め直す
for (const ev of ['pointerdown', 'keydown']) {
  addEventListener(ev, () => { sleepHoldUntil = 0; }, { capture: true, passive: true });
}
function noteTouch() {
  if (ps.id) lastTouch = { id: ps.id, pos: ps.time || 0, at: Date.now() };
}
for (const ev of ['pointerdown', 'keydown']) {
  addEventListener(ev, () => { if ((ps.sleepAt || ps.sleepEnd) && ps.id) noteTouch(); }, { capture: true, passive: true });
}
// min: 0 = やめる / 'end' = この動画が終わるまで / 数字 = 分
export function setSleep(min, auto = false) {
  clearInterval(sleepTimer);
  if (!min) {
    if (!auto) autoOffFor = ps.id || '';
    setPs({ sleepAt: 0, sleepLeft: 0, sleepEnd: false, sleepMin: 0, sleepWarn: false });
    return;
  }
  noteTouch();
  if (ps.sleepWarn) setPs({ sleepWarn: false });
  if (min === 'end') {
    setPs({ sleepAt: 0, sleepLeft: 0, sleepEnd: true, sleepMin: 'end' });
    toast('この動画が終わったら止めます', 2200);
    return;
  }
  setPs({ sleepAt: Date.now() + min * 60e3, sleepLeft: Math.max(1, Math.ceil(min)), sleepEnd: false, sleepMin: min });
  sleepTimer = setInterval(sleepTick, 1000);
  toast(`${min}分後に再生を止めます`, 2200);
}
function sleepTick() {
  if (!ps.sleepAt) {
    clearInterval(sleepTimer);
    return;
  }
  const rest = ps.sleepAt - Date.now();
  if (rest <= 0) return sleepStop();
  if (rest < 60e3 && !ps.sleepWarn) {
    setPs({ sleepWarn: true });
    toast('まもなく止まります。続けて見るなら、動画の「+15分」を押してください', 4000);
  }
  const left = Math.max(1, Math.ceil(rest / 60e3));
  if (left !== ps.sleepLeft) setPs({ sleepLeft: left });
}
// 止まった位置と「最後に画面をさわった位置」を覚え、開いている再生画面に「どこまで見たか」のカードを出す
function writeSleep(pos) {
  const id = ps.id;
  if (!id || ps.mode === 'short') return;
  const t = lastTouch.id === id ? lastTouch : null;
  // 自動で次の動画へ進んでから止まったときは、最後にさわった「前の動画」の位置も残す
  const other = lastTouch.id && lastTouch.id !== id
    ? { touchId: lastTouch.id, touchPos: Math.round(lastTouch.pos), touchTitle: videoInfo(lastTouch.id).title || '' }
    : {};
  lsSetJson(SLEEP_KEY, { id, stop: Math.round(pos), touch: t ? Math.round(t.pos) : null, touchAt: t ? t.at : lastTouch.at || 0, at: Date.now(), ...other });
  dispatchEvent(new Event('tz:sleep'));
}
function sleepStop() {
  clearInterval(sleepTimer);
  clearNext(); // 次の動画への待ちの最中でも、ここで止める
  clearTimeout(kickTimer);
  sleepHoldUntil = Date.now() + 20e3;
  let pos = ps.time || 0;
  try { pos = player?.getCurrentTime?.() || pos; } catch (_) { /* 準備中 */ }
  setPs({ userPaused: true, sleepAt: 0, sleepLeft: 0, sleepEnd: false, sleepMin: 0, sleepWarn: false });
  try { player?.pauseVideo(); } catch (_) { /* 準備中 */ }
  saveNow(true);
  writeSleep(pos);
  if (ps.fs) exitFs();
  toast('おやすみなさい。再生を止めました', 4500);
}
// 設定の「再生を始めたら自動でタイマーを入れる」(夜だけ、にもできる)
function autoSleep() {
  const pr = appState().prefs;
  const m = Number(pr.sleepAuto) || 0;
  if (!m || Date.now() - autoGuard < 120e3 || ps.mode === 'short' || (autoOffFor && autoOffFor === ps.id)) return;
  if (pr.sleepNight !== false) {
    const h = new Date().getHours();
    if (!(h >= 22 || h < 5)) return;
  }
  autoGuard = Date.now();
  setSleep(m, true);
}
document.addEventListener('visibilitychange', () => {
  // 画面が戻ったとき、切れる時刻をとっくに過ぎていたらすぐ止める
  if (document.visibilityState === 'visible' && ps.sleepAt && Date.now() >= ps.sleepAt) sleepStop();
});

// ------------------------------------------------------------------ ロック画面・コントロールセンターの表示と操作
export function mediaMeta() {
  const ms = navigator.mediaSession;
  if (!ms || !ps.id) return;
  try {
    const info = videoInfo(ps.id);
    let vd = null;
    try { vd = player?.getVideoData?.(); } catch (_) { /* 準備中 */ }
    const ok = vd && vd.video_id === ps.id;
    const vt = info.title || (ok && vd.title) || 'つづきから';
    const chap = chaptersOf(ps.id)[ps.chapIdx];
    ms.metadata = new MediaMetadata({
      title: chap ? chap.title : vt,
      artist: chap ? vt : info.cht || (ok && vd.author) || '',
      album: 'つづきから',
      artwork: [
        { src: `https://i.ytimg.com/vi/${ps.id}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
        { src: `https://i.ytimg.com/vi/${ps.id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
      ],
    });
  } catch (_) { /* 対応していない */ }
}
function mediaState() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  try {
    ms.playbackState = ps.st === 1 || ps.st === 3 ? 'playing' : ps.id ? 'paused' : 'none';
  } catch (_) { /* 対応していない */ }
}
(() => {
  const ms = navigator.mediaSession;
  if (!ms) return;
  const h = (a, f) => {
    try { ms.setActionHandler(a, f); } catch (_) { /* その操作は無い */ }
  };
  h('play', () => { sleepHoldUntil = 0; setPs({ userPaused: false }); try { player?.playVideo(); } catch (_) {} });
  h('pause', () => { setPs({ userPaused: true }); try { player?.pauseVideo(); } catch (_) {} });
  // チャプター(曲目)のある動画では、前/次はチャプターを移る
  h('previoustrack', () => {
    if (ps.mode === 'short') return;
    const ch = chaptersOf(ps.id);
    if (ch.length && ps.chapIdx >= 0) {
      const c = ch[ps.chapIdx];
      if (ps.chapIdx === 0 && (ps.time || 0) - c.sec <= 3) return playPrev(); // 最初の曲の頭なら、前の動画へ
      return seekTo((ps.time || 0) - c.sec > 3 || ps.chapIdx === 0 ? c.sec : ch[ps.chapIdx - 1].sec);
    }
    playPrev();
  });
  h('nexttrack', () => {
    if (ps.mode === 'short') return;
    const ch = chaptersOf(ps.id);
    if (ch.length && ps.chapIdx + 1 < ch.length) return seekTo(ch[ps.chapIdx + 1].sec);
    if (nextCandidate()) playNext();
  });
  h('seekbackward', () => seekBy(-10));
  h('seekforward', () => seekBy(10));
})();

// ------------------------------------------------------------------ 再生キュー(次に流す順番)
const userQueued = new Set(); // 自分で「次に再生」「キューに追加」した動画
// キューは端末に保存(アプリが閉じられても戻る。12時間まで)
const QKEY = 'tsuzuki:queue';
function saveQueue() {
  try {
    lsSetJson(QKEY, { id: ps.id, queue: (ps.queue || []).slice(0, 200), user: [...userQueued], at: Date.now() });
  } catch (_) { /* 何もしない */ }
}
let restoredId = ''; // 起動時に戻したキューで、前回流していた動画
(() => {
  const s = lsGetJson(QKEY, null);
  if (s && Array.isArray(s.queue) && Date.now() - (s.at || 0) < 12 * 3600e3) {
    ps = { ...ps, queue: s.queue };
    restoredId = s.id || '';
    for (const u of s.user || []) userQueued.add(u);
  }
})();
// 次の動画への待ちの最中に並びを変えたら、待っている動画を決め直す
function refreshNext() {
  saveQueue();
  if (!ps.upNext) return;
  const id = nextCandidate();
  if (!id) clearNext();
  else if (id !== ps.upNext.id) scheduleNext();
}
function baseQueue() {
  const q = (ps.queue || []).slice();
  if (ps.id && q.indexOf(ps.id) < 0) q.unshift(ps.id);
  return q;
}
// 戻り値: 'play'(何も流れていないので、すぐ流した) / 'same' / 'next' / 'add'
export function queueNext(id) {
  if (!ps.id || ps.mode === 'short') {
    location.hash = `#/w/${id}`;
    return 'play';
  }
  if (id === ps.id) return 'same';
  const q = baseQueue().filter((x) => x !== id);
  q.splice(q.indexOf(ps.id) + 1, 0, id);
  userQueued.add(id);
  setPs({ queue: q });
  refreshNext();
  return 'next';
}
export function queueAdd(id) {
  if (!ps.id || ps.mode === 'short') {
    location.hash = `#/w/${id}`;
    return 'play';
  }
  if (id === ps.id) return 'same';
  const q = baseQueue().filter((x) => x !== id);
  // 自分で入れた動画の並びの最後(一覧から来た続きより前)に入れる
  let at = q.indexOf(ps.id) + 1;
  while (at < q.length && userQueued.has(q[at])) at++;
  q.splice(at, 0, id);
  userQueued.add(id);
  setPs({ queue: q });
  refreshNext();
  return 'add';
}
export function queueMove(id, d) {
  const q = baseQueue();
  const i = q.indexOf(id);
  const j = i + d;
  const cur = q.indexOf(ps.id);
  if (i < 0 || j <= cur || j >= q.length) return;
  [q[i], q[j]] = [q[j], q[i]];
  userQueued.add(id); // 自分で並べた動画は、見終わっていても流す
  setPs({ queue: q });
  refreshNext();
}
// つまんで動かした先へ: pos は「いま流している動画の何本あとか」(1 = 次)
export function queueMoveTo(id, pos) {
  const q = baseQueue().filter((x) => x !== id);
  const cur = q.indexOf(ps.id);
  const at = Math.min(q.length, Math.max(cur + 1, cur + pos));
  q.splice(at, 0, id);
  userQueued.add(id);
  setPs({ queue: q });
  refreshNext();
}
// 「外す」を元に戻す
export function queueRestore(q, user) {
  userQueued.clear();
  for (const u of user || []) userQueued.add(u);
  setPs({ queue: q });
  refreshNext();
}
export const queueSnapshot = () => ({ q: (ps.queue || []).slice(), user: [...userQueued] });
export function queueRemove(id) {
  if (id === ps.id) return;
  userQueued.delete(id);
  setPs({ queue: baseQueue().filter((x) => x !== id) });
  refreshNext();
}
export function queueClear() {
  userQueued.clear();
  setPs({ queue: ps.id ? [ps.id] : [] });
  refreshNext();
}
export function queueShuffle() {
  const q = baseQueue();
  const cur = q.indexOf(ps.id);
  const rest = q.slice(cur + 1);
  for (let k = rest.length - 1; k > 0; k--) {
    const r = Math.floor(Math.random() * (k + 1));
    [rest[k], rest[r]] = [rest[r], rest[k]];
  }
  setPs({ queue: [...q.slice(0, cur + 1), ...rest] });
  refreshNext();
}
export const isUserQueued = (id) => userQueued.has(id);

// ------------------------------------------------------------------ 次の動画
let nextTimer = 0;
function clearNext() {
  clearTimeout(nextTimer);
  if (ps.upNext) setPs({ upNext: null });
}
// 次に流す動画と、どこから来たか('user' 自分で並べた・リピート / 'list' 一覧の続き / 'related' 関連動画)
export function nextInfo() {
  const q = ps.queue || [];
  const i = q.indexOf(ps.id);
  const pr = appState().prefs;
  const prog = appState().progress;
  if (i >= 0) {
    // キュー全体のリピート: 見終わっていても順に回る
    if (pr.repeat === 'all' && q.length > 1) {
      for (let k = 1; k < q.length; k++) {
        const c = q[(i + k) % q.length];
        if (c !== ps.id && !noEmbed.has(c)) return { id: c, from: 'user' };
      }
    }
    // 自分でキューに入れた動画は、見たことがあっても流す。一覧から来た動画は、見終わったものを飛ばす
    for (let k = i + 1; k < q.length; k++) {
      const c = q[k];
      if (userQueued.has(c)) return { id: c, from: 'user' }; // 自分で入れた動画は一度は試す
      if (noEmbed.has(c)) continue;
      if (!prog[c]?.done) return { id: c, from: 'list' };
    }
  }
  const rel = videoDetail(ps.id)?.related || [];
  const r = rel.find((v) => !prog[v.id]?.done && !v.live && !noEmbed.has(v.id)) || rel.find((v) => !noEmbed.has(v.id));
  return r ? { id: r.id, from: 'related' } : { id: '', from: '' };
}
export function nextCandidate() {
  return nextInfo().id;
}
function scheduleNext() {
  const n = nextInfo();
  if (!n.id) return;
  // 自動再生がオフでも、自分で並べたキューは続けて流す
  if (n.from !== 'user' && !appState().prefs.autoNext) return;
  // 自分で並べた曲の間・リピート・小さい窓・画面を見ていないときは、待ちを短く(曲間を空けない)
  const quick = n.from === 'user' || ps.mode === 'mini' || document.visibilityState === 'hidden';
  const ms = quick ? 1200 : 6000;
  setPs({ upNext: { id: n.id, ms } });
  clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    if (ps.upNext?.id === n.id) playNext();
  }, ms);
}
// 小さい窓で次の動画へ進んだときは、再生画面を通らないので、関連動画などをここで取っておく
function ensureDetail(id) {
  if (!id || videoDetail(id)) return;
  fn('video', { id })
    .then((d) => {
      rememberDetail(id, d);
      rememberHits(d.related);
      if (ps.id === id) mediaMeta();
    })
    .catch(() => {});
}
let autoNextPending = ''; // 自動で次へ進めようとしている動画
let autoCame = false; // いまの動画は、自動で次へ進んで来た
export function playNext() {
  const id = ps.upNext?.id || nextCandidate();
  clearNext();
  if (!id) return;
  autoNextPending = id;
  if (ps.mode === 'mini' && !ps.fs) {
    load(id, { keepMini: true });
    ensureDetail(id);
  } else location.hash = `#/w/${id}`;
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
  drag: 'M3 15h18v-2H3v2zm0 4h18v-2H3v2zm0-8h18V9H3v2zm0-6v2h18V5H3z',
  moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  repeatOne: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
  shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  queue: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
  playNext: 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z',
  up: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
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
  const fs = usePlayer((p) => p.fs);
  const sleepLeft = usePlayer((p) => p.sleepLeft);
  const sleepEnd = usePlayer((p) => p.sleepEnd);
  const sleepMin = usePlayer((p) => p.sleepMin);
  const rev = usePlayer((p) => p.rotRev);
  const repeat = useSyncExternalStore(subscribeApp, () => appState().prefs.repeat || 'off');
  const chapIdx = usePlayer((p) => p.chapIdx);
  if (!page) return null;
  const done = () => setPage(null);
  return html`<div class=${clsx('sheet-bg pl-sheet', fs && fsRotated() && 'rot', rev && 'rev')} onClick=${done}>
    <div class="sheet" onClick=${(e) => e.stopPropagation()}>
      <div class="sheet-grip"></div>
      ${page === 'main' && html`
        <button class="sheet-i" onClick=${() => setPage('rate')}><${Icon} d=${IC.speed} /><span>再生速度</span><span class="sp"></span><span class="sheet-v">${(rate || 1) === 1 ? '標準' : (rate || 1) + 'x'}</span></button>
        <button class="sheet-i" onClick=${() => { setPref('autoNext', !autoNext); done(); }}><${Icon} d=${IC.autoplay} /><span>自動再生</span><span class="sp"></span><span class="sheet-v">${autoNext ? 'オン' : 'オフ'}</span></button>
        <button class="sheet-i" onClick=${() => { const n = { off: 'all', all: 'one', one: 'off' }[repeat] || 'all'; setPref('repeat', n); }}><${Icon} d=${repeat === 'one' ? IC.repeatOne : IC.repeat} /><span>リピート</span><span class="sp"></span><span class="sheet-v">${{ off: 'オフ', all: 'キュー全体', one: 'この動画' }[repeat] || 'オフ'}</span></button>
        <button class="sheet-i" onClick=${() => setPage('sleep')}><${Icon} d=${IC.moon} /><span>おやすみタイマー</span><span class="sp"></span><span class="sheet-v">${sleepLeft ? `あと${sleepLeft}分` : sleepEnd ? '動画の終わりまで' : 'オフ'}</span></button>
        <button class="sheet-i" onClick=${() => { restart(); done(); }}><${Icon} d=${IC.restart} /><span>最初から再生</span></button>
        <div class="sheet-i dim"><${Icon} d=${IC.cc} /><span>字幕</span><span class="sp"></span><span class="sheet-v">オフ(いつも)</span></div>
        <button class="sheet-i" onClick=${() => { setPass(true); done(); }}><${Icon} d=${IC.hand} /><span>YouTube の画面を直接さわる<small>広告の「スキップ」を押すときなど</small></span></button>
        <a class="sheet-i" href=${watchUrl(id, time)} target="_blank" rel="noopener" onClick=${() => { try { player?.pauseVideo(); } catch (_) {} done(); }}><${Icon} d=${IC.open} /><span>YouTube で開く(いまの位置から)</span></a>
      `}
      ${page === 'chap' && html`
        <div class="sheet-head"><button class="ib sm" onClick=${done} aria-label="閉じる"><${Icon} d=${IC.close} /></button><b>チャプター</b></div>
        ${chaptersOf(id).map((c, k) => html`<button key=${k} class=${clsx('sheet-i rate', k === chapIdx && 'sel')} onClick=${() => { seekTo(c.sec); done(); }}>
          <span class="chk">${k === chapIdx ? '✓' : ''}</span><span class="chap-t">${fmtTime(c.sec)}</span><span>${c.title}</span></button>`)}
      `}
      ${page === 'sleep' && html`
        <div class="sheet-head"><button class="ib sm" onClick=${() => setPage('main')} aria-label="戻る"><${Icon} d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></button><b>おやすみタイマー</b></div>
        ${[[0, 'オフ'], [15, '15 分'], [30, '30 分'], [45, '45 分'], [60, '60 分'], [90, '90 分'], ['end', 'この動画が終わるまで']].map(([m, label]) => html`<button key=${m} class=${clsx('sheet-i rate', m === (sleepMin || 0) && 'sel')} onClick=${() => { setSleep(m); done(); }}>
          <span class="chk">${m === (sleepMin || 0) ? '✓' : ''}</span><span>${label}</span></button>`)}
        <div class="sheet-i dim"><span>時間になると再生を止めます。画面は、iPhone の自動ロックで消えます。</span></div>
      `}
      ${page === 'rate' && html`
        <div class="sheet-head"><button class="ib sm" onClick=${() => setPage('main')} aria-label="戻る"><${Icon} d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></button><b>再生速度</b></div>
        ${RATES.map((r) => html`<button key=${r} class=${clsx('sheet-i rate', r === (rate || 1) && 'sel')} onClick=${() => { setRate(r); setPref('rate', r); done(); }}>
          <span class="chk">${r === (rate || 1) ? '✓' : ''}</span><span>${r === 1 ? '標準' : r + 'x'}</span></button>`)}
      `}
    </div>
  </div>`;
}

// 引いた指を離したあと: 小さくするなら小さい窓のあたりへ吸いこまれてから小窓へ。そうでなければ元の位置へすっと戻す
let settling = false;
let settleTimer = 0;
function clearDrag() {
  const root = document.documentElement;
  root.classList.remove('wdrag', 'wdrag-anim');
  root.style.removeProperty('--wdrag');
  root.style.removeProperty('--wdragp');
}
function dragSettle(down) {
  const root = document.documentElement;
  clearTimeout(settleTimer);
  settling = true;
  root.classList.add('wdrag-anim');
  if (down) {
    let target = innerHeight * 0.6;
    try {
      const tabs = document.querySelector('.tabs');
      const ph = document.querySelector('.ph.full');
      const cur = parseFloat(root.style.getPropertyValue('--wdrag')) || 0;
      if (tabs && ph) target = tabs.getBoundingClientRect().top - 64 - (ph.getBoundingClientRect().top - cur);
    } catch (_) { /* 何もしない */ }
    root.style.setProperty('--wdrag', Math.max(0, Math.round(target)) + 'px');
    root.style.setProperty('--wdragp', '1');
    settleTimer = setTimeout(() => {
      leaveWatch();
      // 小窓に切りかわってから片づける(先に片づけると、一瞬もとの位置・大きさに戻って見える)
      let n = 0;
      let doneOnce = false;
      const finish = () => {
        if (doneOnce) return;
        doneOnce = true;
        settling = false;
        clearDrag();
      };
      const wait = () => {
        if (getPs().mode !== 'full' || ++n > 40) requestAnimationFrame(finish);
        else requestAnimationFrame(wait);
      };
      requestAnimationFrame(wait);
      settleTimer = setTimeout(finish, 700); // 画面の描き直しが止まっているとき(裏に回ったなど)の保険
    }, 220);
  } else {
    root.style.setProperty('--wdrag', '0px');
    root.style.setProperty('--wdragp', '0');
    settleTimer = setTimeout(() => { settling = false; clearDrag(); }, 220);
  }
}

function Controls() {
  const st = usePlayer((p) => p.st);
  const time = usePlayer((p) => p.time);
  const dur = usePlayer((p) => p.dur);
  const fs = usePlayer((p) => p.fs);
  const pass = usePlayer((p) => p.pass);
  const started = usePlayer((p) => p.started);
  const autoPass = usePlayer((p) => p.autoPass);
  const err = usePlayer((p) => p.error);
  const id = usePlayer((p) => p.id);
  const live = usePlayer((p) => p.live);
  const buffering = usePlayer((p) => p.buffering);
  const upNext = usePlayer((p) => p.upNext);
  const sleepLeft = usePlayer((p) => p.sleepLeft);
  const sleepEnd = usePlayer((p) => p.sleepEnd);
  const loadedAt = usePlayer((p) => p.loadedAt);
  const contentStarted = usePlayer((p) => p.contentStarted);
  const adOver = usePlayer((p) => p.adOver);
  const chapIdx = usePlayer((p) => p.chapIdx);
  const sleepWarn = usePlayer((p) => p.sleepWarn);
  const rotRev = usePlayer((p) => p.rotRev);
  const autoNext = useSyncExternalStore(subscribeApp, () => appState().prefs.autoNext);
  const [show, setShow] = useState(true);
  const [armed, setArmed] = useState(true); // 出した直後の一瞬はボタンを押せなくする(ダブルタップの2回目がボタンに当たらないように)
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
  // 画面に対する指の位置を、動画の向きでの位置に直す(全画面で横に回しているとき)
  const local = (e) => (fsRotated() ? (getPs().rotRev ? { x: -e.clientY, y: e.clientX } : { x: e.clientY, y: -e.clientX }) : { x: e.clientX, y: e.clientY });
  // 画面を離れる・切りかわるとき、途中の指の動きを片づける
  useEffect(() => () => {
    const s = g.current;
    if (s && s.x != null) {
      clearTimeout(s.lt);
      if (s.long) setRate(s.prevRate);
    }
    if (!settling) clearDrag();
  }, []);
  const onDown = (e) => {
    if (settling || e.target.closest('button, input, a, .pc-err, .pc-next')) return;
    const l = local(e);
    const s = { x: l.x, y: l.y, moved: false, drag: false, long: false, dy: 0 };
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
    const l = local(e);
    const dx = l.x - s.x;
    const dy = l.y - s.y;
    if (!s.moved && Math.hypot(dx, dy) > 10) {
      s.moved = true;
      clearTimeout(s.lt);
      if (!s.long && Math.abs(dy) > Math.abs(dx)) s.drag = true;
    }
    if (s.drag) {
      // 指の速さも見る(さっとはらったら、短くても小さくする)
      const now = performance.now();
      if (s.pt) s.vy = (dy - s.pdy) / Math.max(1, now - s.pt);
      s.pt = now;
      s.pdy = dy;
      s.dy = dy;
      if (!getPs().fs) {
        const root = document.documentElement;
        root.classList.remove('wdrag-anim');
        root.classList.add('wdrag');
        // 引いた分だけついてくる。上へは少しだけ(引っぱりすぎない)
        const y = dy > 0 ? dy : dy / 4;
        root.style.setProperty('--wdrag', y + 'px');
        root.style.setProperty('--wdragp', String(Math.min(1, Math.max(0, dy) / 420)));
      }
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
      const fsNow = getPs().fs;
      const fling = (s.vy || 0) > 0.55; // さっと下へはらった
      const down = !cancel && !fsNow && (s.dy > 70 || (fling && s.dy > 24));
      dragSettle(down);
      if (cancel) return;
      if (down) return;
      if (!fsNow && s.dy < -50) enterFs();
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
    const x = fsRotated() ? (getPs().rotRev ? (rect.bottom - e.clientY) : (e.clientY - rect.top)) / rect.height : (e.clientX - rect.left) / rect.width;
    const now = Date.now();
    const tr = tapRef.current;
    const side = x < 0.4 ? 'l' : x > 0.6 ? 'r' : '';
    const doSeek = () => {
      seekBy(side === 'l' ? -10 : 10);
      setShow(false);
      clearTimeout(hideRef.current);
      tr.rip = { side, k: now, n: tr.rip && tr.rip.side === side && now - tr.rip.k < 900 ? tr.rip.n + 10 : 10 };
      setRipple(tr.rip);
      setTimeout(() => setRipple((r) => (r?.k === now ? null : r)), 800);
    };
    // 早送りの波紋が出ている間は、同じ側を1回たたくごとに10秒ずつ(YouTube と同じ)
    if (side && tr.rip && tr.rip.side === side && now - tr.rip.k < 900) {
      tr.t = 0;
      return doSeek();
    }
    if (now - tr.t < 300 && Math.abs(x - tr.x) < 0.25) {
      tr.t = 0;
      clearTimeout(tr.armT);
      setArmed(true);
      if (side) {
        if (tr.toggled) setShow(tr.prevShow); // 1回目で切りかえた表示を元に戻してから
        doSeek();
      }
      return;
    }
    tr.t = now;
    tr.x = x;
    // 操作ボタンの出し入れは、待たずにすぐ(2回目が来たら元に戻す)
    tr.prevShow = show;
    tr.toggled = true;
    clearTimeout(tr.armT);
    if (show) {
      setArmed(true);
      setShow(false);
      clearTimeout(hideRef.current);
    } else {
      setArmed(false);
      tr.armT = setTimeout(() => setArmed(true), 320);
      poke();
    }
  };

  if (pass) {
    return html`<div class="pc-pass">
      ${(!started || autoPass) && !err
        ? html`<div class="pc-hint">動画の ▶ を直接押して再生</div>`
        : html`<button class="pc-chip pc-back" onClick=${() => setPass(false)}>操作ボタンに戻す</button>`}
      ${fs && html`<button class="pc-chip pc-fsx" onClick=${exitFs}>全画面をやめる</button>`}
    </div>`;
  }

  const shown = drag != null ? drag : time;
  const pct = dur ? Math.min(100, (shown / dur) * 100) : 0;
  const nextInfo = upNext ? videoInfo(upNext.id) : null;
  const hasNext = !!nextCandidate();

  return html`<div class=${clsx('pc', show && 'on', !armed && 'unarmed')} onClick=${onTap}
      onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${(e) => onUp(e, false)} onPointerCancel=${(e) => onUp(e, true)}>
    ${ripple && html`<div class=${'pc-ripple ' + ripple.side} key=${ripple.side + ripple.n}>
      <div class="pc-rip-in"><${Icon} d=${ripple.side === 'l' ? IC.rw : IC.ff} size=${26} /><span>${ripple.n} 秒</span></div>
    </div>`}
    ${boost && html`<div class="pc-boost">2x <${Icon} d=${IC.ff} size=${16} /></div>`}
    ${buffering && !show && html`<div class="pc-spin"></div>`}
    ${err &&
    html`<div class="pc-err" onClick=${(e) => e.stopPropagation()}>
      <p>${err}</p>
      ${upNext && html`<p class="pc-err-next">まもなく次の動画へ進みます</p>`}
      <div class="row">
        <a class="btn" href=${watchUrl(id, resumePoint(id))} target="_blank" rel="noopener" onClick=${cancelNext}>YouTubeで開く</a>
        ${upNext ? html`<button class="btn ghost" onClick=${cancelNext}>キャンセル</button>` : hasNext && html`<button class="btn ghost" onClick=${() => playNext()}>次の動画へ</button>`}
      </div>
    </div>`}
    ${nextInfo && !err &&
    html`<div class="pc-next" onClick=${(e) => e.stopPropagation()}>
      <img class="pc-next-th" src=${`https://i.ytimg.com/vi/${upNext.id}/mqdefault.jpg`} alt="" />
      <div class="pc-next-t">次の動画</div>
      <div class="pc-next-title">${nextInfo.title || '次の動画'}</div>
      <div class="row">
        <button class="btn ghost" onClick=${cancelNext}>キャンセル</button>
        <button class="btn" onClick=${playNext}>今すぐ再生</button>
      </div>
      <div class="pc-next-bar" key=${upNext.id} style=${{ animationDuration: upNext.ms + 'ms' }}></div>
    </div>`}
    <div class="pc-shade"></div>
    ${!live && !contentStarted && !adOver && st !== 2 && html`<button class="pc-chip pc-adskip" onClick=${() => { setPass(true, 15000, true); toast('YouTube の画面を直接さわれます。広告の「スキップ」を押してください(本編が始まると自動で戻ります)', 3500); }}>広告をスキップ</button>`}
    ${sleepWarn && html`<button class="pc-chip pc-sleepwarn" onClick=${() => { setSleep(15); }}><${Icon} d=${IC.moon} size=${14} />まもなく止まります ・ +15分</button>`}
    ${drag != null && html`<div class="pc-seektip">${fmtTime(drag)} <span>/ ${fmtTime(dur)}</span></div>`}
    <div class="pc-top">
      ${fs
        ? html`<button class="pc-ib" aria-label="全画面をやめる" onClick=${exitFs}><${Icon} d=${IC.down} size=${28} /></button><div class="pc-title">${videoInfo(id).title}</div>`
        : html`<button class="pc-ib" aria-label="小さくする" onClick=${leaveWatch}><${Icon} d=${IC.down} size=${30} /></button>`}
      <span class="sp"></span>
      ${fs && fsRotated() && html`<button class="pc-ib" aria-label="向きを反対に" onClick=${() => { flipRot(); poke(); }}><${Icon} d=${IC.restart} size=${22} /></button>`}
      ${(sleepLeft > 0 || sleepEnd) && html`<button class="pc-sleep" aria-label="おやすみタイマー" onClick=${() => settingsOpen?.('sleep')}><${Icon} d=${IC.moon} size=${14} /><span>${sleepEnd ? '終わりまで' : `あと${sleepLeft}分`}</span></button>`}
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
      ${chapIdx >= 0 && chaptersOf(id)[chapIdx] && html`<button class="pc-chap" onClick=${() => settingsOpen?.('chap')}>・${chaptersOf(id)[chapIdx].title} ›</button>`}
      <span class="sp"></span>
      <button class="pc-ib" aria-label=${fs ? '全画面をやめる' : '全画面'} onClick=${() => (fs ? exitFs() : enterFs())}><${Icon} d=${fs ? IC.fsExit : IC.fs} /></button>
    </div>
    ${!live &&
    html`<div class=${clsx('pc-seek', drag != null && 'drag')} style=${{ '--p': pct + '%' }}>
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
    <button class=${clsx('pc-ib dark', !nextCandidate() && 'off')} aria-label="次の動画" onClick=${() => { if (nextCandidate()) playNext(); }}><${Icon} d=${IC.next} size=${24} /></button>
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
  const [, setVp] = useState(0);
  const mg = useRef({});
  useEffect(() => {
    const f = () => setVp((x) => x + 1);
    addEventListener('resize', f);
    return () => removeEventListener('resize', f);
  }, []);
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
  // 回した全画面のときは、お知らせも回して出す(CSS の body.fs-rot)
  const rot = fs && fsRotated();
  const rev = usePlayer((p) => p.rotRev);
  useEffect(() => {
    document.body.classList.toggle('fs-rot', !!rot);
    document.body.classList.toggle('fs-rot-rev', !!rot && !!rev);
  }, [rot, rev]);
  useEffect(() => {
    const r = document.body.dataset.route;
    setThemeBlack(fs || r === 'watch' || r === 'shorts');
  }, [fs]);
  // 小さい窓 → 再生画面 のときだけ、下からせり上がる
  useEffect(() => {
    if (mode !== 'full' && !settling) clearDrag();
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
    <div class=${clsx('ph', fs ? 'fs' : mode, enter && 'enter', fs && fsRotated() && 'rot', fs && fsRotated() && rev && 'rev')} aria-hidden=${mode === 'none' ? 'true' : 'false'}
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
