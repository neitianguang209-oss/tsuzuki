import React, { useEffect, useMemo, useRef, useState } from 'react';
import { html, thumb, watchUrl, fmtTime, fmtViews, ago, fmtDay, morningWindow, clsx, splitDesc, lsGetJson, lsSetJson } from './util.js';
import {
  useStore, getState, setState, toast, setPref, load, refreshFeed, toggleLater, isLater, hideVideo, deleteHistory,
  subscribeChannel, subscribeByUrl, unsubscribeChannel, exportData, videoInfo, videoDetail, rememberDetail, rememberHits, chById,
} from './store.js';
import { fn, setKey, getKey } from './api.js';
import * as P from './player.js';

const Icon = ({ d, size = 24 }) => html`<svg viewBox="0 0 24 24" width=${size} height=${size} aria-hidden="true"><path d=${d} fill="currentColor" /></svg>`;
const I = {
  home: 'M12 3 3 10.2V21h6.5v-6h5v6H21V10.2z',
  subs: 'M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2zm-6 4-6-3.27v6.53L16 16z',
  me: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-3.3 0-9 1.7-9 5v2h18v-2c0-3.3-5.7-5-9-5z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  more: P.IC.more,
  later: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A3 3 0 1 0 6 15c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z',
  restart: 'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  hide: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4 12a8 8 0 0 1 12.9-6.32L5.68 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.68L18.32 7.1A8 8 0 0 1 12 20z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  sun: 'M6.76 4.84 4.96 3.05 3.55 4.46l1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zM17.24 18.16l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91 1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
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

let nextQueue = null;
export function play(id, queue) {
  nextQueue = queue || null;
  location.hash = `#/w/${id}`;
}

function Avatar({ src, title, size = 36, onClick }) {
  const [bad, setBad] = useState(false);
  const letter = (title || '?').trim().slice(0, 1);
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
    ${v.live ? html`<span class="badge live">ライブ</span>` : v.dur ? html`<span class="badge">${fmtTime(v.dur)}</span>` : null}
    ${p?.done && html`<span class="badge seen">見た</span>`}
    ${pct > 0 && html`<div class="th-bar"><i style=${{ width: pct + '%' }}></i></div>`}
  </div>`;
}

function VideoCard({ v, queue, variant = 'big', menu = true, extra }) {
  const p = useStore((s) => s.progress[v.id]);
  const dim = useStore((s) => s.prefs.hideWatched) && p?.done && variant === 'big';
  const meta = [variant !== 'big' || !v.avatar ? v.cht : v.cht, v.vtxt, v.ptxt].filter(Boolean);
  const open = () => play(v.id, queue);
  if (variant === 'short') {
    return html`<div class="vs" onClick=${open}>
      <${Thumb} v=${v} />
      <div class="vs-title">${v.title}</div>
    </div>`;
  }
  if (variant === 'shelf') {
    return html`<div class="vsh" onClick=${open}>
      <${Thumb} v=${v} small />
      <div class="vsh-title">${v.title}</div>
      <div class="vsh-sub">${v.cht}</div>
    </div>`;
  }
  if (variant === 'row') {
    return html`<div class="vr">
      <div class="vr-th" onClick=${open}><${Thumb} v=${v} small /></div>
      <div class="vr-body" onClick=${open}>
        <div class="vr-title">${v.title || '(題名なし)'}</div>
        <div class="vr-meta">${meta.join(' ・ ')}</div>
        ${extra}
      </div>
      ${menu && html`<button class="ib sm" aria-label="メニュー" onClick=${() => openSheet(v)}><${Icon} d=${I.more} size=${20} /></button>`}
    </div>`;
  }
  return html`<div class=${clsx('vb', dim && 'dim')}>
    <div onClick=${open}><${Thumb} v=${v} /></div>
    <div class="vb-info">
      <${Avatar} src=${v.avatar} title=${v.cht} onClick=${() => v.chId && (location.hash = `#/c/${v.chId}`)} />
      <div class="vb-text" onClick=${open}>
        <div class="vb-title">${v.title}</div>
        <div class="vb-meta">${[v.cht, v.vtxt, v.ptxt].filter(Boolean).join(' ・ ')}</div>
      </div>
      ${menu && html`<button class="ib sm" aria-label="メニュー" onClick=${() => openSheet(v)}><${Icon} d=${I.more} size=${20} /></button>`}
    </div>
  </div>`;
}

// 少しずつ表示を足す一覧
function Paged({ items, render, step = 24 }) {
  const [n, setN] = useState(step);
  const ref = useRef(null);
  useEffect(() => setN(step), [items, step]);
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(watchUrl(v.id));
      toast('リンクをコピーしました');
    } catch (_) {
      toast('コピーできませんでした');
    }
    done();
  };
  return html`<div class="sheet-bg" onClick=${done}>
    <div class="sheet" onClick=${(e) => e.stopPropagation()}>
      <div class="sheet-grip"></div>
      <div class="sheet-title">${info.title}</div>
      <button class="sheet-i" onClick=${() => { toggleLater(info); done(); }}><${Icon} d=${later ? I.check : I.later} />${later ? '「あとで見る」から外す' : 'あとで見る'}</button>
      ${info.chId && html`<button class="sheet-i" onClick=${() => { location.hash = `#/c/${info.chId}`; done(); }}><${Icon} d=${I.person} />チャンネルへ行く</button>`}
      ${inFeed && html`<button class="sheet-i" onClick=${() => { hideVideo(v.id); toast('ホームに出さないようにしました'); done(); }}><${Icon} d=${I.hide} />興味なし(ホームに出さない)</button>`}
      ${inHist && html`<button class="sheet-i" onClick=${() => { deleteHistory(v.id); done(); }}><${Icon} d=${I.trash} />履歴から消す(続きの位置も消えます)</button>`}
      <a class="sheet-i" href=${watchUrl(v.id)} target="_blank" rel="noopener" onClick=${done}><${Icon} d=${I.open} />YouTubeで開く</a>
      <button class="sheet-i" onClick=${copy}><${Icon} d=${I.share} />リンクをコピー</button>
      <button class="sheet-i cancel" onClick=${done}>閉じる</button>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ 上のバー・下のタブ
export function TopBar({ route }) {
  const refreshing = useStore((s) => s.refreshing);
  const syncing = useStore((s) => s.syncing);
  const main = route.name === 'home' || route.name === 'subs' || route.name === 'me';
  if (route.name === 'watch') return null;
  if (route.name === 'search') return null;
  if (!main) {
    return html`<header class="top">
      <button class="ib" aria-label="戻る" onClick=${() => (history.length > 1 ? history.back() : (location.hash = '#/'))}><${Icon} d=${I.back} /></button>
      <div class="top-title">${route.title || ''}</div>
      <span class="sp"></span>
      <button class="ib" aria-label="検索" onClick=${() => (location.hash = '#/s/')}><${Icon} d=${I.search} /></button>
    </header>`;
  }
  return html`<header class="top">
    <a class="logo" href="#/"><img src="icons/icon-192.png" alt="" /><span>つづきから</span></a>
    <span class="sp"></span>
    <button class=${clsx('ib', (refreshing || syncing) && 'spin')} aria-label="新着を取り込む" onClick=${refreshFeed}><${Icon} d=${I.refresh} /></button>
    <button class="ib" aria-label="検索" onClick=${() => (location.hash = '#/s/')}><${Icon} d=${I.search} /></button>
  </header>`;
}

export function BottomNav({ route }) {
  if (route.name === 'watch') return null;
  const tab = (name, href, icon, label) =>
    html`<a class=${clsx('tab', route.tab === name && 'on')} href=${href}><${Icon} d=${icon} /><span>${label}</span></a>`;
  return html`<nav class="tabs">
    ${tab('home', '#/', I.home, 'ホーム')}
    ${tab('subs', '#/subs', I.subs, '登録チャンネル')}
    ${tab('me', '#/me', I.me, 'マイページ')}
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

function continueItems(progress, limit = 20) {
  return Object.entries(progress)
    .filter(([, p]) => !p.done && p.pos >= 8 && (!p.dur || p.pos < p.dur - 15))
    .sort((a, b) => new Date(b[1].at) - new Date(a[1].at))
    .slice(0, limit)
    .map(([id]) => videoInfo(id));
}

export function Home() {
  const feed = useFeed();
  const prefs = useStore((s) => s.prefs);
  const progress = useStore((s) => s.progress);
  const booted = useStore((s) => s.booted);
  const nch = useStore((s) => s.channels.length);
  const [chip, setChip] = useState(() => sessionStorage.getItem('tz:chip') || 'all');
  useEffect(() => { try { sessionStorage.setItem('tz:chip', chip); } catch (_) {} }, [chip]);

  const long = feed.filter((v) => !v.short);
  const { start, end } = morningWindow(prefs.morningHour);
  const morning = long.filter((v) => { const t = new Date(v.pub); return t >= start && t < end; });
  const morningLeft = morning.filter((v) => !progress[v.id]?.done);
  const shorts = prefs.shorts ? feed.filter((v) => v.short && Date.now() - new Date(v.pub) < 4 * 864e5).slice(0, 20) : [];
  const cont = continueItems(progress);
  const unwatched = long.filter((v) => !progress[v.id]);
  const list = chip === 'morning' ? morning : chip === 'unwatched' ? unwatched : chip === 'continue' ? cont : long;
  const ids = list.filter((v) => !v.live).map((v) => v.id);

  if (booted && !nch) {
    return html`<${Empty}>
      <p>登録チャンネルがまだありません。</p>
      <a class="btn" href="#/add">チャンネルを追加</a>
    </${Empty}>`;
  }
  return html`<div class="page">
    <div class="chips">
      ${[['all', 'すべて'], ['morning', `けさの便${morningLeft.length ? ' ' + morningLeft.length : ''}`], ['unwatched', '未視聴'], ['continue', '続きから']].map(
        ([k, label]) => html`<button key=${k} class=${clsx('chip', chip === k && 'on')} onClick=${() => { setChip(k); scrollTo(0, 0); }}>${label}</button>`,
      )}
    </div>
    ${chip === 'all' && html`
      ${morning.length > 0 && html`<${MorningBox} items=${morning} left=${morningLeft} start=${start} end=${end} />`}
      ${cont.length > 0 && html`<${Shelf} title="続きから">${cont.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" queue=${cont.map((x) => x.id)} />`)}</${Shelf}>`}
      ${shorts.length > 0 && html`<${Shelf} title="ショート">${shorts.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="short" />`)}</${Shelf}>`}
      <h2 class="sec-h">新着</h2>
    `}
    ${chip === 'morning' && html`<div class="morning-head">${fmtDay(end)} ${prefs.morningHour}時の便 ・ ${fmtDay(start).replace(/\(.\)/, '')} ${prefs.morningHour}時から届いた ${morning.length} 本</div>`}
    ${list.length === 0
      ? html`<${Empty}>${chip === 'continue' ? '途中まで見た動画はありません' : chip === 'morning' ? 'けさの便に入った動画はありません' : '動画がありません'}</${Empty}>`
      : html`<div class="grid"><${Paged} items=${list} render=${(v) => html`<${VideoCard} key=${v.id} v=${v} queue=${ids} />`} /></div>`}
  </div>`;
}

function MorningBox({ items, left, start, end }) {
  const hour = useStore((s) => s.prefs.morningHour);
  const ids = items.filter((v) => !v.live).map((v) => v.id);
  const first = left[0] || items[0];
  return html`<section class="morning">
    <div class="morning-top">
      <span class="morning-ic"><${Icon} d=${I.sun} size=${20} /></span>
      <div>
        <div class="morning-t">けさの便</div>
        <div class="morning-s">${fmtDay(end)} ${hour}:00 ・ ${items.length} 本${left.length < items.length ? `(あと ${left.length} 本)` : ''}</div>
      </div>
      <span class="sp"></span>
      ${left.length > 0 && html`<button class="btn sm" onClick=${() => play(first.id, left.filter((v) => !v.live).map((v) => v.id))}>続けて見る</button>`}
    </div>
    <div class="shelf-row">${items.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" queue=${ids} />`)}</div>
  </section>`;
}

// ------------------------------------------------------------------ 登録チャンネル
export function Subs({ chId }) {
  const feed = useFeed();
  const channels = useStore((s) => s.channels);
  const videos = useStore((s) => s.videos);
  const latest = useMemo(() => {
    const m = new Map();
    for (const v of videos) if (!m.has(v.ch)) m.set(v.ch, v.pub);
    return m;
  }, [videos]);
  const sorted = useMemo(
    () => [...channels].sort((a, b) => new Date(latest.get(b.id) || 0) - new Date(latest.get(a.id) || 0)),
    [channels, latest],
  );
  const list = feed.filter((v) => !v.short && (!chId || v.chId === chId));
  const ids = list.map((v) => v.id);
  const sel = chId ? chById(chId) : null;
  return html`<div class="page">
    <div class="ch-strip">
      ${sorted.map((c) => html`<a key=${c.id} class=${clsx('ch-dot', chId === c.id && 'on')} href=${chId === c.id ? '#/subs' : `#/subs/${c.id}`}>
        <${Avatar} src=${c.avatar} title=${c.title} size=${54} />
        <span>${c.title || '…'}</span>
      </a>`)}
      <a class="ch-dot all" href="#/channels"><span class="all-txt">すべて</span></a>
    </div>
    ${sel && html`<div class="sel-ch"><b>${sel.title}</b><span class="sp"></span><a class="btn sm ghost" href=${`#/c/${sel.id}`}>チャンネルを見る</a></div>`}
    ${list.length === 0
      ? html`<${Empty}>動画がありません</${Empty}>`
      : html`<div class="grid"><${Paged} items=${list} render=${(v) => html`<${VideoCard} key=${v.id} v=${v} queue=${ids} />`} /></div>`}
  </div>`;
}

export function Channels() {
  const channels = useStore((s) => s.channels);
  const videos = useStore((s) => s.videos);
  const [q, setQ] = useState('');
  const latest = useMemo(() => {
    const m = new Map();
    for (const v of videos) if (!m.has(v.ch)) m.set(v.ch, v.pub);
    return m;
  }, [videos]);
  const list = channels
    .filter((c) => !q || (c.title || '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ja'));
  return html`<div class="page pad">
    <div class="row gap">
      <input class="field" placeholder="チャンネルを絞り込む" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <a class="btn" href="#/add"><${Icon} d=${I.plus} size=${18} />追加</a>
    </div>
    <p class="note">${channels.length} チャンネル</p>
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

function SubButton({ ch, small }) {
  const subbed = useStore((s) => s.channels.some((c) => c.id === ch.id));
  if (!ch.id) return null;
  return subbed
    ? html`<button class=${clsx('btn ghost', small && 'sm')} onClick=${() => { if (confirm(`「${ch.title}」の登録を解除しますか?`)) unsubscribeChannel(ch.id); }}>登録済み</button>`
    : html`<button class=${clsx('btn dark', small && 'sm')} onClick=${() => subscribeChannel(ch)}>登録</button>`;
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
        chCache.set(key, d);
        setData(d);
      })
      .catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [key]);
  const meta = data?.meta || chCache.get(id + ':videos')?.meta || {};
  const ch = { id, title: meta.title || local?.title || '', avatar: meta.avatar || local?.avatar || '', handle: meta.handle || local?.handle || '' };
  const vids = (data?.videos || []).map((h) => ({ ...fromHit(h), chId: h.chId || id, cht: h.ch || ch.title }));
  const ids = vids.filter((v) => !v.live).map((v) => v.id);
  const loadMore = async () => {
    if (!data?.cont) return;
    setMore(true);
    try {
      const d = await fn('channel', { id, cont: data.cont });
      rememberHits(d.videos);
      const nd = { ...data, videos: [...data.videos, ...d.videos.filter((v) => !data.videos.some((x) => x.id === v.id))], cont: d.cont };
      chCache.set(key, nd);
      setData(nd);
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
      <${Avatar} src=${ch.avatar} title=${ch.title} size=${72} />
      <div class="ch-head-t">${ch.title || '…'}</div>
      <div class="ch-head-s">${[ch.handle, meta.subs].filter(Boolean).join(' ・ ')}</div>
      <${SubButton} ch=${ch} />
    </div>
    <div class="tabs2">
      <button class=${clsx(tab === 'videos' && 'on')} onClick=${() => setTab('videos')}>動画</button>
      <button class=${clsx(tab === 'streams' && 'on')} onClick=${() => setTab('streams')}>ライブ</button>
    </div>
    ${err && html`<p class="err pad">${err}</p>`}
    ${!data && !err && html`<div class="loading">読み込み中…</div>`}
    ${data && vids.length === 0 && html`<${Empty}>動画がありません</${Empty}>`}
    <div class="grid">${vids.map((v) => html`<${VideoCard} key=${v.id} v=${{ ...v, avatar: '' }} queue=${ids} variant="row" />`)}</div>
    ${data?.cont && html`<div class="center"><button class="btn ghost" disabled=${more} onClick=${loadMore}>${more ? '読み込み中…' : 'もっと見る'}</button></div>`}
  </div>`;
}

// ------------------------------------------------------------------ 検索
const SEARCHES = 'tsuzuki:searches';
const searchCache = new Map();
export function Search({ q: q0 }) {
  const [q, setQ] = useState(q0 || '');
  const [data, setData] = useState(() => (q0 ? searchCache.get(q0) : null) || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState(() => lsGetJson(SEARCHES, []));
  const inputRef = useRef(null);
  useEffect(() => {
    setQ(q0 || '');
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
    setBusy(true);
    setErr('');
    fn('search', { q: q0 })
      .then((d) => {
        if (off) return;
        rememberHits(d.videos);
        searchCache.set(q0, d);
        setData(d);
      })
      .catch((e) => !off && setErr(e.message))
      .finally(() => !off && setBusy(false));
    return () => { off = true; };
  }, [q0]);
  const submit = (e) => {
    e.preventDefault();
    const s = q.trim();
    if (!s) return;
    const h = [s, ...hist.filter((x) => x !== s)].slice(0, 15);
    setHist(h);
    lsSetJson(SEARCHES, h);
    inputRef.current?.blur();
    location.hash = `#/s/${encodeURIComponent(s)}`;
  };
  const more = async () => {
    if (!data?.cont) return;
    setBusy(true);
    try {
      const d = await fn('search', { q: q0, cont: data.cont });
      rememberHits(d.videos);
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
  const ids = vids.filter((v) => !v.live).map((v) => v.id);
  return html`<div class="page">
    <form class="top search-top" onSubmit=${submit}>
      <button type="button" class="ib" aria-label="戻る" onClick=${() => (history.length > 1 ? history.back() : (location.hash = '#/'))}><${Icon} d=${I.back} /></button>
      <input ref=${inputRef} class="field search-field" type="search" enterkeyhint="search" placeholder="YouTube を検索" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <button class="ib" aria-label="検索"><${Icon} d=${I.search} /></button>
    </form>
    ${!q0 && html`<div class="hist">
      ${hist.map((h) => html`<div key=${h} class="hist-row">
        <a href=${`#/s/${encodeURIComponent(h)}`}><${Icon} d=${I.history} size=${20} /><span>${h}</span></a>
        <button class="ib sm" aria-label="消す" onClick=${() => { const n = hist.filter((x) => x !== h); setHist(n); lsSetJson(SEARCHES, n); }}><${Icon} d=${P.IC.close} size=${18} /></button>
      </div>`)}
    </div>`}
    ${err && html`<p class="err pad">${err}</p>`}
    ${busy && !data && html`<div class="loading">検索中…</div>`}
    ${data && html`
      ${(data.channels || []).map((c) => html`<div class="pad-x"><${ChannelRow} key=${c.id} c=${c} /></div>`)}
      <div class="grid">${vids.map((v) => html`<${VideoCard} key=${v.id} v=${v} queue=${ids} />`)}</div>
      ${vids.length === 0 && !(data.channels || []).length && html`<${Empty}>見つかりませんでした</${Empty}>`}
      ${data.cont && html`<div class="center"><button class="btn ghost" disabled=${busy} onClick=${more}>${busy ? '読み込み中…' : 'もっと見る'}</button></div>`}
    `}
  </div>`;
}

// ------------------------------------------------------------------ 再生画面
export function Watch({ id }) {
  const [detail, setDetail] = useState(() => videoDetail(id) || null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const autoNext = useStore((s) => s.prefs.autoNext);
  const later = useStore((s) => s.later.some((l) => l.id === id));
  const p = useStore((s) => s.progress[id]);
  useStore((s) => s.channels); // 登録の変化で描き直す
  useEffect(() => {
    const q = nextQueue;
    nextQueue = null;
    P.load(id, q ? { queue: q } : { queue: [] });
    scrollTo(0, 0);
    setOpen(false);
    setErr('');
    const c = videoDetail(id);
    setDetail(c || null);
    if (!c) {
      let off = false;
      fn('video', { id })
        .then((d) => {
          rememberDetail(id, d);
          rememberHits(d.related);
          if (!off) setDetail(d);
        })
        .catch((e) => !off && setErr(e.message));
      return () => { off = true; };
    }
  }, [id]);
  const info = videoInfo(id);
  const ch = { id: detail?.channel?.id || info.chId, title: detail?.channel?.title || info.cht, avatar: detail?.channel?.avatar || info.avatar };
  const rel = (detail?.related || []).map(fromHit);
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
  const meta = [detail?.vtxt || info.vtxt || fmtViews(info.views), detail?.ptxt || info.ptxt || (info.pub ? ago(info.pub) : '')].filter(Boolean).join(' ・ ');
  return html`<div class="watch">
    <div class="w-spacer"></div>
    <div class="w-main">
      <div class="w-info">
        <h1 class="w-title" onClick=${() => setOpen(!open)}>${info.title || detail?.title || '読み込み中…'}</h1>
        <div class="w-meta" onClick=${() => setOpen(!open)}>${meta}${p && !p.done && p.pos > 8 ? ` ・ ${fmtTime(p.pos)} まで見た` : ''} <b>${open ? '閉じる' : '…もっと見る'}</b></div>
        <div class="w-ch">
          <a class="w-ch-main" href=${ch.id ? `#/c/${ch.id}` : null}>
            <${Avatar} src=${ch.avatar} title=${ch.title} size=${40} />
            <div>
              <div class="w-ch-t">${ch.title}</div>
              <div class="w-ch-s">${detail?.channel?.subs || ''}</div>
            </div>
          </a>
          <${SubButton} ch=${ch} small />
        </div>
        <div class="w-actions">
          <button class=${clsx('pill', later && 'on')} onClick=${() => toggleLater(info)}><${Icon} d=${later ? I.check : I.later} size=${18} />あとで見る</button>
          <button class="pill" onClick=${() => P.restart()}><${Icon} d=${I.restart} size=${18} />最初から</button>
          <button class="pill" onClick=${share}><${Icon} d=${I.share} size=${18} />共有</button>
          <a class="pill" href=${watchUrl(id, P.getPs().time)} target="_blank" rel="noopener"><${Icon} d=${I.open} size=${18} />YouTubeで開く</a>
        </div>
        ${open && html`<div class="w-desc">
          ${detail?.channel?.collab && html`<p class="note">${detail.channel.collab}</p>`}
          ${desc ? splitDesc(desc).map((part, i) =>
            part.t === 'url' ? html`<a key=${i} href=${part.v} target="_blank" rel="noopener">${part.v}</a>`
            : part.t === 'time' ? html`<a key=${i} class="ts" onClick=${() => { P.seekTo(part.sec); scrollTo(0, 0); }}>${part.v}</a>`
            : html`<span key=${i}>${part.v}</span>`) : err ? '' : '説明を読み込み中…'}
        </div>`}
      </div>
      <div class="w-rel">
        <div class="w-rel-h">
          <h2>次の動画</h2>
          <span class="sp"></span>
          <label class="switch"><span>自動再生</span><input type="checkbox" checked=${autoNext} onChange=${(e) => setPref('autoNext', e.target.checked)} /><i></i></label>
        </div>
        ${err && html`<p class="err">${err}</p>`}
        ${!detail && !err && html`<div class="loading">読み込み中…</div>`}
        ${rel.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="row" />`)}
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ マイページ
export function Me() {
  const progress = useStore((s) => s.progress);
  const later = useStore((s) => s.later);
  const prefs = useStore((s) => s.prefs);
  const nch = useStore((s) => s.channels.length);
  const err = useStore((s) => s.error);
  const hist = Object.entries(progress).sort((a, b) => new Date(b[1].at) - new Date(a[1].at)).slice(0, 15).map(([id]) => videoInfo(id));
  const lat = later.slice(0, 15).map((l) => ({ ...videoInfo(l.id), title: l.title || videoInfo(l.id).title }));
  return html`<div class="page">
    ${err && html`<p class="err pad">${err}</p>`}
    <${Shelf} title="履歴" right=${html`<a class="link" href="#/history">すべて表示</a>`}>
      ${hist.length ? hist.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" />`) : html`<p class="note pad-x">まだありません</p>`}
    </${Shelf}>
    <${Shelf} title="あとで見る" right=${html`<a class="link" href="#/later">すべて表示</a>`}>
      ${lat.length ? lat.map((v) => html`<${VideoCard} key=${v.id} v=${v} variant="shelf" queue=${lat.map((x) => x.id)} />`) : html`<p class="note pad-x">動画の「…」から入れられます</p>`}
    </${Shelf}>
    <div class="list-box">
      <a class="li" href="#/channels"><${Icon} d=${I.subs} /><span>登録チャンネル</span><span class="sp"></span><span class="dim">${nch}</span></a>
      <a class="li" href="#/add"><${Icon} d=${I.plus} /><span>チャンネルを追加</span></a>
    </div>
    <h2 class="sec-h">設定</h2>
    <div class="list-box">
      <label class="li"><span>ホームにショートを出す</span><span class="sp"></span><span class="switch"><input type="checkbox" checked=${prefs.shorts} onChange=${(e) => setPref('shorts', e.target.checked)} /><i></i></span></label>
      <label class="li"><span>見終わったら次の動画を自動で再生</span><span class="sp"></span><span class="switch"><input type="checkbox" checked=${prefs.autoNext} onChange=${(e) => setPref('autoNext', e.target.checked)} /><i></i></span></label>
      <label class="li"><span>見終わった動画をホームで薄くする</span><span class="sp"></span><span class="switch"><input type="checkbox" checked=${prefs.hideWatched} onChange=${(e) => setPref('hideWatched', e.target.checked)} /><i></i></span></label>
      <label class="li"><span>けさの便の時刻</span><span class="sp"></span>
        <select value=${prefs.morningHour} onChange=${(e) => setPref('morningHour', Number(e.target.value))}>
          ${[4, 5, 6, 7, 8, 9].map((h) => html`<option key=${h} value=${h}>${h}:00</option>`)}
        </select>
      </label>
      <label class="li"><span>いつもの再生速度</span><span class="sp"></span>
        <select value=${prefs.rate} onChange=${(e) => setPref('rate', Number(e.target.value))}>
          ${[0.75, 1, 1.25, 1.5, 1.75, 2].map((r) => html`<option key=${r} value=${r}>${r === 1 ? '標準' : r + 'x'}</option>`)}
        </select>
      </label>
    </div>
    <div class="list-box">
      <button class="li" onClick=${refreshFeed}><${Icon} d=${I.refresh} /><span>新着をいますぐ取り込む</span></button>
      <button class="li" onClick=${exportData}><${Icon} d=${I.open} /><span>データを書き出す(JSON)</span></button>
      <button class="li" onClick=${() => { if (confirm('この端末の合言葉を消して、入れ直しますか?')) { setKey(''); setState({ needKey: true }); } }}><${Icon} d=${I.person} /><span>合言葉を入れ直す</span></button>
    </div>
    <div class="about">
      <p>つづきから v${window.TZ_VERSION || ''}</p>
      <p>動画は YouTube 公式の埋め込みプレーヤーで流しています。字幕はいつも出さず、途中で止めた位置は自動で覚えて、次に開くとそこから再開します(スマホとパソコンで共有)。</p>
      <p>広告を消す仕組みは入れていません(YouTube の決まりで禁止のため)。</p>
    </div>
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
  const ids = items.map((v) => v.id);
  if (!items.length) return html`<${Empty}>「あとで見る」は空です。動画の「…」から入れられます</${Empty}>`;
  return html`<div class="page">
    <div class="pad row"><span class="note">${items.length} 本</span><span class="sp"></span><button class="btn sm" onClick=${() => play(ids[0], ids)}>はじめから続けて再生</button></div>
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
    await load();
    setBusy(false);
    if (getState().needKey) {
      setKey('');
      setMsg('合言葉がちがうようです');
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
