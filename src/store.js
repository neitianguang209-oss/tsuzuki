// アプリ全体の状態。端末に控えを持ち、クラウドが落ちていても前回の内容で開ける
import { useSyncExternalStore, useRef } from 'react';
import { rpc, fn, getKey } from './api.js';
import { lsGetJson, lsSetJson } from './util.js';

const CACHE = 'tsuzuki:cache';
const PROG = 'tsuzuki:prog';
const DIRTY = 'tsuzuki:dirty';
const PREFS = 'tsuzuki:prefs';

const DEFAULT_PREFS = { shorts: true, autoNext: true, rate: 1, morningHour: 6, hideWatched: false };

const cache = lsGetJson(CACHE, null);
let state = {
  booted: false,
  needKey: !getKey(),
  syncing: false,
  refreshing: false,
  error: '',
  offline: false,
  channels: cache?.channels || [],
  videos: cache?.videos || [],
  later: cache?.later || [],
  hidden: new Set(cache?.hidden || []),
  progress: lsGetJson(PROG, {}),
  prefs: { ...DEFAULT_PREFS, ...lsGetJson(PREFS, {}) },
  loadedAt: cache?.at || 0,
  toast: null,
};
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
export const getState = () => state;
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  emit();
}
export function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// 選んだ部分が変わったときだけ描き直す(配列やオブジェクトは同じ物かどうかで比べる)
export function useStore(sel) {
  const selRef = useRef(sel);
  selRef.current = sel;
  return useSyncExternalStore(subscribe, () => selRef.current(state));
}

export function toast(msg, ms = 2600) {
  const id = Date.now() + Math.random();
  setState({ toast: { id, msg } });
  setTimeout(() => {
    if (state.toast?.id === id) setState({ toast: null });
  }, ms);
}

export function setPref(k, v) {
  const prefs = { ...state.prefs, [k]: v };
  lsSetJson(PREFS, prefs);
  setState({ prefs });
}

function saveCache() {
  const ok = lsSetJson(CACHE, {
    channels: state.channels,
    videos: state.videos.slice(0, 700),
    later: state.later,
    hidden: [...state.hidden],
    at: state.loadedAt,
  });
  if (!ok) lsSetJson(CACHE, { channels: state.channels, videos: state.videos.slice(0, 200), later: state.later, hidden: [...state.hidden], at: state.loadedAt });
}

// ------------------------------------------------------------------ 読み込み
export async function load({ quiet = false } = {}) {
  if (!getKey()) {
    setState({ needKey: true, booted: true });
    return;
  }
  if (!quiet) setState({ syncing: true });
  try {
    const d = await rpc('load', { days: 60 });
    // 安全弁: クラウドが空で端末に控えがあるときは、控えを消さない
    const cloudEmpty = !(d.channels || []).length && !(d.videos || []).length;
    const localHas = state.channels.length > 0;
    const progress = mergeProgress(d.progress || []);
    if (cloudEmpty && localHas) {
      setState({ progress, syncing: false, booted: true, needKey: false, error: 'クラウドの登録チャンネルが空でした。端末の控えを表示しています', offline: false });
    } else {
      setState({
        channels: d.channels || [],
        videos: d.videos || [],
        later: d.later || [],
        hidden: new Set(d.hidden || []),
        progress,
        loadedAt: Date.now(),
        syncing: false,
        booted: true,
        needKey: false,
        error: '',
        offline: false,
      });
      saveCache();
    }
    flushProgress();
    autoRefresh(d.channels || []);
  } catch (e) {
    const bad = e.status === 400 && /合言葉/.test(e.message);
    setState({ syncing: false, booted: true, needKey: bad || state.needKey, error: bad ? '' : e.message, offline: e.status === 0 });
  }
}

// 開いたとき、新着の取り込みが15分以上前なら、裏で取り込み直す(サーバーの定期取り込みが止まっていても新しくなる)
let autoAt = 0;
async function autoRefresh(channels) {
  if (!channels.length || state.refreshing || Date.now() - autoAt < 5 * 60e3) return;
  const newest = Math.max(...channels.map((c) => (c.last_fetch ? new Date(c.last_fetch).getTime() : 0)));
  const oldest = Math.min(...channels.map((c) => (c.last_fetch ? new Date(c.last_fetch).getTime() : 0)));
  if (Date.now() - newest < 15 * 60e3 && Date.now() - oldest < 60 * 60e3) return;
  autoAt = Date.now();
  setState({ refreshing: true });
  try {
    const r = await fn('refresh', { n: 40, meta: 6 }, 60000);
    if (r.added || r.filled) await load({ quiet: true });
    if (r.added) toast(`新しい動画が ${r.added} 本届きました`);
  } catch (_) {
    /* 次に開いたとき */
  } finally {
    setState({ refreshing: false });
  }
}

