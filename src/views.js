import React, { useEffect, useMemo, useRef, useState } from 'react';
import { html, thumb, watchUrl, fmtTime, fmtViews, ago, fmtDay, morningWindow, clsx, splitDesc, lsGetJson, lsSetJson, goBack } from './util.js';
import {
  useStore, getState, setState, toast, setPref, load, refreshFeed, toggleLater, hideVideo, deleteHistory,
  subscribeChannel, subscribeByUrl, unsubscribeChannel, exportData, videoInfo, videoDetail, rememberDetail, rememberHits, chById,
} from './store.js';
import { fn, setKey } from './api.js';
import * as P from './player.js';

const Icon = P.Icon;
// 下のタブの絵は、選んでいないときは線だけ・選んだときは塗りつぶし(YouTube アプリと同じ)
const I = {
  home: 'M4 21V10.08l8-6.96 8 6.96V21h-6v-6h-4v6H4z',
  homeO: 'M12 3 3 10.2V22h7v-6h4v6h7V10.2L12 3zm7 17h-3v-6H8v6H5v-8.84l7-5.6 7 5.6V20z',
  shorts: 'M8 2h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zm2 6.5v7l6-3.5-6-3.5z',
  shortsO: 'M8 2h8a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H8zm2 4.5 6 3.5-6 3.5v-7z',
  subs: 'M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2zm-6 4-6-3.27v6.53L16 16z',
  subsO: 'M20 8H4V6h16v2zm-2-6H6v2h12V2zM4 10h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zm0 2v8h16v-8H4zm6 .73L16 16l-6 3.27v-6.54z',
  me: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 14a8 8 0 0 1-6.16-2.9C7.3 15.6 9.5 14.8 12 14.8s4.7.8 6.16 2.3A8 8 0 0 1 12 20z',
  meO: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 0 1 6.32 12.9C16.9 15.4 14.6 14.5 12 14.5s-4.9.9-6.32 2.4A8 8 0 0 1 12 4zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  more: P.IC.more,
  later: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z',
  save: 'M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z',
  saved: 'M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11.41 6L12 19.59 13.41 18l1.59 1.59L20.59 14 22 15.41z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  open: P.IC.open,
  share: 'M15 5.63 20.66 12 15 18.37V14h-1c-3.96 0-7.14 1-9.75 3.09 1.84-4.07 5.11-6.4 9.89-7.1l.86-.13V5.63M14 3v6C6.22 10.13 3.11 15.33 2 21c2.78-3.97 6.44-6 12-6v6l8-9-8-9z',
  restart: P.IC.restart,
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  hide: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.32L5.68 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.68L18.32 7.1A8 8 0 0 1 12 20z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  sun: 'M6.76 4.84 4.96 3.05 3.55 4.46l1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zM17.24 18.16l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91 1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
  gear: P.IC.gear,
  fill: 'M5 5h10v2H8.41L19 17.59 17.59 19 7 8.41V15H5V5z',
  like: 'M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66a4.8 4.8 0 0 0-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84A2.34 2.34 0 0 0 9.34 20h8.11c.7 0 1.36-.37 1.72-.97l2.66-6.15z',
  playlist: 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm13-1v8l6-4z',
  download: 'M17 18v1H6v-1h11zm-.5-6.6-.7-.7-3.8 3.7V4h-1v10.4l-3.8-3.8-.7.7 5 5 5-4.9z',
  chev: 'M9.4 18 8 16.6l4.6-4.6L8 7.4 9.4 6l6 6z',
};

// ------------------------------------------------------------------ 共通の部品
function chInfo(chId) {
  return chById(chId) || {};
}
// 新着フィードの1件 → カードの形
function fromFeed(v, now) {
  const ch = chInfo(v.ch);
  return {
    id: v.id, title: v.title, chId: v.ch, cht: ch.title || '', avatar: ch.avatar || '',
    dur: v.dur || 0, vtxt: fmtViews(v.views), ptxt: ago(v.pub, now), live: !!v.live, short: !!v.short, pub: v.pub,
  };
}
// 検索・関連・チャンネルの1件 → カードの形
function fromHit(h) {
  return { id: h.id, title: h.title, chId: h.chId, cht: h.ch, avatar: h.avatar, dur: h.dur, vtxt: h.vtxt, ptxt: h.ptxt, live: h.live };
}
const shortHits = (list) => (list || []).map((s) => ({ ...s, short: true }));

function useWide(min = 1000) {
  const [w, setW] = useState(() => innerWidth >= min);
  useEffect(() => {
    const f = () => setW(innerWidth >= min);
    addEventListener('resize', f);
    return () => removeEventListener('resize', f);
  }, [min]);
  return w;
}

let nextQueue = null;
export function play(id, queue) {
  nextQueue = queue || null;
  location.hash = `#/w/${id}`;
}
// ショートは縦にめくる画面で流す。list はその並び(無ければ登録チャンネルのショート)
let nextShorts = null;
export function playShort(id, list) {
  nextShorts = list && list.length ? list : null;
  location.hash = `#/shorts/${id}`;
}

