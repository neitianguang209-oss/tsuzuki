import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { html, noteRoute } from './util.js';
import { takeKeyFromUrl } from './api.js';
import { useStore, load, getState, setState, refreshFeed } from './store.js';
import { PlayerShell, setMode, getPs, close as closePlayer } from './player.js';
import { TopBar, BottomNav, Home, Subs, Channels, AddChannel, ChannelPage, Search, Watch, Me, Settings, HistoryPage, LaterPage, KeyGate, Sheet, ShortsPage } from './views.js';

window.TZ_VERSION = '1.3.0';
takeKeyFromUrl();

function dec(x) {
  try {
    return decodeURIComponent(x);
  } catch (_) {
    return x; // 壊れた % があっても画面が真っ白にならないように
  }
}
function parse(hash) {
  const h = (hash || '').replace(/^#/, '') || '/';
  const seg = h.split('/').filter(Boolean).map(dec);
  const [a, b] = seg;
  if (!a) return { name: 'home', tab: 'home' };
  if (a === 'w' && b) return { name: 'watch', id: b };
  if (a === 'shorts') return { name: 'shorts', tab: 'shorts', id: b || '' };
  if (a === 'settings') return { name: 'settings', tab: 'me', title: '設定' };
  if (a === 'subs') return { name: 'subs', tab: 'subs', chId: b || '' };
  if (a === 'channels') return { name: 'channels', tab: 'subs', title: '登録チャンネル' };
  if (a === 'add') return { name: 'add', tab: 'subs', title: 'チャンネルを追加' };
  if (a === 'c' && b) return { name: 'channel', tab: 'subs', id: b };
  if (a === 's') return { name: 'search', q: seg.slice(1).join('/') };
  if (a === 'me') return { name: 'me', tab: 'me' };
  if (a === 'history') return { name: 'history', tab: 'me', title: '履歴' };
  if (a === 'later') return { name: 'later', tab: 'me', title: 'あとで見る' };
  return { name: 'home', tab: 'home' };
}

function useRoute() {
  const [r, setR] = useState(() => parse(location.hash));
  useEffect(() => {
    noteRoute(location.hash || '#/', location.hash.startsWith('#/w/'));
    const on = () => {
      noteRoute(location.hash || '#/', location.hash.startsWith('#/w/'));
      setR(parse(location.hash));
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

// 一番上で下に引っぱると新着を取り込む(YouTube アプリと同じ)
function PullRefresh() {
  const refreshing = useStore((s) => s.refreshing);
  const [pull, setPull] = useState(0);
  useEffect(() => {
    let y0 = null;
    let d = 0;
    const down = (e) => {
      y0 = scrollY <= 0 && !e.target.closest('.shelf-row, .chips, .ch-strip, .ph, .sheet') ? e.touches[0].clientY : null;
      d = 0;
    };
    const move = (e) => {
      if (y0 == null) return;
      d = e.touches[0].clientY - y0;
      if (d > 0 && scrollY <= 0) setPull(Math.min(110, d * 0.5));
      else setPull(0);
    };
    const up = () => {
      if (y0 != null && d * 0.5 >= 64) refreshFeed();
      y0 = null;
      setPull(0);
    };
    addEventListener('touchstart', down, { passive: true });
    addEventListener('touchmove', move, { passive: true });
    addEventListener('touchend', up);
    addEventListener('touchcancel', up);
    return () => {
      removeEventListener('touchstart', down);
      removeEventListener('touchmove', move);
      removeEventListener('touchend', up);
      removeEventListener('touchcancel', up);
    };
  }, []);
  if (!pull && !refreshing) return null;
  const y = refreshing ? 64 : pull;
  return html`<div class="ptr" style=${{ transform: `translate(-50%, ${y}px)`, opacity: refreshing ? 1 : Math.min(1, pull / 64) }}>
    <span class=${refreshing ? 'spinner' : 'ptr-arrow'} style=${refreshing ? null : { transform: `rotate(${pull * 3}deg)` }}></span>
  </div>`;
}

// 下へスクロールすると上のバーが隠れ、上へ戻すと出てくる(YouTube アプリと同じ)
let lastY = 0;
addEventListener('scroll', () => {
  const y = scrollY;
  const r = document.body.dataset.route;
  if (r === 'watch' || r === 'shorts' || r === 'search') return;
  if (y > lastY + 6 && y > 120) document.body.classList.add('hide-top');
  else if (y < lastY - 6 || y < 60) document.body.classList.remove('hide-top');
  lastY = y;
}, { passive: true });

function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return html`<div class="toast" key=${t.id}>${t.msg}</div>`;
}

function App() {
  const route = useRoute();
  const needKey = useStore((s) => s.needKey);
  const booted = useStore((s) => s.booted);
  const routeTitle = useStore((s) => s.routeTitle);
  const offline = useStore((s) => s.offline);

  // 再生画面を離れたら、プレーヤーは小さい窓になる。ショートは画面を離れたら止める
  useEffect(() => {
    const ps = getPs();
    if (ps.id && ps.mode === 'short' && route.name !== 'shorts') closePlayer();
    else if (route.name !== 'watch' && ps.id && ps.mode === 'full') setMode('mini');
    document.body.dataset.route = needKey ? 'gate' : route.name;
    document.body.classList.remove('hide-top');
  }, [route.name, needKey]);
  // 合言葉の画面に入るときは、流していた動画を止める(プレーヤーの箱は外さない)
  useEffect(() => {
    if (needKey && getPs().id) closePlayer();
  }, [needKey]);

  let page;
  switch (needKey ? 'gate' : route.name) {
    case 'gate': page = html`<${KeyGate} />`; break;
    case 'watch': page = html`<${Watch} id=${route.id} />`; break;
    case 'subs': page = html`<${Subs} chId=${route.chId} />`; break;
    case 'channels': page = html`<${Channels} />`; break;
    case 'add': page = html`<${AddChannel} />`; break;
    case 'channel': page = html`<${ChannelPage} key=${route.id} id=${route.id} />`; break;
    case 'search': page = html`<${Search} q=${route.q} />`; break;
    case 'me': page = html`<${Me} />`; break;
    case 'settings': page = html`<${Settings} />`; break;
    case 'shorts': page = html`<${ShortsPage} key=${'shorts'} id=${route.id} />`; break;
    case 'history': page = html`<${HistoryPage} />`; break;
    case 'later': page = html`<${LaterPage} />`; break;
    default: page = html`<${Home} />`;
  }
  const title = route.name === 'channel' ? routeTitle || 'チャンネル' : route.title;
  return html`<div class="app">
    ${!needKey && html`<${TopBar} route=${{ ...route, title }} />`}
    ${offline && !needKey && html`<div class="offline">オフラインです。前回の内容を表示しています</div>`}
    ${!needKey && (route.name === 'home' || route.name === 'subs') && html`<${PullRefresh} />`}
    <main class="main">${!needKey && !booted && !getState().channels.length ? html`<div class="loading"><span class="spinner"></span></div>` : page}</main>
    <${PlayerShell} />
    ${!needKey && html`<${BottomNav} route=${route} />`}
    <${Sheet} />
    <${Toast} />
  </div>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);

load();
// しばらく閉じていたら、開き直したときに読み込み直す
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3) {
    // 読み込み直している間に動画を開くと、ほかの端末で見た位置より古い位置から流してしまうので、その間だけ待ってもらう
    setState({ resyncing: true });
    load({ quiet: true, after: true }).finally(() => setState({ resyncing: false }));
  }
});

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
