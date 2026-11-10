// おすすめ: 見た履歴から「よく見るチャンネル」を数え、ホームの並びと登録チャンネルの順番に使う。
// それに、最近よく見た動画の「関連動画」から、まだ見ていないものを拾って混ぜる(YouTube のおすすめに近い形)。
// すべて端末の中で計算する(履歴はもともとクラウドと同期しているので、どの端末でも同じ好みになる)。
import { useEffect, useMemo, useState } from 'react';
import { useStore, getState, videoInfo, videoDetail, rememberDetail, rememberHits } from './store.js';
import { fn } from './api.js';
import { lsGetJson, lsSetJson } from './util.js';

const HALF_LIFE_DAYS = 21; // 3週間前に見たものは、今日見たものの半分の重み

// チャンネルごとの「好き度」: 見た本数 × 見た割合 × 新しさ
export function affinityOf(progress, hidden) {
  const m = new Map();
  const now = Date.now();
  for (const [id, p] of Object.entries(progress || {})) {
    const ch = p.ch || videoInfo(id).chId;
    if (!ch) continue;
    const frac = p.done ? 1 : p.dur ? Math.min(1, (p.pos || 0) / p.dur) : 0.3;
    const age = Math.max(0, (now - new Date(p.at || 0).getTime()) / 864e5);
    const w = (0.3 + frac) * Math.pow(0.5, age / HALF_LIFE_DAYS);
    m.set(ch, (m.get(ch) || 0) + w);
  }
  // 「興味なし」にした動画のチャンネルは少し下げる
  for (const id of hidden || []) {
    const ch = videoInfo(id).chId;
    if (ch) m.set(ch, (m.get(ch) || 0) - 0.4);
  }
  return m;
}

// 並べるための「履歴の写し」。再生中は履歴が5秒ごとに変わるので、そのたびに並びが動かないよう、
// 画面を開いたとき・絞り込みを替えたとき・新着が届いたとき・「興味なし」にしたときだけ取り直す
// 動画から戻ったときに並びが入れかわらないよう、写しは画面を作り直しても30分は使い回す
const rankCache = new Map();
export function clearRankCache() {
  rankCache.clear();
}
export function dropRankCache(key) {
  rankCache.delete(key);
}
export function useRankBasis(key = '') {
  const hidden = useStore((s) => s.hidden);
  const nvid = useStore((s) => s.videos.length);
  const booted = useStore((s) => s.booted);
  const fresh = () => {
    const s = { progress: getState().progress, hidden: getState().hidden };
    rankCache.set(key, { snap: s, at: Date.now(), nvid, hidden, booted });
    return s;
  };
  const [snap, setSnap] = useState(() => {
    const c = rankCache.get(key);
    return c && Date.now() - c.at < 30 * 60e3 ? c.snap : fresh();
  });
  useEffect(() => {
    const c = rankCache.get(key);
    if (c && c.nvid === nvid && c.hidden === hidden && c.booted === booted && Date.now() - c.at < 30 * 60e3) {
      if (c.snap !== snap) setSnap(c.snap);
      return;
    }
    setSnap(fresh());
  }, [key, hidden, nvid, booted]);
  return snap;
}

export function useAffinity(basis) {
  return useMemo(() => affinityOf(basis.progress, basis.hidden), [basis]);
}