function Avatar({ src, title, size = 36, onClick }) {
  const [bad, setBad] = useState(false);
  const letter = (title || '?').trim().replace(/^@/, '').slice(0, 1);
  const st = { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' };
  if (!src || bad) return html`<span class="av av-letter" style=${st} onClick=${onClick}>${letter}</span>`;
  return html`<img class="av" style=${st} src=${src} alt="" loading="lazy" referrerpolicy="no-referrer" onError=${() => setBad(true)} onClick=${onClick} />`;
}

function Thumb({ v, small }) {
  const p = useStore((s) => s.progress[v.id]);
  const [src, setSrc] = useState(v.short ? `https://i.ytimg.com/vi/${v.id}/oar2.jpg` : thumb(v.id, small ? 'mqdefault' : 'hqdefault'));
  const pct = p ? (p.done ? 100 : p.dur ? Math.min(100, (p.pos / p.dur) * 100) : 0) : 0;
  return html`<div class=${clsx('th', v.short && 'th-short')}>
    <img src=${src} alt="" loading="lazy" onError=${() => setSrc(thumb(v.id, 'hqdefault'))} />
    ${v.live ? html`<span class="badge live">ライブ</span>` : v.dur && !v.short ? html`<span class="badge">${fmtTime(v.dur)}</span>` : null}
    ${pct > 0 && !v.short && html`<div class="th-bar"><i style=${{ width: pct + '%' }}></i></div>`}
  </div>`;
}

function openVideo(v, queue, shortList) {
  if (v.short) playShort(v.id, shortList);
  else play(v.id, queue);
}

function VideoCard({ v, queue, variant = 'big', menu = true, extra }) {
  const p = useStore((s) => s.progress[v.id]);
  const dim = useStore((s) => s.prefs.hideWatched) && p?.done && variant === 'big';
  const open = () => openVideo(v, queue);
  const moreBtn = menu && html`<button class="ib sm more" aria-label="メニュー" onClick=${(e) => { e.stopPropagation(); openSheet(v); }}><${Icon} d=${I.more} size=${20} /></button>`;
  if (variant === 'shelf') {
    return html`<div class="vsh" onClick=${open}>
      <${Thumb} v=${v} small />
      <div class="vsh-row">
        <div class="vsh-text">
          <div class="vsh-title">${v.title}</div>
          <div class="vsh-sub">${v.cht}</div>
        </div>
        ${moreBtn}
      </div>
    </div>`;
  }
  if (variant === 'row') {
    return html`<div class="vr" onClick=${open}>
      <div class="vr-th"><${Thumb} v=${v} small /></div>
      <div class="vr-body">
        <div class="vr-title">${v.title || '(題名なし)'}</div>
        <div class="vr-meta">${v.cht}</div>
        <div class="vr-meta">${[v.vtxt, v.ptxt].filter(Boolean).join(' ・ ')}</div>
        ${extra}
      </div>
      ${moreBtn}
    </div>`;
  }
  return html`<div class=${clsx('vb', dim && 'dim')} onClick=${open}>
    <${Thumb} v=${v} />
    <div class="vb-info">
      <${Avatar} src=${v.avatar} title=${v.cht} onClick=${(e) => { e.stopPropagation(); if (v.chId) location.hash = `#/c/${v.chId}`; }} />
      <div class="vb-text">
        <div class="vb-title">${v.title}</div>
        <div class="vb-meta">${[v.cht, v.vtxt, v.ptxt].filter(Boolean).join(' ・ ')}</div>
      </div>
      ${moreBtn}
    </div>
  </div>`;
}

// ショートの棚(横に並ぶ縦長のカード)
function ShortCard({ v, list, wide }) {
  return html`<div class=${clsx('sc', wide && 'sc-grid')} onClick=${() => playShort(v.id, list)}>
    <img src=${`https://i.ytimg.com/vi/${v.id}/oar2.jpg`} alt="" loading="lazy" onError=${(e) => { e.currentTarget.src = thumb(v.id, 'hqdefault'); }} />
    <button class="sc-more" aria-label="メニュー" onClick=${(e) => { e.stopPropagation(); openSheet(v); }}><${Icon} d=${I.more} size=${18} /></button>
    <div class="sc-text">
      <div class="sc-title">${v.title}</div>
      ${v.vtxt && html`<div class="sc-views">${v.vtxt}</div>`}
    </div>
  </div>`;
}
function ShortsShelf({ items }) {
  if (!items.length) return null;
  return html`<section class="shelf shorts-shelf">
    <div class="shelf-h"><span class="shorts-logo"><${Icon} d=${I.shorts} size=${22} /></span><h2>ショート</h2></div>
    <div class="shelf-row">${items.map((v) => html`<${ShortCard} key=${v.id} v=${v} list=${items} />`)}</div>
  </section>`;
}

// 少しずつ表示を足す一覧
// resetKey が変わったとき(絞り込みを替えたとき)だけ先頭の件数に戻す。再生中の描き直しでは戻さない
function Paged({ items, render, step = 24, resetKey = '' }) {
  const [n, setN] = useState(step);
  const ref = useRef(null);
  useEffect(() => setN(step), [resetKey, step]);
  useEffect(() => {
    if (!ref.current || n >= items.length) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setN((x) => x + step);
    }, { rootMargin: '800px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [n, items.length]);
  return html`${items.slice(0, n).map(render)}${n < items.length && html`<div ref=${ref} class="more-sentinel"></div>`}`;
}

function Empty({ children }) {
  return html`<div class="empty">${children}</div>`;
}

function Shelf({ title, right, children }) {
  return html`<section class="shelf">
    <div class="shelf-h"><h2>${title}</h2><span class="sp"></span>${right}</div>
    <div class="shelf-row">${children}</div>
  </section>`;
}

function Chips({ items, value, onChange }) {
  return html`<div class="chips">
    ${items.map(([k, label]) => html`<button key=${k} class=${clsx('chip', value === k && 'on')} onClick=${() => { onChange(k); scrollTo(0, 0); }}>${label}</button>`)}
  </div>`;
}

// ------------------------------------------------------------------ メニュー(下から出る)
let sheetSet = null;
export function openSheet(v) {
  sheetSet?.(v);
}
export function Sheet() {
  const [v, setV] = useState(null);
  sheetSet = setV;
  const later = useStore((s) => (v ? s.later.some((l) => l.id === v.id) : false));
  const inHist = useStore((s) => (v ? !!s.progress[v.id] : false));
  const inFeed = useStore((s) => (v ? s.videos.some((x) => x.id === v.id) : false));
  if (!v) return null;
  const done = () => setV(null);
  const info = { ...videoInfo(v.id), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x)) };
  const url = v.short ? `https://www.youtube.com/shorts/${v.id}` : watchUrl(v.id);
  const share = async () => {
    done();
    try {
      if (navigator.share) await navigator.share({ title: info.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('リンクをコピーしました');
      }
    } catch (_) { /* やめた */ }
  };
  return html`<div class="sheet-bg" onClick=${done}>
    <div class="sheet" onClick=${(e) => e.stopPropagation()}>
      <div class="sheet-grip"></div>
      <button class="sheet-i" onClick=${() => { toggleLater(info); done(); }}><${Icon} d=${later ? I.saved : I.later} /><span>${later ? '「後で見る」から削除' : '「後で見る」に保存'}</span></button>
      <button class="sheet-i" onClick=${share}><${Icon} d=${I.share} /><span>共有</span></button>
      ${info.chId && html`<button class="sheet-i" onClick=${() => { location.hash = `#/c/${info.chId}`; done(); }}><${Icon} d=${I.person} /><span>チャンネルに移動</span></button>`}
      ${inFeed && html`<button class="sheet-i" onClick=${() => { hideVideo(v.id); toast('この動画は今後表示されません'); done(); }}><${Icon} d=${I.hide} /><span>興味なし</span></button>`}
      ${inHist && html`<button class="sheet-i" onClick=${() => { deleteHistory(v.id); done(); }}><${Icon} d=${I.trash} /><span>再生履歴から削除</span></button>`}
      <a class="sheet-i" href=${url} target="_blank" rel="noopener" onClick=${done}><${Icon} d=${I.open} /><span>YouTube で開く</span></a>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ 上のバー・下のタブ
export function TopBar({ route }) {
  const refreshing = useStore((s) => s.refreshing);
  const main = route.name === 'home' || route.name === 'subs' || route.name === 'me';
  if (route.name === 'watch' || route.name === 'search' || route.name === 'shorts') return null;
  if (!main) {
    return html`<header class="top">
      <button class="ib" aria-label="戻る" onClick=${goBack}><${Icon} d=${I.back} /></button>
      <div class="top-title">${route.title || ''}</div>
      <span class="sp"></span>
      <button class="ib" aria-label="検索" onClick=${() => (location.hash = '#/s/')}><${Icon} d=${I.search} /></button>
    </header>`;
  }
  return html`<header class="top">
    <a class="logo" href="#/" onClick=${() => scrollTo(0, 0)}><img src="icons/icon-192.png" alt="" /><span>つづきから</span></a>
    <span class="sp"></span>
    ${refreshing && html`<span class="top-spin" aria-label="取り込み中"></span>`}
    <button class="ib" aria-label="検索" onClick=${() => (location.hash = '#/s/')}><${Icon} d=${I.search} /></button>
    ${route.name === 'me' && html`<button class="ib" aria-label="設定" onClick=${() => (location.hash = '#/settings')}><${Icon} d=${I.gear} /></button>`}
  </header>`;
}

export function BottomNav({ route }) {
  const tab = (name, href, on, off, label) => {
    const sel = route.tab === name;
    return html`<a class=${clsx('tab', sel && 'on')} href=${href} onClick=${() => { if (sel) scrollTo({ top: 0, behavior: 'smooth' }); }}>
      <${Icon} d=${sel ? on : off} /><span>${label}</span></a>`;
  };
  return html`<nav class="tabs">
    ${tab('home', '#/', I.home, I.homeO, 'ホーム')}
    ${tab('shorts', '#/shorts', I.shorts, I.shortsO, 'ショート')}
    ${tab('subs', '#/subs', I.subs, I.subsO, '登録チャンネル')}
    ${tab('me', '#/me', I.me, I.meO, 'マイページ')}
  </nav>`;
}

// ------------------------------------------------------------------ ホーム
function useFeed() {
  const videos = useStore((s) => s.videos);
  const hidden = useStore((s) => s.hidden);
  const channels = useStore((s) => s.channels);
  return useMemo(() => {
    const now = Date.now();
    return videos.filter((v) => !hidden.has(v.id)).map((v) => fromFeed(v, now));
  }, [videos, hidden, channels]);
}
// 登録チャンネルのショート(まだ見ていないもの → 新しい順)
function useSubShorts(days = 14) {
  const feed = useFeed();
  const progress = useStore((s) => s.progress);
  return useMemo(() => {
    const now = Date.now();
    const all = feed.filter((v) => v.short && now - new Date(v.pub) < days * 864e5);
    return [...all.filter((v) => !progress[v.id]), ...all.filter((v) => progress[v.id])];
  }, [feed, days]);
}

function continueItems(progress, limit = 20) {
  return Object.entries(progress)
    .filter(([, p]) => !p.done && p.pos >= 8 && (!p.dur || p.pos < p.dur - 15))
    .sort((a, b) => new Date(b[1].at) - new Date(a[1].at))
    .slice(0, limit)
    .map(([id]) => videoInfo(id))
    .filter((v) => !v.short);
}

export function Home() {
  const feed = useFeed();
  const prefs = useStore((s) => s.prefs);
  const progress = useStore((s) => s.progress);
  const booted = useStore((s) => s.booted);
  const nch = useStore((s) => s.channels.length);
  const subShorts = useSubShorts(5);
  const [chip, setChip] = useState(() => sessionStorage.getItem('tz:chip') || 'all');
  useEffect(() => { try { sessionStorage.setItem('tz:chip', chip); } catch (_) {} }, [chip]);

  const long = feed.filter((v) => !v.short);
  const { start, end } = morningWindow(prefs.morningHour);
  const morning = long.filter((v) => { const t = new Date(v.pub); return t >= start && t < end; });
  const morningLeft = morning.filter((v) => !progress[v.id]?.done);
  const shorts = prefs.shorts ? subShorts.slice(0, 12) : [];
  const cont = continueItems(progress);
  const unwatched = long.filter((v) => !progress[v.id]);
  const list = chip === 'morning' ? morning : chip === 'unwatched' ? unwatched : chip === 'continue' ? cont : long;
  const ids = list.filter((v) => !v.live).map((v) => v.id);
  // 「すべて」のときは、YouTube と同じく動画3本のあとにショートの棚をはさむ
  const items = chip === 'all' && shorts.length ? [...list.slice(0, 3), { kind: 'shorts', id: '__shorts' }, ...list.slice(3)] : list;

  if (booted && !nch) {
    return html`<${Empty}>
      <p>登録チャンネルがまだありません。</p>
      <a class="btn" href="#/add">チャンネルを追加</a>
    </${Empty}>`;
  }
  return html`<div class="page">
    <${Chips} value=${chip} onChange=${setChip} items=${[['all', 'すべて'], ['music', '音楽'], ['morning', `けさの便${morningLeft.length ? ' ' + morningLeft.length : ''}`], ['unwatched', '未視聴'], ['continue', '続きから']]} />
    ${chip === 'music' && html`<${MusicView} feed=${long} />`}
    ${chip === 'all' && html`
      ${morning.length > 0 && html`<${MorningBox} items=${morning} left=${morningLeft} end=${end} />`}
      ${cont.length > 0 && html`<${Shelf} title="続きから見る">${cont.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" queue=${cont.map((x) => x.id)} />`)}</${Shelf}>`}
    `}
    ${chip === 'morning' && html`<div class="morning-head">${fmtDay(end)} ${prefs.morningHour}時の便 ・ ${fmtDay(start).replace(/\(.\)/, '')} ${prefs.morningHour}時から届いた ${morning.length} 本</div>`}
    ${chip === 'music' ? null : list.length === 0
      ? html`<${Empty}>${chip === 'continue' ? '途中まで見た動画はありません' : chip === 'morning' ? 'けさの便に入った動画はありません' : '動画がありません'}</${Empty}>`
      : html`<div class="grid"><${Paged} items=${items} resetKey=${chip} render=${(v) =>
          v.kind === 'shorts' ? html`<div class="grid-full" key="__shorts"><${ShortsShelf} items=${shorts} /></div>` : html`<${VideoCard} key=${v.id} v=${v} queue=${ids} />`} /></div>`}
  </div>`;
}

// ------------------------------------------------------------------ 音楽
// 登録チャンネルの新着から音楽らしいもの + YouTube 検索でそろえた棚。「すべて再生」で続けて流せる(作業中・寝る前に)
const MUSIC_TITLE = /(\bMV\b|M\/V|Music Video|ミュージックビデオ|Official (Video|Audio|Lyric)|Lyric Video|リリック|THE FIRST TAKE|歌ってみた|弾き語り|\bcover\b|カバー|feat\.|\bLive at\b|ライブ映像|主題歌|\bAudio\b|Official Music|新曲|作業用BGM|\bBGM\b|ピアノ|Piano)/i;
const MUSIC_CH = /(Official|VEVO|Records|Music|ミュージック|THE FIRST TAKE| - Topic|Topic$|レコード|ソニー|エイベックス|avex)/i;
const MUSIC_SHELVES = [
  { key: 'new', title: '新着ミュージックビデオ', q: 'MV 新曲', sp: 'EgQIAxAB' },
  { key: 'jpop', title: '人気の J-POP', q: 'J-POP 人気曲 MV', sp: 'EgIQAQ==' },
  { key: 'ftt', title: 'THE FIRST TAKE', q: 'THE FIRST TAKE', sp: 'EgQIBBAB' },
  { key: 'utatte', title: '歌ってみた', q: '歌ってみた 人気', sp: 'EgIQAQ==' },
  { key: 'bgm', title: '作業用 BGM', q: '作業用BGM', sp: 'EgIQAQ==' },
  { key: 'piano', title: 'ピアノ・ゆったり', q: 'ピアノ BGM 癒し', sp: 'EgIQAQ==' },
];
const MUSIC_CACHE = 'tsuzuki:music';
// 戻り値: null(読み込み中) / 動画の配列 / { error: true }
function useMusicShelf(sh, retry) {
  const [items, setItems] = useState(() => {
    const c = lsGetJson(MUSIC_CACHE, {})[sh.key];
    return c && c.items?.length ? c.items : null;
  });
  useEffect(() => {
    if (Array.isArray(items)) rememberHits(items);
    const c = lsGetJson(MUSIC_CACHE, {})[sh.key];
    if (c && c.items?.length && Date.now() - c.at < 6 * 3600e3) return; // 6時間は前の結果を使う
    let off = false;
    if (!Array.isArray(items)) setItems(null);
    fn('search', { q: sh.q, sp: sh.sp })
      .then((d) => {
        if (!Array.isArray(d?.videos)) throw new Error('bad');
        rememberHits(d.videos);
        const list = d.videos.filter((v) => !v.live && (!v.dur || v.dur < 3 * 3600)).slice(0, 20);
        if (list.length) {
          // 0本のときは覚えない(次に開いたときに取り直す)
          const now = lsGetJson(MUSIC_CACHE, {});
          now[sh.key] = { at: Date.now(), items: list };
          lsSetJson(MUSIC_CACHE, now);
        }
        if (!off) setItems(list);
      })
      .catch(() => !off && setItems((x) => (Array.isArray(x) && x.length ? x : { error: true })));
    return () => { off = true; };
  }, [sh.key, retry]);
  return items;
}
function MusicShelf({ sh, raw }) {
  if (raw && (raw.error || !raw.length)) return null;
  const items = (raw || []).map(fromHit);
  const ids = items.map((v) => v.id);
  return html`<section class="shelf">
    <div class="shelf-h"><h2>${sh.title}</h2><span class="sp"></span>
      ${ids.length > 0 && html`<button class="btn sm outline" onClick=${() => play(ids[0], ids)}><${Icon} d=${P.IC.play} size=${16} />すべて再生</button>`}
    </div>
    <div class="shelf-row">${raw ? items.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" queue=${ids} />`)
      : [0, 1, 2].map((i) => html`<div key=${i} class="vsh"><div class="th sk"></div><div class="sk-line"></div></div>`)}</div>
  </section>`;
}
function MusicView({ feed }) {
  const [retry, setRetry] = useState(0);
  // 棚の数は決まっているので、フックを並べて呼んでよい
  const shelves = MUSIC_SHELVES.map((sh) => [sh, useMusicShelf(sh, retry)]);
  const mine = feed.filter((v) => !v.live && (MUSIC_TITLE.test(v.title || '') || MUSIC_CH.test(v.cht || '')));
  const ids = mine.map((v) => v.id);
  const settled = shelves.every(([, r]) => r !== null);
  const anyItems = shelves.some(([, r]) => Array.isArray(r) && r.length);
  const anyErr = shelves.some(([, r]) => r && r.error);
  if (!mine.length && settled && !anyItems) {
    return html`<${Empty}>
      <p>${anyErr ? (navigator.onLine === false ? 'オフラインのため、音楽を読み込めませんでした' : '音楽を読み込めませんでした') : '音楽の動画が見つかりませんでした'}</p>
      <button class="btn" onClick=${() => setRetry((x) => x + 1)}>もう一度</button>
    </${Empty}>`;
  }
  return html`<div class="music">
    <p class="music-lead">登録チャンネルの曲と、みんなが聴いている曲。「すべて再生」で続けて流れます。</p>
    ${mine.length > 0 && html`<section class="shelf">
      <div class="shelf-h"><h2>登録チャンネルの音楽</h2><span class="sp"></span>
        <button class="btn sm outline" onClick=${() => play(ids[0], ids)}><${Icon} d=${P.IC.play} size=${16} />すべて再生</button></div>
      <div class="shelf-row">${mine.slice(0, 30).map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" queue=${ids} />`)}</div>
    </section>`}
    ${shelves.map(([sh, raw]) => html`<${MusicShelf} key=${sh.key} sh=${sh} raw=${raw} />`)}
    ${anyErr && html`<div class="center"><button class="btn sm ghost" onClick=${() => setRetry((x) => x + 1)}>読み込めなかった棚をもう一度</button></div>`}
  </div>`;
}

function MorningBox({ items, left, end }) {
  const hour = useStore((s) => s.prefs.morningHour);
  const ids = items.filter((v) => !v.live).map((v) => v.id);
  const first = left[0] || items[0];
  return html`<section class="shelf morning">
    <div class="shelf-h">
      <span class="morning-ic"><${Icon} d=${I.sun} size=${18} /></span>
      <div class="morning-tt">
        <h2>けさの便</h2>
        <div class="morning-s">${fmtDay(end)} ${hour}:00 ・ ${items.length} 本${left.length < items.length ? `(あと ${left.length} 本)` : ''}</div>
      </div>
      <span class="sp"></span>
      ${left.length > 0 && html`<button class="btn sm" onClick=${() => play(first.id, left.filter((v) => !v.live).map((v) => v.id))}><${Icon} d=${P.IC.play} size=${18} />続けて再生</button>`}
    </div>
    <div class="shelf-row">${items.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" queue=${ids} />`)}</div>
  </section>`;
}

// ------------------------------------------------------------------ ショート(縦にめくる画面)
export function ShortsPage({ id }) {
  const subShorts = useSubShorts(30);
  const st = P.usePlayer((p) => p.st);
  const started0 = P.usePlayer((p) => p.started);
  const autoPass = P.usePlayer((p) => p.autoPass);
  const started = started0 && !autoPass;
  const pid = P.usePlayer((p) => p.id);
  const pmode = P.usePlayer((p) => p.mode);
  const [list] = useState(() => {
    const base = nextShorts || subShorts;
    nextShorts = null;
    if (id && !base.some((v) => v.id === id)) return [{ ...videoInfo(id), id, short: true }, ...base];
    return base;
  });
  const [cur, setCur] = useState(() => Math.max(0, list.findIndex((v) => v.id === id)));
  const [settled, setSettled] = useState(true);
  const ref = useRef(null);
  const timer = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = cur * el.clientHeight;
  }, []);
  useEffect(() => {
    const v = list[cur];
    if (!v) return;
    P.load(v.id, { short: true });
    try { history.replaceState(history.state, '', location.pathname + location.search + `#/shorts/${v.id}`); } catch (_) { /* 何もしない */ }
  }, [cur]);
  const onScroll = () => {
    const el = ref.current;
    setSettled(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const i = Math.round(el.scrollTop / el.clientHeight);
      setSettled(true);
      if (i !== cur && list[i]) setCur(i);
    }, 120);
  };
  if (!list.length) {
    return html`<div class="shorts-empty"><${Empty}>登録チャンネルのショートはまだありません</${Empty}></div>`;
  }
  const ready = pid === list[cur]?.id && pmode === 'short';
  return html`<div class="shorts" ref=${ref} onScroll=${onScroll}>
    ${list.map((v, i) => {
      const active = i === cur && settled && ready;
      const info = { ...videoInfo(v.id), ...Object.fromEntries(Object.entries(v).filter(([, x]) => x)) };
      return html`<section key=${v.id} class=${clsx('sh-slide', active && 'active')}>
        ${Math.abs(i - cur) <= 2 && html`<img class="sh-th" src=${`https://i.ytimg.com/vi/${v.id}/oar2.jpg`} alt="" onError=${(e) => { e.currentTarget.src = thumb(v.id, 'hqdefault'); }} />`}
        <div class=${clsx('sh-tap', active && !started && 'through')} onClick=${() => i === cur && P.togglePlay()}></div>
        ${active && st === 2 && html`<div class="sh-paused"><${Icon} d=${P.IC.play} size=${56} /></div>`}
        ${active && !started && html`<div class="pc-hint sh-hint">動画の ▶ を直接押して再生</div>`}
        <div class="sh-side">
          <button class="sh-btn" onClick=${() => toggleLater({ ...info, short: true })}><${Icon} d=${getState().later.some((l) => l.id === v.id) ? I.saved : I.save} size=${28} /><span>保存</span></button>
          <button class="sh-btn" onClick=${() => openSheet({ ...info, short: true })}><${Icon} d=${I.share} size=${28} /><span>共有</span></button>
          <button class="sh-btn" onClick=${() => openSheet({ ...info, short: true })}><${Icon} d=${I.more} size=${28} /><span></span></button>
        </div>
        <div class="sh-info">
          <div class="sh-ch">
            <span onClick=${() => info.chId && (location.hash = `#/c/${info.chId}`)}><${Avatar} src=${info.avatar} title=${info.cht} size=${32} /></span>
            <b onClick=${() => info.chId && (location.hash = `#/c/${info.chId}`)}>${info.cht ? '@' + info.cht.replace(/^@/, '') : ''}</b>
            ${info.chId && html`<${SubButton} ch=${{ id: info.chId, title: info.cht, avatar: info.avatar }} small light />`}
          </div>
          <div class="sh-title">${info.title}</div>
        </div>
      </section>`;
    })}
  </div>`;
}