// 新着を YouTube から取り込み直してから読み込む
export async function refreshFeed() {
  if (state.refreshing) return;
  setState({ refreshing: true });
  try {
    const r = await fn('refresh', { n: 40, meta: 6 }, 60000);
    await load({ quiet: true });
    toast(r.added ? `新しい動画が ${r.added} 本あります` : '新しい動画はありませんでした');
  } catch (e) {
    toast(`更新できませんでした(${e.message})`);
  } finally {
    setState({ refreshing: false });
  }
}

// ------------------------------------------------------------------ 再生位置
function mergeProgress(cloud) {
  const local = state.progress;
  const out = { ...local };
  const dirty = new Set(lsGetJson(DIRTY, []));
  for (const c of cloud) {
    const l = local[c.id];
    if (!l || (!dirty.has(c.id) && new Date(c.at) >= new Date(l.at || 0)) || new Date(c.at) > new Date(l.at || 0)) {
      out[c.id] = { pos: c.pos, dur: c.dur, done: c.done, title: c.title, ch: c.ch, cht: c.cht, at: c.at };
    }
  }
  lsSetJson(PROG, trimProgress(out));
  return out;
}
function trimProgress(p) {
  const ids = Object.keys(p);
  if (ids.length <= 1200) return p;
  const keep = ids.sort((a, b) => new Date(p[b].at) - new Date(p[a].at)).slice(0, 1000);
  return Object.fromEntries(keep.map((k) => [k, p[k]]));
}

let progSaveTimer = 0;
export function setProgress(id, patch, { flush = false } = {}) {
  if (!id) return;
  const prev = state.progress[id] || {};
  const next = { ...prev, ...patch, at: new Date().toISOString() };
  state = { ...state, progress: { ...state.progress, [id]: next } };
  emit();
  const dirty = new Set(lsGetJson(DIRTY, []));
  dirty.add(id);
  lsSetJson(DIRTY, [...dirty]);
  clearTimeout(progSaveTimer);
  progSaveTimer = setTimeout(() => lsSetJson(PROG, trimProgress(state.progress)), 800);
  if (flush) flushProgress();
}