// 日ごとに少しだけ並びがゆれる(毎回まったく同じ並びにならないように)。同じ日の中では変わらない
function jitter(id) {
  const day = new Date().toDateString();
  let h = 0;
  const s = id + day;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

// 登録チャンネルの新着を「おすすめ順」に並べる
export function rankFeed(list, aff, progress) {
  const now = Date.now();
  const scored = list.map((v) => {
    const hours = Math.max(0, (now - new Date(v.pub || 0).getTime()) / 36e5);
    const fresh = Math.pow(0.5, hours / 36); // 1.5日で半分
    const a = Math.log1p(Math.max(0, aff.get(v.chId) || 0));
    const p = progress[v.id];
    const seen = p ? (p.done ? 1.6 : 0.5) : 0; // 見たものは下へ(途中のものは「続きから見る」の棚にも出る)
    return { v, s: fresh + 0.42 * a - seen + 0.08 * jitter(v.id) };
  });
  scored.sort((x, y) => y.s - x.s);
  return scored.map((x) => x.v);
}

// 登録チャンネルの「関連度順」: よく見る順 + 最近投稿があるか
export function rankChannels(channels, aff, latest) {
  const now = Date.now();
  return [...channels].sort((a, b) => {
    const f = (c) => {
      const t = latest.get(c.id);
      const fresh = t ? Math.pow(0.5, (now - new Date(t).getTime()) / 864e5 / 3) : 0;
      return Math.log1p(Math.max(0, aff.get(c.id) || 0)) + 0.35 * fresh;
    };
    return f(b) - f(a);
  });
}

// ------------------------------------------------------------------ 関連動画から拾うおすすめ
const DISC = 'tsuzuki:disc'; // { [見た動画ID]: { at, related: [...] } }
const DISC_TTL = 24 * 3600e3;
const SEEDS = 5;
const NONE = [];

function seedsOf(progress) {
  // 新しい順に見ていき、5本そろったら止める(ショートかどうかの確認は、必要な分だけ)
  const out = [];
  const list = Object.entries(progress || {})
    .filter(([, p]) => p.done || (p.dur && p.pos / p.dur >= 0.3))
    .sort((a, b) => new Date(b[1].at) - new Date(a[1].at));
  for (const [id] of list) {
    if (videoInfo(id).short) continue;
    out.push(id);
    if (out.length >= SEEDS) break;
  }
  return out;
}

export function useDiscover(basis, aff) {
  const { progress, hidden } = basis;
  const videos = useStore((s) => s.videos);
  const noRec0 = useStore((s) => s.prefs.noRecCh);
  const noRec = noRec0 || NONE;
  const seeds = useMemo(() => seedsOf(progress), [progress]);
  const seedKey = seeds.join(',');
  const [store, setStore] = useState(() => lsGetJson(DISC, {}));
  useEffect(() => {
    let off = false;
    const cur = lsGetJson(DISC, {});
    // 古くなったもの・もう種でないものは捨てる
    for (const k of Object.keys(cur)) if (!seeds.includes(k) || Date.now() - cur[k].at > DISC_TTL) delete cur[k];
    lsSetJson(DISC, cur);
    setStore({ ...cur });
    const need = seeds.filter((id) => !cur[id]);
    (async () => {
      for (const id of need) {
        if (off) return;
        try {
          const d = videoDetail(id) || (await fn('video', { id }));
          rememberDetail(id, d);
          const related = (d.related || []).filter((h) => !h.live && (!h.dur || h.dur < 3 * 3600)).slice(0, 20);
          rememberHits(related);
          const now = lsGetJson(DISC, {});
          now[id] = { at: Date.now(), related };
          lsSetJson(DISC, now);
          if (!off) setStore({ ...now });
        } catch (_) {
          /* 次に開いたとき */
        }
      }
    })();
    return () => { off = true; };
  }, [seedKey]);
  // 手元に覚えている関連動画も、検索などと同じく題名を引けるようにしておく
  useEffect(() => {
    for (const k of Object.keys(store)) rememberHits(store[k].related);
  }, [store]);
  return useMemo(() => {
    const inFeed = new Set(videos.map((v) => v.id));
    const count = new Map();
    seeds.forEach((sid, si) => {
      const e = store[sid];
      if (!e) return;
      e.related.forEach((h, i) => {
        if (progress[h.id] || hidden.has(h.id) || inFeed.has(h.id) || seeds.includes(h.id)) return;
        if (h.chId && noRec.includes(h.chId)) return;
        const w = (1 - si * 0.12) * (1 - i * 0.03); // 新しく見た動画の、上のほうの関連ほど強く
        const cur = count.get(h.id) || { h, s: 0 };
        cur.s += w;
        count.set(h.id, cur);
      });
    });
    const list = [...count.values()]
      .map((x) => ({ ...x, s: x.s + 0.25 * Math.log1p(Math.max(0, aff.get(x.h.chId) || 0)) + 0.05 * jitter(x.h.id) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.h);
    return list;
  }, [store, basis, aff, videos, seedKey, noRec.join(',')]);
}

// おすすめに出さないチャンネル(端末ごとの設定)
export function noRecChannel(chId) {
  const st = getState();
  return (st.prefs.noRecCh || []).includes(chId);
}