// ------------------------------------------------------------------ 登録チャンネル
export function Subs({ chId }) {
  const feed = useFeed();
  const channels = useStore((s) => s.channels);
  const videos = useStore((s) => s.videos);
  const progress = useStore((s) => s.progress);
  const [chip, setChip] = useState('all');
  const latest = useMemo(() => {
    const m = new Map();
    for (const v of videos) if (!m.has(v.ch)) m.set(v.ch, v.pub);
    return m;
  }, [videos]);
  const sorted = useMemo(
    () => [...channels].sort((a, b) => new Date(latest.get(b.id) || 0) - new Date(latest.get(a.id) || 0)),
    [channels, latest],
  );
  const mine = feed.filter((v) => !chId || v.chId === chId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const shorts = mine.filter((v) => v.short);
  let list = mine.filter((v) => !v.short);
  if (chip === 'today') list = list.filter((v) => new Date(v.pub) >= today);
  else if (chip === 'live') list = list.filter((v) => v.live);
  else if (chip === 'unwatched') list = list.filter((v) => !progress[v.id]);
  else if (chip === 'continue') list = list.filter((v) => progress[v.id] && !progress[v.id].done);
  const ids = list.filter((v) => !v.live).map((v) => v.id);
  const showShorts = chip === 'all' && shorts.length > 0;
  const items = showShorts ? [...list.slice(0, 2), { kind: 'shorts', id: '__shorts' }, ...list.slice(2)] : list;
  const sel = chId ? chById(chId) : null;
  return html`<div class="page">
    <div class="ch-strip-wrap">
      <div class="ch-strip">
        ${sorted.map((c) => html`<a key=${c.id} class=${clsx('ch-dot', chId === c.id && 'on', chId && chId !== c.id && 'off')} href=${chId === c.id ? '#/subs' : `#/subs/${c.id}`}>
          <${Avatar} src=${c.avatar} title=${c.title} size=${56} />
          <span>${c.title || '…'}</span>
          ${latest.get(c.id) && Date.now() - new Date(latest.get(c.id)) < 864e5 && html`<i class="ch-new"></i>`}
        </a>`)}
      </div>
      <a class="ch-all" href="#/channels">すべて</a>
    </div>
    <${Chips} value=${chip} onChange=${setChip} items=${[['all', 'すべて'], ['today', '今日'], ['videos', '動画'], ['shorts', 'ショート'], ['live', 'ライブ'], ['unwatched', '未視聴'], ['continue', '続きを見る']]} />
    ${sel && html`<div class="sel-ch"><b>${sel.title}</b><span class="sp"></span><a class="link" href=${`#/c/${sel.id}`}>チャンネルを表示</a></div>`}
    ${chip === 'shorts'
      ? shorts.length
        ? html`<div class="sgrid">${shorts.map((v) => html`<${ShortCard} key=${v.id} v=${v} list=${shorts} wide />`)}</div>`
        : html`<${Empty}>ショートはありません</${Empty}>`
      : list.length === 0
        ? html`<${Empty}>動画がありません</${Empty}>`
        : html`<div class="grid"><${Paged} items=${items} resetKey=${(chId || 'all') + chip} render=${(v) =>
            v.kind === 'shorts' ? html`<div class="grid-full" key="__shorts"><${ShortsShelf} items=${shorts.slice(0, 12)} /></div>` : html`<${VideoCard} key=${v.id} v=${v} queue=${ids} />`} /></div>`}
  </div>`;
}

export function Channels() {
  const channels = useStore((s) => s.channels);
  const videos = useStore((s) => s.videos);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(() => sessionStorage.getItem('tz:chsort') || 'new');
  useEffect(() => { try { sessionStorage.setItem('tz:chsort', sort); } catch (_) {} }, [sort]);
  const latest = useMemo(() => {
    const m = new Map();
    for (const v of videos) if (!m.has(v.ch)) m.set(v.ch, v.pub);
    return m;
  }, [videos]);
  const list = channels
    .filter((c) => !q || (c.title || '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === 'az'
      ? (a.title || '').localeCompare(b.title || '', 'ja')
      : new Date(latest.get(b.id) || 0) - new Date(latest.get(a.id) || 0));
  return html`<div class="page pad">
    <div class="row gap">
      <input class="field" placeholder="チャンネルを絞り込む" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <a class="btn" href="#/add"><${Icon} d=${I.plus} size=${18} />追加</a>
    </div>
    <div class="row gap ch-sort">
      <span class="note">${channels.length} チャンネル</span><span class="sp"></span>
      ${[['new', '新しい動画順'], ['az', '名前順']].map(([k, label]) => html`<button key=${k} class=${clsx('chip', sort === k && 'on')} onClick=${() => setSort(k)}>${label}</button>`)}
    </div>
    ${list.map((c) => html`<div key=${c.id} class="ch-row">
      <a class="ch-row-main" href=${`#/c/${c.id}`}>
        <${Avatar} src=${c.avatar} title=${c.title} size=${44} />
        <div>
          <div class="ch-row-t">${c.title || c.id}</div>
          <div class="ch-row-s">${latest.get(c.id) ? `最新 ${ago(latest.get(c.id))}` : c.err ? '新着を読めません' : '新着を取り込み中'}</div>
        </div>
      </a>
      <button class="btn sm ghost" onClick=${() => { if (confirm(`「${c.title}」の登録を解除しますか?`)) unsubscribeChannel(c.id); }}>解除</button>
    </div>`)}
  </div>`;
}

export function AddChannel() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const go = async (e) => {
    e?.preventDefault();
    const s = q.trim();
    if (!s) return;
    setErr('');
    setBusy(true);
    try {
      if (/youtube\.com|youtu\.be|^@|^UC[\w-]{22}$/.test(s)) {
        const ch = await subscribeByUrl(s);
        toast(`「${ch.title || 'チャンネル'}」を登録しました`);
        location.hash = `#/c/${ch.id}`;
      } else {
        const r = await fn('search', { q: s });
        setRes(r.channels || []);
        if (!(r.channels || []).length) setErr('チャンネルが見つかりませんでした。チャンネルのURLを貼っても登録できます');
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="page pad">
    <form class="row gap" onSubmit=${go}>
      <input class="field" autofocus placeholder="チャンネル名・URL・@ハンドル" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <button class="btn" disabled=${busy}>${busy ? '…' : '探す'}</button>
    </form>
    <p class="note">YouTube アプリの「共有 → リンクをコピー」で取ったチャンネルや動画のリンクを貼っても登録できます。</p>
    ${err && html`<p class="err">${err}</p>`}
    ${(res || []).map((c) => html`<${ChannelRow} key=${c.id} c=${c} />`)}
  </div>`;
}

function SubButton({ ch, small, wide, light }) {
  const subbed = useStore((s) => s.channels.some((c) => c.id === ch.id));
  if (!ch.id) return null;
  return subbed
    ? html`<button class=${clsx('btn ghost', small && 'sm', wide && 'wide', light && 'light-ghost')} onClick=${(e) => { e.stopPropagation(); if (confirm(`「${ch.title}」の登録を解除しますか?`)) unsubscribeChannel(ch.id); }}>登録済み</button>`
    : html`<button class=${clsx('btn', small && 'sm', wide && 'wide', light && 'light')} onClick=${(e) => { e.stopPropagation(); subscribeChannel(ch); }}>登録</button>`;
}

function ChannelRow({ c }) {
  return html`<div class="ch-row">
    <a class="ch-row-main" href=${`#/c/${c.id}`}>
      <${Avatar} src=${c.avatar} title=${c.title} size=${48} />
      <div>
        <div class="ch-row-t">${c.title}</div>
        <div class="ch-row-s">${[c.handle, c.subs].filter(Boolean).join(' ・ ')}</div>
      </div>
    </a>
    <${SubButton} ch=${c} small />
  </div>`;
}

// ------------------------------------------------------------------ チャンネルのページ
const chCache = new Map();
export function ChannelPage({ id }) {
  const local = chById(id);
  const [tab, setTab] = useState('videos');
  const key = id + ':' + tab;
  const [data, setData] = useState(() => chCache.get(key) || null);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(false);
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    let off = false;
    setErr('');
    const c = chCache.get(key);
    setData(c || null);
    if (c) return;
    fn('channel', { id, tab })
      .then((d) => {
        if (off) return;
        rememberHits(d.videos);
        rememberHits(shortHits(d.shorts));
        chCache.set(key, d);
        setData(d);
      })
      .catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [key]);
  const meta = data?.meta || chCache.get(id + ':videos')?.meta || {};
  const ch = { id, title: meta.title || local?.title || '', avatar: meta.avatar || local?.avatar || '', handle: meta.handle || local?.handle || '' };
  const vids = (data?.videos || []).map((h) => ({ ...fromHit(h), chId: h.chId || id, cht: h.ch || ch.title, avatar: '' }));
  const shorts = shortHits(data?.shorts).map((s) => ({ ...s, chId: id, cht: ch.title, avatar: ch.avatar }));
  const ids = vids.filter((v) => !v.live).map((v) => v.id);
  const loadMore = async () => {
    if (!data?.cont) return;
    const myKey = key;
    setMore(true);
    try {
      const d = await fn('channel', { id, cont: data.cont });
      rememberHits(d.videos);
      rememberHits(shortHits(d.shorts));
      const nd = {
        ...data,
        videos: [...(data.videos || []), ...(d.videos || []).filter((v) => !(data.videos || []).some((x) => x.id === v.id))],
        shorts: [...(data.shorts || []), ...(d.shorts || []).filter((v) => !(data.shorts || []).some((x) => x.id === v.id))],
        cont: d.cont,
      };
      chCache.set(myKey, nd);
      if (keyRef.current === myKey) setData(nd); // 途中でタブを替えていたら、今の画面には入れない
    } catch (e) {
      toast(e.message);
    } finally {
      setMore(false);
    }
  };
  useEffect(() => {
    if (ch.title) setState({ routeTitle: ch.title });
  }, [ch.title]);
  return html`<div class="page">
    <div class="ch-head">
      <${Avatar} src=${ch.avatar} title=${ch.title} size=${80} />
      <div class="ch-head-r">
        <div class="ch-head-t">${ch.title || '…'}</div>
        <div class="ch-head-s">${ch.handle}</div>
        <div class="ch-head-s">${meta.subs || ''}</div>
      </div>
    </div>
    ${meta.desc && html`<div class="ch-desc">${meta.desc.split('\n')[0]}</div>`}
    <div class="ch-sub"><${SubButton} ch=${ch} wide /></div>
    <div class="tabs2">
      ${[['videos', '動画'], ['shorts', 'ショート'], ['streams', 'ライブ']].map(([k, label]) =>
        html`<button key=${k} class=${clsx(tab === k && 'on')} onClick=${() => setTab(k)}>${label}</button>`)}
    </div>
    ${err && html`<p class="err pad">${err}</p>`}
    ${!data && !err && html`<div class="loading"><span class="spinner"></span></div>`}
    ${data && tab !== 'shorts' && vids.length === 0 && html`<${Empty}>動画がありません</${Empty}>`}
    ${data && tab === 'shorts' && shorts.length === 0 && html`<${Empty}>ショートがありません</${Empty}>`}
    ${tab === 'shorts'
      ? html`<div class="sgrid three">${shorts.map((v) => html`<${ShortCard} key=${v.id} v=${v} list=${shorts} wide />`)}</div>`
      : html`<div class="grid">${vids.map((v) => html`<${VideoCard} key=${v.id} v=${v} queue=${ids} />`)}</div>`}
    ${data?.cont && html`<div class="center"><button class="btn ghost" disabled=${more} onClick=${loadMore}>${more ? '読み込み中…' : 'もっと見る'}</button></div>`}
  </div>`;
}

// ------------------------------------------------------------------ 検索
const SEARCHES = 'tsuzuki:searches';
const searchCache = new Map();
const sugCache = new Map();
export function Search({ q: q0 }) {
  const [q, setQ] = useState(q0 || '');
  const [typing, setTyping] = useState(!q0);
  const [sug, setSug] = useState([]);
  const [data, setData] = useState(() => (q0 ? searchCache.get(q0) : null) || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState(() => lsGetJson(SEARCHES, []));
  const inputRef = useRef(null);
  useEffect(() => {
    setQ(q0 || '');
    setTyping(!q0);
    setBusy(false);
    setErr('');
    if (!q0) {
      setData(null);
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }
    const c = searchCache.get(q0);
    if (c) {
      setData(c);
      return;
    }
    let off = false;
    setData(null);
    setBusy(true);
    fn('search', { q: q0 })
      .then((d) => {
        if (off) return;
        rememberHits(d.videos);
        rememberHits(shortHits(d.shorts));
        searchCache.set(q0, d);
        setData(d);
      })
      .catch((e) => !off && setErr(e.message))
      .finally(() => !off && setBusy(false));
    return () => {
      off = true;
    };
  }, [q0]);
  // 打っている途中の候補(YouTube と同じ候補)
  useEffect(() => {
    const s = q.trim();
    if (!typing || !s) {
      setSug([]);
      return;
    }
    if (sugCache.has(s)) {
      setSug(sugCache.get(s));
      return;
    }
    let off = false;
    const t = setTimeout(() => {
      fn('suggest', { q: s }, 6000)
        .then((r) => {
          sugCache.set(s, r.items || []);
          if (!off) setSug(r.items || []);
        })
        .catch(() => {});
    }, 160);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [q, typing]);
  const go = (s) => {
    s = (s || '').trim();
    if (!s) return;
    const h = [s, ...hist.filter((x) => x !== s)].slice(0, 30);
    setHist(h);
    lsSetJson(SEARCHES, h);
    inputRef.current?.blur();
    setTyping(false);
    if (s === q0) {
      setQ(s);
      return;
    }
    location.hash = `#/s/${encodeURIComponent(s)}`;
  };
  const submit = (e) => {
    e.preventDefault();
    go(q);
  };
  const more = async () => {
    if (!data?.cont) return;
    setBusy(true);
    try {
      const d = await fn('search', { q: q0, cont: data.cont });
      rememberHits(d.videos);
      rememberHits(shortHits(d.shorts));
      const nd = { ...data, videos: [...data.videos, ...d.videos.filter((v) => !data.videos.some((x) => x.id === v.id))], cont: d.cont };
      searchCache.set(q0, nd);
      setData(nd);
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  const vids = (data?.videos || []).map(fromHit);
  const shorts = shortHits(data?.shorts);
  const ids = vids.filter((v) => !v.live).map((v) => v.id);
  const items = shorts.length ? [...vids.slice(0, 2), { kind: 'shorts', id: '__shorts' }, ...vids.slice(2)] : vids;
  const histRows = typing ? hist.filter((h) => !q.trim() || h.includes(q.trim())).slice(0, q.trim() ? 3 : 15) : [];
  const sugRows = sug.filter((s) => !histRows.includes(s));
  return html`<div class="page">
    <form class="top search-top" onSubmit=${submit}>
      <button type="button" class="ib" aria-label="戻る" onClick=${goBack}><${Icon} d=${I.back} /></button>
      <div class="search-box">
        <input ref=${inputRef} class="field search-field" type="search" enterkeyhint="search" autocomplete="off" placeholder="YouTube を検索"
          value=${q} onInput=${(e) => { setQ(e.target.value); setTyping(true); }} onFocus=${() => setTyping(true)} />
        ${q && html`<button type="button" class="ib sm search-clear" aria-label="消す" onClick=${() => { setQ(''); setTyping(true); inputRef.current?.focus(); }}><${Icon} d=${P.IC.close} size=${20} /></button>`}
      </div>
      <button class="ib" aria-label="検索"><${Icon} d=${I.search} /></button>
    </form>
    ${typing
      ? html`<div class="hist">
          ${histRows.map((h) => html`<div key=${'h' + h} class="hist-row">
            <a href=${`#/s/${encodeURIComponent(h)}`} onClick=${(e) => { e.preventDefault(); go(h); }}><${Icon} d=${I.history} size=${22} /><span>${h}</span></a>
            <button class="ib sm" aria-label="入力欄に入れる" onClick=${() => { setQ(h); inputRef.current?.focus(); }}><${Icon} d=${I.fill} size=${20} /></button>
          </div>`)}
          ${sugRows.map((s) => html`<div key=${'s' + s} class="hist-row">
            <a href=${`#/s/${encodeURIComponent(s)}`} onClick=${(e) => { e.preventDefault(); go(s); }}><${Icon} d=${I.search} size=${22} /><span>${s}</span></a>
            <button class="ib sm" aria-label="入力欄に入れる" onClick=${() => { setQ(s + ' '); inputRef.current?.focus(); }}><${Icon} d=${I.fill} size=${20} /></button>
          </div>`)}
          ${!q.trim() && hist.length > 0 && html`<div class="center"><button class="link" onClick=${() => { if (confirm('検索履歴をすべて消しますか?')) { setHist([]); lsSetJson(SEARCHES, []); } }}>検索履歴を消す</button></div>`}
        </div>`
      : html`
        ${err && html`<p class="err pad">${err}</p>`}
        ${busy && !data && html`<div class="loading"><span class="spinner"></span></div>`}
        ${data && html`
          ${(data.channels || []).map((c) => html`<div class="pad-x" key=${c.id}><${ChannelRow} c=${c} /></div>`)}
          <div class="grid">${items.map((v) =>
            v.kind === 'shorts' ? html`<div class="grid-full" key="__shorts"><${ShortsShelf} items=${shorts} /></div>` : html`<${VideoCard} key=${v.id} v=${v} queue=${ids} />`)}</div>
          ${vids.length === 0 && !(data.channels || []).length && !shorts.length && html`<${Empty}>見つかりませんでした</${Empty}>`}
          ${data.cont && html`<div class="center"><button class="btn ghost" disabled=${busy} onClick=${more}>${busy ? '読み込み中…' : 'もっと見る'}</button></div>`}
        `}
      `}
  </div>`;
}

// ------------------------------------------------------------------ 再生画面
const comCache = new Map(); // 動画ID → { items, cont, count, busy }
function useComments(id, detail) {
  const [, force] = useState(0);
  const c = comCache.get(id);
  const loadMore = async () => {
    const cur = comCache.get(id) || { items: [], cont: detail?.comments?.cont || '', count: detail?.comments?.count || '' };
    if (cur.busy || !cur.cont) return;
    cur.busy = true;
    comCache.set(id, cur);
    force((x) => x + 1);
    try {
      const r = await fn('comments', { cont: cur.cont });
      cur.items = [...cur.items, ...(r.items || []).filter((x) => !cur.items.some((y) => y.id === x.id))];
      cur.cont = r.cont || '';
    } catch (e) {
      cur.err = e.message;
      cur.cont = '';
    } finally {
      cur.busy = false;
      force((x) => x + 1);
    }
  };
  useEffect(() => {
    if (detail?.comments?.cont && !comCache.has(id)) loadMore();
  }, [id, detail]);
  if (comCache.size > 30) comCache.delete(comCache.keys().next().value);
  return { ...(c || { items: [], cont: '', busy: false }), count: detail?.comments?.count || '', loadMore };
}

function Comment({ c }) {
  return html`<div class="cm">
    <${Avatar} src=${c.avatar} title=${c.author} size=${28} />
    <div class="cm-body">
      <div class="cm-head"><span class=${clsx(c.owner && 'cm-owner')}>${c.author}</span> ・ ${c.when}</div>
      <div class="cm-text">${c.text}</div>
      <div class="cm-foot"><${Icon} d=${I.like} size=${16} /><span>${c.likes || ''}</span>${c.replies && html`<span class="cm-rep">返信 ${c.replies} 件</span>`}</div>
    </div>
  </div>`;
}

function Sentinel({ onSee }) {
  const ref = useRef(null);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && onSee(), { rootMargin: '400px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [onSee]);
  return html`<div ref=${ref} class="more-sentinel"></div>`;
}

function Panel({ title, sub, onClose, children }) {
  return html`<div class="panel">
    <div class="panel-grip"></div>
    <div class="panel-h"><b>${title}</b>${sub && html`<span class="panel-sub">${sub}</span>`}<span class="sp"></span>
      <button class="ib" aria-label="閉じる" onClick=${onClose}><${Icon} d=${P.IC.close} /></button></div>
    <div class="panel-b">${children}</div>
  </div>`;
}

export function Watch({ id }) {
  const [detail, setDetail] = useState(() => videoDetail(id) || null);
  const [err, setErr] = useState('');
  const [panel, setPanel] = useState(null); // 'desc' | 'comments'
  const later = useStore((s) => s.later.some((l) => l.id === id));
  const wide = useWide(1000);
  useStore((s) => s.channels); // 登録の変化で描き直す
  useEffect(() => {
    const q = nextQueue;
    nextQueue = null;
    // 一覧から開いたときだけ、その一覧を「続けて再生する順番」にする(自動で次へ・小さい窓から戻ったときは今の順番のまま)
    P.load(id, q ? { queue: q } : {});
    scrollTo(0, 0);
    setPanel(null);
    setErr('');
    const c = videoDetail(id);
    setDetail(c || null);
    if (!c) {
      let off = false;
      fn('video', { id })
        .then((d) => {
          rememberDetail(id, d);
          if (P.getPs().id === id) P.mediaMeta();
          rememberHits(d.related);
          if (!off) setDetail(d);
        })
        .catch((e) => !off && setErr(e.message));
      return () => { off = true; };
    }
  }, [id]);
  const com = useComments(id, detail);
  const info = videoInfo(id);
  const ch = { id: detail?.channel?.id || info.chId, title: detail?.channel?.title || info.cht, avatar: detail?.channel?.avatar || info.avatar };
  const rel = (detail?.related || []).map(fromHit);
  const relIds = rel.filter((v) => !v.live).map((v) => v.id);
  const share = async () => {
    const url = watchUrl(id);
    try {
      if (navigator.share) await navigator.share({ title: info.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('リンクをコピーしました');
      }
    } catch (_) { /* やめた */ }
  };
  const desc = detail?.desc || '';
  const views = detail?.vtxt || info.vtxt || fmtViews(info.views);
  const when = detail?.ptxt || info.ptxt || (info.pub ? ago(info.pub) : '');
  const title = info.title || detail?.title || '読み込み中…';
  const first = com.items[0];
  return html`<div class="watch">
    <div class="w-spacer"></div>
    <div class="w-main">
      <div class="w-info">
        <div class="w-tap" onClick=${() => setPanel('desc')}>
          <h1 class="w-title">${title}</h1>
          <div class="w-meta">${[views, when].filter(Boolean).join('  ')} <b>…さらに表示</b></div>
        </div>
        <div class="w-ch">
          <a class="w-ch-main" href=${ch.id ? `#/c/${ch.id}` : null}>
            <${Avatar} src=${ch.avatar} title=${ch.title} size=${36} />
            <span class="w-ch-t">${ch.title}</span>
            <span class="w-ch-s">${(detail?.channel?.subs || '').replace('チャンネル登録者数 ', '')}</span>
          </a>
          <${SubButton} ch=${ch} small />
        </div>
        <div class="w-actions">
          <button class=${clsx('pill', later && 'on')} onClick=${() => toggleLater(info)}><${Icon} d=${later ? I.saved : I.save} size=${20} />${later ? '保存済み' : '保存'}</button>
          <button class="pill" onClick=${share}><${Icon} d=${I.share} size=${20} />共有</button>
          <button class="pill" onClick=${() => P.restart()}><${Icon} d=${I.restart} size=${20} />最初から</button>
          <a class="pill" href=${watchUrl(id, P.getPs().time)} target="_blank" rel="noopener"><${Icon} d=${I.open} size=${20} />YouTube で開く</a>
        </div>
        ${(com.count || first) && html`<div class="w-com" onClick=${() => setPanel('comments')}>
          <div class="w-com-h"><b>コメント</b><span>${com.count}</span></div>
          ${first ? html`<div class="w-com-1"><${Avatar} src=${first.avatar} title=${first.author} size=${24} /><span>${first.text}</span></div>`
            : html`<div class="w-com-1 dim">${com.busy ? '読み込み中…' : 'コメントを見る'}</div>`}
        </div>`}
      </div>
      <div class="w-rel">
        ${err && html`<p class="err pad">${err}</p>`}
        ${!detail && !err && html`<div class="loading"><span class="spinner"></span></div>`}
        ${rel.map((v) => html`<${VideoCard} key=${v.id} v=${v} queue=${relIds} variant=${wide ? 'row' : 'big'} />`)}
      </div>
    </div>
    ${panel === 'desc' && html`<${Panel} title="説明" onClose=${() => setPanel(null)}>
      <h2 class="pn-title">${title}</h2>
      <div class="pn-stats">
        <div><b>${(views || '').replace(/\s*回視聴/, '') || '—'}</b><span>回視聴</span></div>
        <div><b>${when || '—'}</b><span>公開</span></div>
      </div>
      ${detail?.channel?.collab && html`<p class="note">${detail.channel.collab}</p>`}
      <div class="pn-desc">${desc ? splitDesc(desc).map((part, i) =>
        part.t === 'url' ? html`<a key=${i} href=${part.v} target="_blank" rel="noopener">${part.v}</a>`
        : part.t === 'time' ? html`<a key=${i} class="ts" onClick=${() => { P.seekTo(part.sec); setPanel(null); }}>${part.v}</a>`
        : html`<span key=${i}>${part.v}</span>`) : err ? '' : '説明を読み込み中…'}</div>
      <a class="w-ch pn-ch" href=${ch.id ? `#/c/${ch.id}` : null}>
        <${Avatar} src=${ch.avatar} title=${ch.title} size=${40} />
        <div><div class="w-ch-t">${ch.title}</div><div class="w-ch-s">${detail?.channel?.subs || ''}</div></div>
      </a>
    </${Panel}>`}
    ${panel === 'comments' && html`<${Panel} title="コメント" sub=${com.count} onClose=${() => setPanel(null)}>
      <p class="note">コメントは読むだけです(書きこみは YouTube で)。</p>
      ${com.items.map((c) => html`<${Comment} key=${c.id} c=${c} />`)}
      ${com.busy && html`<div class="loading"><span class="spinner"></span></div>`}
      ${com.err && html`<p class="err">${com.err}</p>`}
      ${com.cont && !com.busy && html`<${Sentinel} onSee=${com.loadMore} />`}
    </${Panel}>`}
  </div>`;
}

// ------------------------------------------------------------------ マイページ
export function Me() {
  const progress = useStore((s) => s.progress);
  const later = useStore((s) => s.later);
  const nch = useStore((s) => s.channels.length);
  const err = useStore((s) => s.error);
  const hist = Object.entries(progress).sort((a, b) => new Date(b[1].at) - new Date(a[1].at)).slice(0, 20).map(([id]) => videoInfo(id));
  const lat = later.map((l) => ({ ...videoInfo(l.id), title: l.title || videoInfo(l.id).title }));
  const cont = continueItems(progress, 50);
  const playlists = [
    { key: 'later', title: '後で見る', n: lat.length, first: lat[0], href: '#/later' },
    { key: 'cont', title: '続きから見る', n: cont.length, first: cont[0], onPlay: () => cont[0] && play(cont[0].id, cont.map((v) => v.id)) },
  ];
  return html`<div class="page">
    ${err && html`<p class="err pad">${err}</p>`}
    <div class="me-head">
      <span class="me-av"><${Icon} d=${I.person} size=${40} /></span>
      <div>
        <div class="me-name">あなた</div>
        <a class="me-sub" href="#/channels">登録チャンネル ${nch} ・ チャンネルを表示 <${Icon} d=${I.chev} size=${16} /></a>
      </div>
    </div>
    <div class="chips flat">
      <a class="chip" href="#/add"><${Icon} d=${I.plus} size=${18} />チャンネルを追加</a>
      <button class="chip" onClick=${refreshFeed}><${Icon} d=${I.refresh} size=${18} />新着を取り込む</button>
      <a class="chip" href="#/settings"><${Icon} d=${I.gear} size=${18} />設定</a>
    </div>
    <${Shelf} title="履歴" right=${html`<a class="btn sm outline" href="#/history">すべて表示</a>`}>
      ${hist.length ? hist.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" />`) : html`<p class="note pad-x">まだありません</p>`}
    </${Shelf}>
    <${Shelf} title="再生リスト">
      ${playlists.map((pl) => html`<div key=${pl.key} class="pl" onClick=${() => (pl.href ? (location.hash = pl.href) : pl.onPlay())}>
        <div class="pl-th">
          ${pl.first ? html`<img src=${thumb(pl.first.id, 'mqdefault')} alt="" />` : html`<div class="pl-empty"></div>`}
          <span class="pl-n"><${Icon} d=${I.playlist} size=${16} />${pl.n}</span>
        </div>
        <div class="vsh-title">${pl.title}</div>
        <div class="vsh-sub">${pl.n} 本の動画</div>
      </div>`)}
    </${Shelf}>
    <div class="me-list">
      <a class="li" href="#/history"><${Icon} d=${I.history} /><span>履歴</span></a>
      <a class="li" href="#/later"><${Icon} d=${I.later} /><span>後で見る</span><span class="sp"></span><span class="dim">${lat.length}</span></a>
      <a class="li" href="#/channels"><${Icon} d=${I.subsO} /><span>登録チャンネル</span><span class="sp"></span><span class="dim">${nch}</span></a>
    </div>
    <div class="me-list">
      <a class="li" href="#/settings"><${Icon} d=${I.gear} /><span>設定</span></a>
    </div>
  </div>`;
}

export function Settings() {
  const prefs = useStore((s) => s.prefs);
  return html`<div class="page">
    <h2 class="sec-h">再生</h2>
    <div class="list-box">
      <label class="li"><span>見終わったら次の動画を自動で再生</span><span class="sp"></span><span class="switch"><input type="checkbox" checked=${prefs.autoNext} onChange=${(e) => setPref('autoNext', e.target.checked)} /><i></i></span></label>
      <label class="li"><span>いつもの再生速度</span><span class="sp"></span>
        <select value=${prefs.rate} onChange=${(e) => setPref('rate', Number(e.target.value))}>
          ${[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => html`<option key=${r} value=${r}>${r === 1 ? '標準' : r + 'x'}</option>`)}
        </select>
      </label>
      <div class="li dim"><span>字幕はいつも出さない設定です</span></div>
    </div>
    <h2 class="sec-h">ホーム</h2>
    <div class="list-box">
      <label class="li"><span>ホームにショートを出す</span><span class="sp"></span><span class="switch"><input type="checkbox" checked=${prefs.shorts} onChange=${(e) => setPref('shorts', e.target.checked)} /><i></i></span></label>
      <label class="li"><span>見終わった動画をホームで薄くする</span><span class="sp"></span><span class="switch"><input type="checkbox" checked=${prefs.hideWatched} onChange=${(e) => setPref('hideWatched', e.target.checked)} /><i></i></span></label>
      <label class="li"><span>けさの便の時刻</span><span class="sp"></span>
        <select value=${prefs.morningHour} onChange=${(e) => setPref('morningHour', Number(e.target.value))}>
          ${[4, 5, 6, 7, 8, 9].map((h) => html`<option key=${h} value=${h}>${h}:00</option>`)}
        </select>
      </label>
    </div>
    <${HowTo} />
    <h2 class="sec-h">データ</h2>
    <div class="list-box">
      <button class="li" onClick=${refreshFeed}><${Icon} d=${I.refresh} /><span>新着をいますぐ取り込む</span></button>
      <button class="li" onClick=${exportData}><${Icon} d=${I.download} /><span>データを書き出す(JSON)</span></button>
      <button class="li" onClick=${() => { if (confirm('この端末の合言葉を消して、入れ直しますか?')) { setKey(''); setState({ needKey: true }); } }}><${Icon} d=${I.person} /><span>合言葉を入れ直す</span></button>
    </div>
    <div class="about">
      <p>つづきから v${window.TZ_VERSION || ''}</p>
      <p>動画は YouTube 公式の埋め込みプレーヤーで流しています。字幕はいつも出さず、途中で止めた位置は自動で覚えて、次に開くとそこから再開します(スマホとパソコンで共有)。</p>
      <p>広告を消す仕組みは入れていません(YouTube の決まりで禁止のため)。広告をふせぎたいときは、広告ブロックつきのブラウザ(Brave など)でこのページを開いてください。</p>
    </div>
  </div>`;
}

// 開いているブラウザに合わせた使い方(全画面・画面を消して聴く)
function HowTo() {
  const [brave, setBrave] = useState(false);
  useEffect(() => {
    try { navigator.brave?.isBrave?.().then((b) => setBrave(!!b)).catch(() => {}); } catch (_) { /* 何もしない */ }
  }, []);
  const where = P.STANDALONE ? 'ホーム画面のアイコン' : brave ? 'Brave' : /CriOS/.test(navigator.userAgent) ? 'Chrome' : 'ブラウザ';
  return html`<h2 class="sec-h">使い方のこつ</h2>
    <div class="list-box howto">
      <div class="li"><span>いま開いている場所</span><span class="sp"></span><b>${where}</b></div>
      <div class="li col"><b>上のバーを消して全画面にする</b>
        <span>${P.IOS && !P.STANDALONE ? 'iPhone の Chrome・Brave では、ページから上のバーを消せません(Apple の決まり)。Brave・Chrome の共有メニュー →「ホーム画面に追加」で作ったアイコンから開くと、バーのない全画面になります。' : '動画の右下の全画面ボタン、またはスマホを横にすると全画面になります。'}</span></div>
      <div class="li col"><b>画面を消しても音を流す(バックグラウンド再生)</b>
        <span>Brave: 設定 → 「メディア」の「バックグラウンド再生(Background Audio)」をオンにすると、Brave で開いたときに画面を消しても続きます。</span>
        <span>Chrome・ホーム画面のアイコン: 画面を消すと止まります。ロック画面やコントロールセンターの ▶ を押すと、続きから流れることがあります。</span></div>
    </div>`;
}

export function HistoryPage() {
  const progress = useStore((s) => s.progress);
  const entries = Object.entries(progress).sort((a, b) => new Date(b[1].at) - new Date(a[1].at));
  const groups = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const [id, p] of entries) {
    const d = new Date(p.at);
    d.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / 864e5);
    const label = diff === 0 ? '今日' : diff === 1 ? '昨日' : fmtDay(d);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push({ ...videoInfo(id), p });
  }
  if (!entries.length) return html`<${Empty}>まだ何も見ていません</${Empty}>`;
  return html`<div class="page">
    <${Paged} step=${6} items=${groups} render=${(g) => html`<section key=${g.label}>
      <h2 class="sec-h">${g.label}</h2>
      ${g.items.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="row"
        extra=${html`<div class="vr-prog">${v.p.done ? '見終わった' : `${fmtTime(v.p.pos)}${v.p.dur ? ' / ' + fmtTime(v.p.dur) : ''} まで`}</div>`} />`)}
    </section>`} />
  </div>`;
}

export function LaterPage() {
  const later = useStore((s) => s.later);
  const items = later.map((l) => ({ ...videoInfo(l.id), title: l.title || videoInfo(l.id).title, cht: l.cht || videoInfo(l.id).cht }));
  const ids = items.filter((v) => !v.short).map((v) => v.id);
  if (!items.length) return html`<${Empty}>「後で見る」は空です。動画の「⋮」から保存できます</${Empty}>`;
  return html`<div class="page">
    <div class="pl-head">
      <div class="pl-head-th">${items[0] && html`<img src=${thumb(items[0].id, 'hqdefault')} alt="" />`}</div>
      <h1>後で見る</h1>
      <p class="note">${items.length} 本の動画</p>
      <button class="btn wide light" onClick=${() => ids[0] && play(ids[0], ids)}><${Icon} d=${P.IC.play} size=${20} />すべて再生</button>
    </div>
    ${items.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="row" queue=${ids} />`)}
  </div>`;
}

// ------------------------------------------------------------------ 合言葉
export function KeyGate() {
  const [k, setK] = useState('');
  const [busy, setBusy] = useState(false);
  const err = useStore((s) => s.error);
  const [msg, setMsg] = useState('');
  const go = async (e) => {
    e.preventDefault();
    if (!k.trim()) return;
    setBusy(true);
    setMsg('');
    setKey(k.trim());
    const r = await load();
    setBusy(false);
    if (r === 'bad') {
      setKey('');
      setMsg('合言葉がちがうようです');
    } else if (r === 'error') {
      setMsg(`つながりませんでした(${getState().error || '通信エラー'})。もう一度「はじめる」を押してください`);
    }
  };
  return html`<div class="gate">
    <img src="icons/icon-192.png" alt="" class="gate-ic" />
    <h1>つづきから</h1>
    <p>じぶんノート・就活アプリと同じ合言葉を入れてください。</p>
    <form onSubmit=${go}>
      <input class="field" type="password" autocomplete="current-password" placeholder="合言葉" value=${k} onInput=${(e) => setK(e.target.value)} />
      <button class="btn" disabled=${busy}>${busy ? '確かめています…' : 'はじめる'}</button>
    </form>
    ${(msg || err) && html`<p class="err">${msg || err}</p>`}
  </div>`;
}