let flushing = null;
export async function flushProgress() {
  if (flushing || !getKey()) return flushing;
  const dirty = lsGetJson(DIRTY, []);
  if (!dirty.length) return;
  lsSetJson(PROG, trimProgress(state.progress));
  const items = dirty.map((id) => ({ id, ...state.progress[id] })).filter((x) => x.at);
  flushing = (async () => {
    try {
      await rpc('progress', { items });
      const now = new Set(lsGetJson(DIRTY, []));
      // 送っている間に書き換わったものは残す
      for (const it of items) if (state.progress[it.id]?.at === it.at) now.delete(it.id);
      lsSetJson(DIRTY, [...now]);
    } catch (_) {
      /* 次の機会に送る */
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
setInterval(flushProgress, 20000);
addEventListener('online', flushProgress);
addEventListener('pagehide', () => flushProgress());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushProgress();
});

export async function deleteHistory(id) {
  const p = { ...state.progress };
  delete p[id];
  setState({ progress: p });
  lsSetJson(PROG, p);
  const dirty = new Set(lsGetJson(DIRTY, []));
  dirty.delete(id);
  lsSetJson(DIRTY, [...dirty]);
  try {
    await rpc('history_del', { id });
  } catch (e) {
    toast(`消せませんでした(${e.message})`);
  }
}

// ------------------------------------------------------------------ あとで見る・興味なし・登録
export function isLater(id) {
  return state.later.some((l) => l.id === id);
}
export async function toggleLater(v) {
  const has = isLater(v.id);
  // v は videoInfo() と同じ形 { id, title, chId, cht, dur }
  const item = { id: v.id, title: v.title || '', ch: v.chId || '', cht: v.cht || '', dur: v.dur || null, at: new Date().toISOString() };
  const later = has ? state.later.filter((l) => l.id !== v.id) : [item, ...state.later];
  setState({ later });
  saveCache();
  toast(has ? '「あとで見る」から外しました' : '「あとで見る」に入れました');
  try {
    await rpc(has ? 'later_del' : 'later_add', has ? { id: v.id } : { id: item.id, title: item.title, ch: item.ch, cht: item.cht, dur: item.dur ? Math.round(item.dur) : '' });
  } catch (e) {
    toast(`保存できませんでした(${e.message})`);
  }
}

export async function hideVideo(id, undo = false) {
  const hidden = new Set(state.hidden);
  undo ? hidden.delete(id) : hidden.add(id);
  setState({ hidden });
  saveCache();
  try {
    await rpc(undo ? 'unhide' : 'hide', { id });
  } catch (e) {
    toast(`保存できませんでした(${e.message})`);
  }
}

export const isSubscribed = (chId) => state.channels.some((c) => c.id === chId);

export async function subscribeChannel(ch) {
  const temp = { id: ch.id, title: ch.title || '', avatar: ch.avatar || '', handle: ch.handle || '' };
  setState({ channels: [...state.channels.filter((c) => c.id !== ch.id), temp] });
  toast('登録しました。新着を取り込んでいます…');
  try {
    await fn('sub', { id: ch.id, title: ch.title, avatar: ch.avatar, handle: ch.handle }, 60000);
    await load({ quiet: true });
  } catch (e) {
    setState({ channels: state.channels.filter((c) => c.id !== ch.id) });
    toast(`登録できませんでした(${e.message})`);
  }
}

export async function subscribeByUrl(url) {
  const r = await fn('sub', { url }, 60000);
  await load({ quiet: true });
  return r.channel;
}

export async function unsubscribeChannel(id) {
  const before = state.channels;
  setState({ channels: before.filter((c) => c.id !== id), videos: state.videos.filter((v) => v.ch !== id) });
  saveCache();
  try {
    await rpc('unsub', { id });
    toast('登録を解除しました');
  } catch (e) {
    setState({ channels: before });
    toast(`解除できませんでした(${e.message})`);
  }
}

// ------------------------------------------------------------------ 書き出し(通信なしで動く)
export function exportData() {
  const data = {
    app: 'tsuzuki',
    exported_at: new Date().toISOString(),
    channels: state.channels,
    later: state.later,
    hidden: [...state.hidden],
    progress: state.progress,
    prefs: state.prefs,
  };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tsuzuki-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

// ------------------------------------------------------------------ 動画の情報を、手元にある一覧から探す
const infoCache = new Map(); // fn('video') の結果
export const videoDetail = (id) => infoCache.get(id);
export function rememberDetail(id, d) {
  infoCache.set(id, d);
  if (infoCache.size > 60) infoCache.delete(infoCache.keys().next().value);
}
const seenHits = new Map(); // 検索・関連・チャンネルで見かけた動画
export function rememberHits(list) {
  for (const h of list || []) if (h?.id && !seenHits.has(h.id)) seenHits.set(h.id, h);
  if (seenHits.size > 800) {
    const it = seenHits.keys();
    for (let i = 0; i < 200; i++) seenHits.delete(it.next().value);
  }
}
export function chById(id) {
  return state.channels.find((c) => c.id === id);
}
// どこから来た動画でも同じ形 { id, title, chId, cht, avatar, dur, vtxt, ptxt, pub, short, live }
export function videoInfo(id) {
  const d = infoCache.get(id);
  const v = state.videos.find((x) => x.id === id);
  const h = seenHits.get(id);
  const l = state.later.find((x) => x.id === id);
  const p = state.progress[id];
  const chId = d?.channel?.id || v?.ch || h?.chId || l?.ch || p?.ch || '';
  const ch = chById(chId);
  return {
    id,
    title: d?.title || v?.title || h?.title || l?.title || p?.title || '',
    chId,
    cht: d?.channel?.title || ch?.title || h?.ch || l?.cht || p?.cht || '',
    avatar: d?.channel?.avatar || ch?.avatar || h?.avatar || '',
    dur: v?.dur || h?.dur || l?.dur || p?.dur || 0,
    vtxt: d?.vtxt || h?.vtxt || '',
    ptxt: d?.ptxt || h?.ptxt || '',
    pub: v?.pub || null,
    views: v?.views || 0,
    short: !!v?.short,
    live: !!(v?.live || h?.live || d?.live),
  };
}
