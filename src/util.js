import React from 'react';
import htm from 'htm';

export const html = htm.bind(React.createElement);

export const thumb = (id, q = 'hqdefault') => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
export const watchUrl = (id, t = 0) => `https://www.youtube.com/watch?v=${id}${t > 5 ? `&t=${Math.floor(t)}s` : ''}`;

// 秒 → 「12:34」「1:02:03」
export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// 回数 → 「12万 回視聴」
export function fmtViews(n) {
  n = Number(n) || 0;
  if (!n) return '';
  if (n >= 1e8) return `${trim1(n / 1e8)}億 回視聴`;
  if (n >= 1e4) return `${trim1(n / 1e4)}万 回視聴`;
  return `${n.toLocaleString('ja-JP')} 回視聴`;
}
const trim1 = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();

// 日時 → 「3 時間前」
export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)} 分前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 時間前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 日前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400 / 7)} 週間前`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)} か月前`;
  return `${Math.floor(s / 86400 / 365)} 年前`;
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export const fmtDay = (d) => `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;

// 「けさの便」: 毎朝 hour 時に、前の日の hour 時からの新着をひとまとめにする
export function morningWindow(hour = 6, now = new Date()) {
  const end = new Date(now);
  end.setHours(hour, 0, 0, 0);
  if (now < end) end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return { start, end };
}

// アプリの中で移った画面の並び(「戻る」でアプリの外へ出ないため)
export const nav = { stack: [], lastNonWatch: '#/' };
export function noteRoute(hash, isWatch) {
  const h = hash || '#/';
  const s = nav.stack;
  if (s.length >= 2 && s[s.length - 2] === h) s.pop();
  else if (s[s.length - 1] !== h) s.push(h);
  if (s.length > 50) s.shift();
  if (!isWatch) nav.lastNonWatch = h;
}
export function goBack() {
  if (nav.stack.length > 1) history.back();
  else location.hash = '#/';
}
// 再生画面を小さくする: ひとつ前が再生画面以外ならそこへ戻る。そうでなければ最後に見ていた一覧へ
export function leaveWatch() {
  const s = nav.stack;
  const prev = s[s.length - 2];
  if (prev && !prev.startsWith('#/w/')) history.back();
  else location.hash = nav.lastNonWatch || '#/';
}

export function clsx(...a) {
  return a.filter(Boolean).join(' ');
}

// 説明文の URL と 時刻(1:23)を押せるように分ける
export function splitDesc(text) {
  const out = [];
  const re = /(https?:\/\/[^\s<>"'）)」]+)|(?<![\d:])(\d{1,2}:\d{2}(?::\d{2})?)(?![\d:])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: 'url', v: m[1] });
    else out.push({ t: 'time', v: m[2], sec: m[2].split(':').map(Number).reduce((a, x) => a * 60 + x, 0) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

export function lsGetJson(k, fallback) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
export function lsSetJson(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

// 時計の帯(ステータスバー)の色: 再生画面・全画面のときだけ黒に(ホーム画面のアイコンで効く。ブラウザでは何も変わらないこともある)
const themeOrig = new Map();
export function setThemeBlack(on) {
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    if (!themeOrig.has(m)) themeOrig.set(m, m.getAttribute('content'));
    m.setAttribute('content', on ? '#000000' : themeOrig.get(m));
  }
}

// 説明欄の曲目・チャプター(0:00 から始まり、3つ以上あるときだけ)→ [{ sec, title }]
export function parseChapters(desc) {
  if (!desc) return [];
  const out = [];
  for (const line of String(desc).split('\n')) {
    const m = line.match(/(^|[\s(\[【「])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/);
    if (!m) continue;
    const sec = m[2].split(':').map(Number).reduce((a, x) => a * 60 + x, 0);
    const title = line.replace(m[2], '').replace(/^[\s\-–—・|:：.)\]】」]+|[\s\-–—・|:：(\[【「]+$/g, '').trim();
    out.push({ sec, title: title || m[2] });
  }
  if (out.length < 3 || out[0].sec !== 0) return [];
  for (let i = 1; i < out.length; i++) if (out[i].sec <= out[i - 1].sec) return [];
  return out;
}
