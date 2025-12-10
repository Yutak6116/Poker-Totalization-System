// src/pages/AdminGroupPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../lib/firebase";
import Modal from "../components/Modal";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

// ========== 型 ==========
type GroupSettings = {
  stakes_fixed: boolean;
  // 新仕様: SB/BB を別々に固定
  stakes_sb?: number | null;
  stakes_bb?: number | null;
  // 後方互換（旧）："1/3" のような文字列が残っていてもパースして使う
  stakes_value?: string | null;
  ranking_top_n: number;
};

type GroupDoc = {
  group_id: number;
  group_name: string;
  creator: string;
  player_password: string;
  admin_password: string;
  settings?: GroupSettings;
  creator_name?: string;
  creator_uid?: string;
};

type PlayerDoc = {
  player_id: number;
  group_id: number;
  display_name: string;
  email: string;
  total_balance: number;
};

type BalanceDoc = {
  balance_id: number;
  group_id: number;
  player_id: number;
  player_uid: string;
  date: string;
  date_ts: any; // Timestamp
  stakes: string; // "SB/BB"
  buy_in_bb: number;
  ending_bb: number;
  memo: string;
  last_updated: any; // Timestamp
  is_deleted: boolean;
};

type HistoryDoc = {
  history_id: number;
  balance_id: number;
  changed_at: any; // Timestamp
  change_category: "create" | "update" | "delete";
  change_details: any; // {before?: BalanceDoc, after?: BalanceDoc}
  changer_uid: string;
  changer_player_id: number;
};

// ========== util ==========
const pad6 = (n: number | string) =>
  String(n).replace(/\D/g, "").padStart(6, "0");
const formatTs = (t?: any) => t?.toDate?.().toLocaleString?.() || "-";
const parseLegacyStakes = (s?: string | null) => {
  if (!s) return { sb: null as number | null, bb: null as number | null };
  const [a, b] = s.split("/").map((x) => Number(x));
  return { sb: isNaN(a) ? null : a, bb: isNaN(b) ? null : b };
};
const fmtDiff = (v: number) => {
  const sign = v >= 0 ? "+" : "-";
  const num = Math.abs(v).toFixed(1);
  const color = v >= 0 ? "#111" : "#d00";
  return { text: `${sign}${num}BB`, color };
};
const CAT_COLOR: Record<HistoryDoc["change_category"], string> = {
  create: "#111111",
  update: "#1a73e8",
  delete: "#d93025",
};

const creatorNameOf = (g?: GroupDoc) =>
  g?.creator_name ||
  (g?.creator && g.creator.includes("@")
    ? g.creator.split("@")[0]
    : g?.creator) ||
  "(unknown)";

// ========== UI 小物 ==========
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: active ? "1px solid #444" : "1px solid #ddd",
        background: active ? "#fff" : "#f8f8fb",
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ========== ページ本体 ==========
export default function AdminGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();

  const TABS = [
    "グループ設定",
    "収支ランキング",
    "収支一覧",
    "更新履歴",
  ] as const;
  const [tab, setTab] = useState<(typeof TABS)[number]>("グループ設定");

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [balances, setBalances] = useState<BalanceDoc[]>([]);
  const [histories, setHistories] = useState<HistoryDoc[]>([]);

  // モーダル開閉
  const [openBalanceFilter, setOpenBalanceFilter] = useState(false);
  const [openHistoryFilter, setOpenHistoryFilter] = useState(false);

  // 収支一覧フィルタ状態
  const [fBUStart, setFBUStart] = useState(""); // 最終更新(開始) datetime-local
  const [fBUEnd, setFBUEnd] = useState(""); // 最終更新(終了)
  const [fBPlayer, setFBPlayer] = useState<string>(""); // uid
  const [fBDateStart, setFBDateStart] = useState(""); // 日付(開始) date
  const [fBDateEnd, setFBDateEnd] = useState(""); // 日付(終了)
  const [fBStakes, setFBStakes] = useState("");
  const [fBBuyInMin, setFBBuyInMin] = useState("");
  const [fBBuyInMax, setFBBuyInMax] = useState("");
  const [fBEndingMin, setFBEndingMin] = useState("");
  const [fBEndingMax, setFBEndingMax] = useState("");
  const [fBDeltaMin, setFBDeltaMin] = useState("");
  const [fBDeltaMax, setFBDeltaMax] = useState("");
  const [fBMemo, setFBMemo] = useState("");
  const [fBBalanceId, setFBBalanceId] = useState("");

  // 更新履歴フィルタ状態
  const [fHChangedStart, setFHChangedStart] = useState("");
  const [fHChangedEnd, setFHChangedEnd] = useState("");
  const [fHCategory, setFHCategory] = useState<string>(""); // create/update/delete
  const [fHPlayer, setFHPlayer] = useState<string>(""); // uid
  const [fHDateStart, setFHDateStart] = useState("");
  const [fHDateEnd, setFHDateEnd] = useState("");
  const [fHStakes, setFHStakes] = useState("");
  const [fHBuyInMin, setFHBuyInMin] = useState("");
  const [fHBuyInMax, setFHBuyInMax] = useState("");
  const [fHEndingMin, setFHEndingMin] = useState("");
  const [fHEndingMax, setFHEndingMax] = useState("");
  const [fHDeltaMin, setFHDeltaMin] = useState("");
  const [fHDeltaMax, setFHDeltaMax] = useState("");
  const [fHMemo, setFHMemo] = useState("");
  const [fHBalanceId, setFHBalanceId] = useState("");

  // 設定フォーム
  const [stakesFixed, setStakesFixed] = useState(false);
  const [stakesSB, setStakesSB] = useState<string>(""); // 表示/入力用
  const [stakesBB, setStakesBB] = useState<string>("");
  const [topN, setTopN] = useState<number>(10);
  const [newName, setNewName] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!groupId) return;

      // group
      const gref = doc(db, "groups", groupId);
      const gsnap = await getDoc(gref);
      if (gsnap.exists()) {
        const g = gsnap.data() as GroupDoc;
        setGroup(g);

        const s = g.settings;
        setStakesFixed(!!s?.stakes_fixed);

        // 新仕様: stakes_sb/ stakes_bb 優先、なければ旧 stakes_value をパース
        const sb0 =
          typeof s?.stakes_sb === "number"
            ? s!.stakes_sb
            : parseLegacyStakes(s?.stakes_value).sb;
        const bb0 =
          typeof s?.stakes_bb === "number"
            ? s!.stakes_bb
            : parseLegacyStakes(s?.stakes_value).bb;

        setStakesSB(sb0 != null ? String(sb0) : "");
        setStakesBB(bb0 != null ? String(bb0) : "");
        setTopN(s?.ranking_top_n ?? 10);
        setNewName(g.group_name);
      }

      // players
      const plist = await getDocs(collection(db, "groups", groupId, "players"));
      const pmap: Record<string, PlayerDoc> = {};
      plist.docs.forEach((d) => (pmap[d.id] = d.data() as PlayerDoc));
      setPlayers(pmap);

      // balances（ランキング用）— インデックス回避のため orderBy は省略し、集計側で対応
      const bq = query(
        collection(db, "groups", groupId, "balances"),
        where("is_deleted", "==", false)
      );
      const bs = await getDocs(bq);
      setBalances(bs.docs.map((d) => d.data() as BalanceDoc));

      // histories（新しい順）
      const hq = query(
        collection(db, "groups", groupId, "balance_histories"),
        orderBy("changed_at", "desc")
      );
      const hs = await getDocs(hq);
      setHistories(hs.docs.map((d) => d.data() as HistoryDoc));
    })();
  }, [groupId]);

  const ranking = useMemo(() => {
    type RankRow = { uid: string; name: string; total: number };
    const sums: Record<string, number> = {};
    balances.forEach((b) => {
      sums[b.player_uid] =
        (sums[b.player_uid] ?? 0) + (b.ending_bb - b.buy_in_bb);
    });
    const rows: RankRow[] = Object.entries(sums)
      .map(([uid, total]) => ({
        uid,
        name: players[uid]?.display_name ?? "(unknown)",
        total,
      }))
      .sort((a, b) => b.total - a.total);
    return rows;
  }, [balances, players]);

  // フィルタ適用後に新しい順にソート（下の balancesFilteredSorted で実施）

  // プレイヤーの選択肢
  const playerOptions = useMemo(
    () =>
      Object.entries(players)
        .map(([uid, p]) => ({ uid, name: p.display_name || uid }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [players]
  );

  // 補助関数
  const toMs = (v: string) => (v ? new Date(v).getTime() : null);
  const toMsDateOnly = (v: string) =>
    v ? new Date(v).setHours(0, 0, 0, 0) : null;
  const toMsDateOnlyEnd = (v: string) =>
    v ? new Date(v).setHours(23, 59, 59, 999) : null;
  const num = (v: string) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  const deltaOf = (b: BalanceDoc) =>
    (Number(b.ending_bb) || 0) - (Number(b.buy_in_bb) || 0);

  const playerNameOf = (uid?: string) =>
    (uid && players[uid]?.display_name) || "";

  // 絞り込みサマリー（収支一覧）
  const balanceFilterSummary = useMemo(() => {
    const items: { label: string; clear: () => void }[] = [];
    if (fBUStart || fBUEnd)
      items.push({
        label: `最終更新: ${fBUStart || "…"}〜${fBUEnd || "…"}`,
        clear: () => {
          setFBUStart("");
          setFBUEnd("");
        },
      });
    if (fBPlayer)
      items.push({
        label: `プレイヤー: ${playerNameOf(fBPlayer) || fBPlayer}`,
        clear: () => setFBPlayer(""),
      });
    if (fBDateStart || fBDateEnd)
      items.push({
        label: `日付: ${fBDateStart || "…"}〜${fBDateEnd || "…"}`,
        clear: () => {
          setFBDateStart("");
          setFBDateEnd("");
        },
      });
    if (fBStakes)
      items.push({
        label: `ステークス: ${fBStakes}`,
        clear: () => setFBStakes(""),
      });
    if (fBBuyInMin || fBBuyInMax)
      items.push({
        label: `BuyIn: ${fBBuyInMin || "…"}〜${fBBuyInMax || "…"}`,
        clear: () => {
          setFBBuyInMin("");
          setFBBuyInMax("");
        },
      });
    if (fBEndingMin || fBEndingMax)
      items.push({
        label: `Ending: ${fBEndingMin || "…"}〜${fBEndingMax || "…"}`,
        clear: () => {
          setFBEndingMin("");
          setFBEndingMax("");
        },
      });
    if (fBDeltaMin || fBDeltaMax)
      items.push({
        label: `差分: ${fBDeltaMin || "…"}〜${fBDeltaMax || "…"}`,
        clear: () => {
          setFBDeltaMin("");
          setFBDeltaMax("");
        },
      });
    if (fBMemo)
      items.push({ label: `メモ: ${fBMemo}`, clear: () => setFBMemo("") });
    if (fBBalanceId)
      items.push({
        label: `balance_id: ${fBBalanceId}`,
        clear: () => setFBBalanceId(""),
      });
    return items;
  }, [
    fBUStart,
    fBUEnd,
    fBPlayer,
    players,
    fBDateStart,
    fBDateEnd,
    fBStakes,
    fBBuyInMin,
    fBBuyInMax,
    fBEndingMin,
    fBEndingMax,
    fBDeltaMin,
    fBDeltaMax,
    fBMemo,
    fBBalanceId,
  ]);

  // 絞り込みサマリー（更新履歴）
  const historyFilterSummary = useMemo(() => {
    const items: { label: string; clear: () => void }[] = [];
    if (fHChangedStart || fHChangedEnd)
      items.push({
        label: `更新: ${fHChangedStart || "…"}〜${fHChangedEnd || "…"}`,
        clear: () => {
          setFHChangedStart("");
          setFHChangedEnd("");
        },
      });
    if (fHCategory)
      items.push({
        label: `種別: ${fHCategory}`,
        clear: () => setFHCategory(""),
      });
    if (fHPlayer)
      items.push({
        label: `プレイヤー: ${playerNameOf(fHPlayer) || fHPlayer}`,
        clear: () => setFHPlayer(""),
      });
    if (fHDateStart || fHDateEnd)
      items.push({
        label: `日付: ${fHDateStart || "…"}〜${fHDateEnd || "…"}`,
        clear: () => {
          setFHDateStart("");
          setFHDateEnd("");
        },
      });
    if (fHStakes)
      items.push({
        label: `ステークス: ${fHStakes}`,
        clear: () => setFHStakes(""),
      });
    if (fHBuyInMin || fHBuyInMax)
      items.push({
        label: `BuyIn: ${fHBuyInMin || "…"}〜${fHBuyInMax || "…"}`,
        clear: () => {
          setFHBuyInMin("");
          setFHBuyInMax("");
        },
      });
    if (fHEndingMin || fHEndingMax)
      items.push({
        label: `Ending: ${fHEndingMin || "…"}〜${fHEndingMax || "…"}`,
        clear: () => {
          setFHEndingMin("");
          setFHEndingMax("");
        },
      });
    if (fHDeltaMin || fHDeltaMax)
      items.push({
        label: `差分: ${fHDeltaMin || "…"}〜${fHDeltaMax || "…"}`,
        clear: () => {
          setFHDeltaMin("");
          setFHDeltaMax("");
        },
      });
    if (fHMemo)
      items.push({ label: `メモ: ${fHMemo}`, clear: () => setFHMemo("") });
    if (fHBalanceId)
      items.push({
        label: `balance_id: ${fHBalanceId}`,
        clear: () => setFHBalanceId(""),
      });
    return items;
  }, [
    fHChangedStart,
    fHChangedEnd,
    fHCategory,
    fHPlayer,
    players,
    fHDateStart,
    fHDateEnd,
    fHStakes,
    fHBuyInMin,
    fHBuyInMax,
    fHEndingMin,
    fHEndingMax,
    fHDeltaMin,
    fHDeltaMax,
    fHMemo,
    fHBalanceId,
  ]);

  // 収支一覧フィルタ適用
  const balancesFilteredSorted = useMemo(() => {
    const uStart = toMs(fBUStart);
    const uEnd = toMs(fBUEnd);
    const dStart = toMsDateOnly(fBDateStart);
    const dEnd = toMsDateOnlyEnd(fBDateEnd);
    const biMin = num(fBBuyInMin);
    const biMax = num(fBBuyInMax);
    const enMin = num(fBEndingMin);
    const enMax = num(fBEndingMax);
    const deMin = num(fBDeltaMin);
    const deMax = num(fBDeltaMax);

    const key = (b: BalanceDoc) => {
      const lu = b.last_updated?.toMillis?.() || null;
      const dt = b.date_ts?.toMillis?.() || null;
      const dstr = b.date ? Date.parse(b.date) : null;
      return lu ?? dt ?? dstr ?? 0;
    };

    return [...balances]
      .filter((b) => {
        // 最終更新日時
        const t = b.last_updated?.toMillis?.() || null;
        if (uStart != null && (t == null || t < uStart)) return false;
        if (uEnd != null && (t == null || t > uEnd)) return false;
        // プレイヤー
        if (fBPlayer && b.player_uid !== fBPlayer) return false;
        // 日付（文字列）
        if (fBDateStart || fBDateEnd) {
          const dm = b.date ? new Date(b.date).setHours(0, 0, 0, 0) : null;
          if (dStart != null && (dm == null || dm < dStart)) return false;
          if (dEnd != null && (dm == null || dm > dEnd)) return false;
        }
        // ステークス
        if (
          fBStakes &&
          !(b.stakes || "").toLowerCase().includes(fBStakes.toLowerCase())
        )
          return false;
        // 数値系
        const bi = Number(b.buy_in_bb);
        const en = Number(b.ending_bb);
        const de = deltaOf(b);
        if (biMin != null && !(bi >= biMin)) return false;
        if (biMax != null && !(bi <= biMax)) return false;
        if (enMin != null && !(en >= enMin)) return false;
        if (enMax != null && !(en <= enMax)) return false;
        if (deMin != null && !(de >= deMin)) return false;
        if (deMax != null && !(de <= deMax)) return false;
        // メモ
        if (
          fBMemo &&
          !(b.memo || "").toLowerCase().includes(fBMemo.toLowerCase())
        )
          return false;
        // balance_id 完全一致
        if (fBBalanceId && String(b.balance_id) !== fBBalanceId.trim())
          return false;
        return true;
      })
      .sort((a, b) => key(b) - key(a));
  }, [
    balances,
    fBUStart,
    fBUEnd,
    fBPlayer,
    fBDateStart,
    fBDateEnd,
    fBStakes,
    fBBuyInMin,
    fBBuyInMax,
    fBEndingMin,
    fBEndingMax,
    fBDeltaMin,
    fBDeltaMax,
    fBMemo,
    fBBalanceId,
  ]);

  // ---- 収支一覧テーブルのソート（最終更新/日付/BuyIn/Ending/差分）----
  type SortKey = "last_updated" | "date" | "buy_in_bb" | "ending_bb" | "delta";
  type SortDir = "asc" | "desc";
  const [sortKey, setSortKey] = useState<SortKey>("last_updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sortClicked, setSortClicked] = useState(false);

  const balancesSortedByUI = useMemo(() => {
    const arr = [...balancesFilteredSorted];
    const getVal = (b: BalanceDoc, k: SortKey): number => {
      switch (k) {
        case "last_updated":
          return b.last_updated?.toMillis?.() ?? 0;
        case "date":
          return (
            b.date_ts?.toMillis?.() ??
            (b.date ? new Date(b.date).setHours(0, 0, 0, 0) : 0)
          );
        case "buy_in_bb":
          return Number(b.buy_in_bb) ?? 0;
        case "ending_bb":
          return Number(b.ending_bb) ?? 0;
        case "delta":
          return (Number(b.ending_bb) || 0) - (Number(b.buy_in_bb) || 0);
        default:
          return 0;
      }
    };
    arr.sort((a, b) => {
      const va = getVal(a, sortKey);
      const vb = getVal(b, sortKey);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return arr;
  }, [balancesFilteredSorted, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    let nextKey: SortKey = sortKey;
    let nextDir: SortDir = sortDir;
    if (sortKey !== k) {
      nextKey = k;
      nextDir = "asc";
    } else {
      nextDir = sortDir === "asc" ? "desc" : "asc";
    }
    setSortKey(nextKey);
    setSortDir(nextDir);
    setSortClicked(true);
  };

  // 更新履歴フィルタ適用
  const historiesFiltered = useMemo(() => {
    const cStart = toMs(fHChangedStart);
    const cEnd = toMs(fHChangedEnd);
    const dStart = toMsDateOnly(fHDateStart);
    const dEnd = toMsDateOnlyEnd(fHDateEnd);
    const biMin = num(fHBuyInMin);
    const biMax = num(fHBuyInMax);
    const enMin = num(fHEndingMin);
    const enMax = num(fHEndingMax);
    const deMin = num(fHDeltaMin);
    const deMax = num(fHDeltaMax);

    function rowMatches(b?: Partial<BalanceDoc>) {
      if (!b) return false;
      // 日付
      if (fHDateStart || fHDateEnd) {
        const dm = b.date ? new Date(b.date).setHours(0, 0, 0, 0) : null;
        if (dStart != null && (dm == null || dm < dStart)) return false;
        if (dEnd != null && (dm == null || dm > dEnd)) return false;
      }
      // ステークス
      if (
        fHStakes &&
        !(b.stakes || "").toLowerCase().includes(fHStakes.toLowerCase())
      )
        return false;
      // 数値
      const bi = Number(b.buy_in_bb);
      const en = Number(b.ending_bb);
      const de = (Number(b.ending_bb) || 0) - (Number(b.buy_in_bb) || 0);
      if (biMin != null && !(bi >= biMin)) return false;
      if (biMax != null && !(bi <= biMax)) return false;
      if (enMin != null && !(en >= enMin)) return false;
      if (enMax != null && !(en <= enMax)) return false;
      if (deMin != null && !(de >= deMin)) return false;
      if (deMax != null && !(de <= deMax)) return false;
      // メモ
      if (
        fHMemo &&
        !(b.memo || "").toLowerCase().includes(fHMemo.toLowerCase())
      )
        return false;
      return true;
    }

    return histories.filter((h) => {
      // 変更日時
      const t = h.changed_at?.toMillis?.() || null;
      if (cStart != null && (t == null || t < cStart)) return false;
      if (cEnd != null && (t == null || t > cEnd)) return false;
      // 種別
      if (fHCategory && h.change_category !== fHCategory) return false;
      // balance_id 完全一致
      if (fHBalanceId && String(h.balance_id) !== fHBalanceId.trim())
        return false;
      // プレイヤー
      if (fHPlayer) {
        const det: any = h.change_details || {};
        const uids = new Set<string>();
        if (det.before?.player_uid) uids.add(det.before.player_uid);
        if (det.after?.player_uid) uids.add(det.after.player_uid);
        if (h.changer_uid) uids.add(h.changer_uid);
        if (!uids.has(fHPlayer)) return false;
      }
      // before/after のどちらかが条件に合致すれば採用
      const det: any = h.change_details || {};
      if (
        fHDateStart ||
        fHDateEnd ||
        fHStakes ||
        fHBuyInMin ||
        fHBuyInMax ||
        fHEndingMin ||
        fHEndingMax ||
        fHDeltaMin ||
        fHDeltaMax ||
        fHMemo
      ) {
        return rowMatches(det.before) || rowMatches(det.after);
      }
      return true;
    });
  }, [
    histories,
    fHChangedStart,
    fHChangedEnd,
    fHCategory,
    fHPlayer,
    fHDateStart,
    fHDateEnd,
    fHStakes,
    fHBuyInMin,
    fHBuyInMax,
    fHEndingMin,
    fHEndingMax,
    fHDeltaMin,
    fHDeltaMax,
    fHMemo,
    fHBalanceId,
  ]);

  // ---- 更新履歴テーブルのソート（更新日時/日付/BuyIn/Ending/差分）----
  type HSortKey = "changed_at" | "date" | "buy_in_bb" | "ending_bb" | "delta";
  type HSortDir = "asc" | "desc";
  const [hSortKey, setHSortKey] = useState<HSortKey>("changed_at");
  const [hSortDir, setHSortDir] = useState<HSortDir>("desc");
  const [hSortClicked, setHSortClicked] = useState(false);

  // 履歴をフラット化して代表値（after優先、なければbefore）を用いて並び替え
  type FlatHistoryRow = {
    h: HistoryDoc;
    rows: ReturnType<typeof expandHistory>;
    sortValue: number; // キー別の比較用値
    rep: Partial<BalanceDoc> | undefined; // 代表行 after優先
  };

  const historiesSortedByUI = useMemo(() => {
    const toVal = (h: HistoryDoc, rep?: Partial<BalanceDoc>): number => {
      switch (hSortKey) {
        case "changed_at":
          return h.changed_at?.toMillis?.() ?? 0;
        case "date": {
          const d = rep?.date;
          return d ? new Date(d).setHours(0, 0, 0, 0) : 0;
        }
        case "buy_in_bb":
          return Number(rep?.buy_in_bb) || 0;
        case "ending_bb":
          return Number(rep?.ending_bb) || 0;
        case "delta":
          return (Number(rep?.ending_bb) || 0) - (Number(rep?.buy_in_bb) || 0);
        default:
          return 0;
      }
    };

    const flats: FlatHistoryRow[] = historiesFiltered.map((h) => {
      const rows = expandHistory(h);
      const after = rows.find((r) => r.kind === "after")?.b;
      const before = rows.find((r) => r.kind === "before")?.b;
      const rep = after ?? before ?? rows[0]?.b;
      return {
        h,
        rows,
        rep,
        sortValue: toVal(h, rep),
      };
    });
    flats.sort((a, b) =>
      hSortDir === "asc" ? a.sortValue - b.sortValue : b.sortValue - a.sortValue
    );
    return flats;
  }, [historiesFiltered, hSortKey, hSortDir]);

  const toggleHistorySort = (k: HSortKey) => {
    let nextKey: HSortKey = hSortKey;
    let nextDir: HSortDir = hSortDir;
    if (hSortKey !== k) {
      nextKey = k;
      nextDir = "asc";
    } else {
      nextDir = hSortDir === "asc" ? "desc" : "asc";
    }
    setHSortKey(nextKey);
    setHSortDir(nextDir);
    setHSortClicked(true);
  };

  // 収支一覧: 表示中（フィルタ後）の差分合計
  const balancesTotalDelta = useMemo(() => {
    return balancesFilteredSorted.reduce((sum, b) => {
      const bi = Number(b.buy_in_bb) || 0;
      const en = Number(b.ending_bb) || 0;
      return sum + (en - bi);
    }, 0);
  }, [balancesFilteredSorted]);

  async function saveSettings() {
    if (!groupId || !group) return;

    const fixed = stakesFixed;
    const sb = Number(stakesSB);
    const bb = Number(stakesBB);

    if (fixed) {
      if (isNaN(sb) || isNaN(bb) || sb <= 0 || bb <= 0) {
        alert("固定SB/BB は 0 より大きい数値で入力してください");
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        settings: {
          stakes_fixed: fixed,
          stakes_sb: fixed ? sb : null,
          stakes_bb: fixed ? bb : null,
          // 後方互換: 旧 stakes_value は使わない（null推奨）
          stakes_value: null,
          ranking_top_n: Number(topN) || 10,
        } as GroupSettings,
        group_name: newName || group.group_name,
        last_updated: serverTimestamp(),
      };
      await updateDoc(doc(db, "groups", groupId), payload);
      setGroup((prev) => (prev ? ({ ...prev, ...payload } as GroupDoc) : prev));
      alert("保存しました");
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (!group) return <div style={{ padding: 24 }}>Loading...</div>;

  // ========== 更新履歴：表示用に展開 ==========
  type HRow = {
    // 同一履歴内の行タイプ
    kind: "single" | "before" | "after";
    b: Partial<BalanceDoc> & { player_uid?: string };
  };
  function expandHistory(h: HistoryDoc): HRow[] {
    const det = h.change_details || {};
    if (h.change_category === "create" && det.after) {
      return [{ kind: "single", b: det.after }];
    }
    if (h.change_category === "delete" && det.before) {
      return [{ kind: "single", b: det.before }];
    }
    if (h.change_category === "update") {
      const rows: HRow[] = [];
      if (det.before) rows.push({ kind: "before", b: det.before });
      if (det.after) rows.push({ kind: "after", b: det.after });
      return rows;
    }
    return [];
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: 1080,
          maxWidth: "96vw",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 10px 28px rgba(0,0,0,.08)",
          padding: 24,
        }}
      >
        {/* ヘッダ */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>
              Admin: {group.group_name}{" "}
              <span style={{ opacity: 0.6, fontSize: 14 }}>
                ID {pad6(group.group_id)}
              </span>
            </h2>
            <div style={{ opacity: 0.7, fontSize: 13 }}>
              作成者: {creatorNameOf(group)}
            </div>
          </div>
          <Link
            to="/admin"
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          >
            グループ一覧へ
          </Link>
        </div>

        <hr style={{ margin: "16px 0 12px" }} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <TabButton key={t} active={tab === t} onClick={() => setTab(t)}>
              {t}
            </TabButton>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          {/* ========== グループ設定 ========== */}
          {tab === "グループ設定" && (
            <div style={{ display: "grid", gap: 16 }}>
              {/* 1) ステークス固定（SB/BB） */}
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <h3 style={{ marginTop: 0 }}>1) ステークス固定（SB/BB）</h3>
                <label
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={stakesFixed}
                    onChange={(e) => setStakesFixed(e.target.checked)}
                  />
                  ステークスを固定する
                </label>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  <div>
                    <label style={lbl}>固定SB</label>
                    <input
                      value={stakesSB}
                      onChange={(e) =>
                        setStakesSB(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                      inputMode="decimal"
                      placeholder="例: 1"
                      disabled={!stakesFixed}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>固定BB</label>
                    <input
                      value={stakesBB}
                      onChange={(e) =>
                        setStakesBB(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                      inputMode="decimal"
                      placeholder="例: 3"
                      disabled={!stakesFixed}
                      style={inp}
                    />
                  </div>
                </div>

                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                  ※ 固定ONの場合、Player の「収支報告」「編集」では SB/BB
                  がこの固定値で表示され、編集できません。
                </div>
              </div>

              {/* 2) ランキング上位N */}
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <h3 style={{ marginTop: 0 }}>2) Player公開ランキングの上位N</h3>
                <input
                  value={topN}
                  onChange={(e) =>
                    setTopN(Number(e.target.value.replace(/\D/g, "")) || 10)
                  }
                  inputMode="numeric"
                  style={{
                    width: 180,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                  }}
                />
              </div>

              {/* 3) グループ名変更・ID/PW */}
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <h3 style={{ marginTop: 0 }}>
                  3) グループ名の変更 / ID・パスワード確認
                </h3>
                <label style={lbl}>グループ名</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{
                    width: "100%",
                    maxWidth: 480,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                  }}
                />
                <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.8 }}>
                  <div>
                    グループID: <code>{pad6(group.group_id)}</code>
                  </div>
                  <div>
                    Player PW: <code>{group.player_password}</code>
                  </div>
                  <div>
                    Admin PW: <code>{group.admin_password}</code>
                  </div>
                </div>
              </div>

              <div>
                <button
                  onClick={saveSettings}
                  disabled={saving}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: "#fff",
                  }}
                >
                  {saving ? "保存中..." : "保存する"}
                </button>
              </div>
            </div>
          )}

          {/* ========== 収支ランキング ========== */}
          {tab === "収支ランキング" && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <h3 style={{ marginTop: 0 }}>全員のランキング（累計BB）</h3>
              {ranking.length === 0 ? (
                <div style={{ opacity: 0.7 }}>データがありません。</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>順位</th>
                      <th style={th}>表示名</th>
                      <th style={{ ...th, textAlign: "right" }}>累計BB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r, idx) => (
                      <tr key={r.uid}>
                        <td style={td}>{idx + 1}</td>
                        <td style={td}>{r.name}</td>
                        <td
                          style={{ ...td, textAlign: "right", fontWeight: 600 }}
                        >
                          {(() => {
                            const { text, color } = fmtDiff(r.total);
                            return <span style={{ color }}>{text}</span>;
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ========== 更新履歴 ========== */}
          {tab === "収支一覧" && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
                overflow: "auto",
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: 6 }}>現在の収支一覧</h3>
              <div style={{ marginTop: 8, fontSize: 14 }}>
                合計（差分）:{" "}
                {(() => {
                  const { text, color } = fmtDiff(balancesTotalDelta);
                  return <span style={{ fontWeight: 700, color }}>{text}</span>;
                })()}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => setOpenBalanceFilter(true)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    background: "#fff",
                  }}
                >
                  絞り込み
                </button>
                {balanceFilterSummary.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {balanceFilterSummary.map((it, i) => (
                      <span
                        key={i}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "#f4f4f7",
                          border: "1px solid #e6e6ea",
                        }}
                      >
                        {it.label}
                        <button
                          aria-label="clear filter"
                          onClick={(e) => {
                            e.stopPropagation();
                            it.clear();
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {balancesFilteredSorted.length === 0 ? (
                <div style={{ opacity: 0.7 }}>データがありません。</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>
                        <button
                          onClick={() => toggleSort("last_updated")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>最終更新日時</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!sortClicked || sortKey !== "last_updated") &&
                              "▲▼"}
                            {sortClicked &&
                              sortKey === "last_updated" &&
                              (sortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={th}>プレイヤー</th>
                      <th style={th}>
                        <button
                          onClick={() => toggleSort("date")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>日付</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!sortClicked || sortKey !== "date") && "▲▼"}
                            {sortClicked &&
                              sortKey === "date" &&
                              (sortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={th}>ステークス</th>
                      <th style={{ ...th, textAlign: "right" }}>
                        <button
                          onClick={() => toggleSort("buy_in_bb")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>BuyIn</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!sortClicked || sortKey !== "buy_in_bb") && "▲▼"}
                            {sortClicked &&
                              sortKey === "buy_in_bb" &&
                              (sortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={{ ...th, textAlign: "right" }}>
                        <button
                          onClick={() => toggleSort("ending_bb")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>Ending</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!sortClicked || sortKey !== "ending_bb") && "▲▼"}
                            {sortClicked &&
                              sortKey === "ending_bb" &&
                              (sortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={{ ...th, textAlign: "right" }}>
                        <button
                          onClick={() => toggleSort("delta")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>差分</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!sortClicked || sortKey !== "delta") && "▲▼"}
                            {sortClicked &&
                              sortKey === "delta" &&
                              (sortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={th}>メモ</th>
                      <th style={th}>balance_id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balancesSortedByUI.map((b, idx) => {
                      const delta =
                        (Number(b.ending_bb) || 0) - (Number(b.buy_in_bb) || 0);
                      const { text, color } = fmtDiff(delta);
                      const playerName =
                        (b.player_uid && players[b.player_uid]?.display_name) ||
                        b.player_uid ||
                        "(unknown)";
                      const when =
                        b.last_updated?.toDate?.() || b.date_ts?.toDate?.();
                      return (
                        <tr key={idx}>
                          <td style={td}>
                            {when ? when.toLocaleString() : "-"}
                          </td>
                          <td style={td}>{playerName}</td>
                          <td style={td}>{b.date || "-"}</td>
                          <td style={td}>{b.stakes || "-"}</td>
                          <td style={{ ...td, textAlign: "right" }}>
                            {b.buy_in_bb != null ? String(b.buy_in_bb) : "-"}
                          </td>
                          <td style={{ ...td, textAlign: "right" }}>
                            {b.ending_bb != null ? String(b.ending_bb) : "-"}
                          </td>
                          <td
                            style={{
                              ...td,
                              textAlign: "right",
                              fontWeight: 600,
                              color,
                            }}
                          >
                            {b.buy_in_bb != null && b.ending_bb != null
                              ? text
                              : "-"}
                          </td>
                          <td style={td}>{b.memo || "-"}</td>
                          <td style={td}>{b.balance_id}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <Modal
                open={openBalanceFilter}
                onClose={() => setOpenBalanceFilter(false)}
                width={720}
              >
                <h3 style={{ marginTop: 0 }}>収支一覧の絞り込み</h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div>
                    <label style={lbl}>最終更新（開始）</label>
                    <input
                      type="datetime-local"
                      value={fBUStart}
                      onChange={(e) => setFBUStart(e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>最終更新（終了）</label>
                    <input
                      type="datetime-local"
                      value={fBUEnd}
                      onChange={(e) => setFBUEnd(e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>プレイヤー</label>
                    <select
                      value={fBPlayer}
                      onChange={(e) => setFBPlayer(e.target.value)}
                      style={inp}
                    >
                      <option value="">全員</option>
                      {playerOptions.map((p) => (
                        <option key={p.uid} value={p.uid}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div />
                  <div>
                    <label style={lbl}>日付（開始）</label>
                    <input
                      type="date"
                      value={fBDateStart}
                      onChange={(e) => setFBDateStart(e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>日付（終了）</label>
                    <input
                      type="date"
                      value={fBDateEnd}
                      onChange={(e) => setFBDateEnd(e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>ステークス</label>
                    <input
                      value={fBStakes}
                      onChange={(e) => setFBStakes(e.target.value)}
                      placeholder="部分一致"
                      style={inp}
                    />
                  </div>
                  <div />
                  <div>
                    <label style={lbl}>BuyIn 最小</label>
                    <input
                      value={fBBuyInMin}
                      onChange={(e) => setFBBuyInMin(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>BuyIn 最大</label>
                    <input
                      value={fBBuyInMax}
                      onChange={(e) => setFBBuyInMax(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Ending 最小</label>
                    <input
                      value={fBEndingMin}
                      onChange={(e) => setFBEndingMin(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Ending 最大</label>
                    <input
                      value={fBEndingMax}
                      onChange={(e) => setFBEndingMax(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>差分 最小</label>
                    <input
                      value={fBDeltaMin}
                      onChange={(e) => setFBDeltaMin(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>差分 最大</label>
                    <input
                      value={fBDeltaMax}
                      onChange={(e) => setFBDeltaMax(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>メモ</label>
                    <input
                      value={fBMemo}
                      onChange={(e) => setFBMemo(e.target.value)}
                      placeholder="部分一致"
                      style={inp}
                    />
                  </div>
                  <div />
                  <div>
                    <label style={lbl}>balance_id（完全一致）</label>
                    <input
                      value={fBBalanceId}
                      onChange={(e) =>
                        setFBBalanceId(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      inputMode="numeric"
                      style={inp}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <button
                    onClick={() => {
                      setFBUStart("");
                      setFBUEnd("");
                      setFBPlayer("");
                      setFBDateStart("");
                      setFBDateEnd("");
                      setFBStakes("");
                      setFBBuyInMin("");
                      setFBBuyInMax("");
                      setFBEndingMin("");
                      setFBEndingMax("");
                      setFBDeltaMin("");
                      setFBDeltaMax("");
                      setFBMemo("");
                      setFBBalanceId("");
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      background: "#fff",
                    }}
                  >
                    クリア
                  </button>
                  <button
                    onClick={() => setOpenBalanceFilter(false)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #111",
                      background: "#111",
                      color: "#fff",
                    }}
                  >
                    適用
                  </button>
                </div>
              </Modal>
            </div>
          )}
          {/* ========== 更新履歴 ========== */}
          {tab === "更新履歴" && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
                overflow: "auto",
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: 6 }}>更新履歴</h3>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={() => setOpenHistoryFilter(true)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    background: "#fff",
                  }}
                >
                  絞り込み
                </button>
                {historyFilterSummary.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {historyFilterSummary.map((it, i) => (
                      <span
                        key={i}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "#f4f4f7",
                          border: "1px solid #e6e6ea",
                        }}
                      >
                        {it.label}
                        <button
                          aria-label="clear filter"
                          onClick={(e) => {
                            e.stopPropagation();
                            it.clear();
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            padding: 0,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {histories.length === 0 ? (
                <div style={{ opacity: 0.7 }}>まだ履歴がありません。</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>
                        <button
                          onClick={() => toggleHistorySort("changed_at")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>更新日時</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!hSortClicked || hSortKey !== "changed_at") &&
                              "▲▼"}
                            {hSortClicked &&
                              hSortKey === "changed_at" &&
                              (hSortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={th}>種別</th>
                      <th style={th}>行</th>
                      <th style={th}>プレイヤー</th>
                      <th style={th}>
                        <button
                          onClick={() => toggleHistorySort("date")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>日付</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!hSortClicked || hSortKey !== "date") && "▲▼"}
                            {hSortClicked &&
                              hSortKey === "date" &&
                              (hSortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={th}>ステークス</th>
                      <th style={{ ...th, textAlign: "right" }}>
                        <button
                          onClick={() => toggleHistorySort("buy_in_bb")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>BuyIn</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!hSortClicked || hSortKey !== "buy_in_bb") &&
                              "▲▼"}
                            {hSortClicked &&
                              hSortKey === "buy_in_bb" &&
                              (hSortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={{ ...th, textAlign: "right" }}>
                        <button
                          onClick={() => toggleHistorySort("ending_bb")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>Ending</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!hSortClicked || hSortKey !== "ending_bb") &&
                              "▲▼"}
                            {hSortClicked &&
                              hSortKey === "ending_bb" &&
                              (hSortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={{ ...th, textAlign: "right" }}>
                        <button
                          onClick={() => toggleHistorySort("delta")}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span>差分</span>
                          <span style={{ fontSize: 12, opacity: 0.7 }}>
                            {(!hSortClicked || hSortKey !== "delta") && "▲▼"}
                            {hSortClicked &&
                              hSortKey === "delta" &&
                              (hSortDir === "asc" ? "▲" : "▼")}
                          </span>
                        </button>
                      </th>
                      <th style={th}>メモ</th>
                      <th style={th}>balance_id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historiesSortedByUI.map(({ h }, hi) => {
                      const rows2 = expandHistory(h);
                      if (rows2.length === 0) return null;
                      const rowSpan = rows2.length;

                      return rows2.map((r, ri) => {
                        const b = r.b || {};
                        const delta =
                          (Number(b.ending_bb) || 0) -
                          (Number(b.buy_in_bb) || 0);
                        const { text, color } = fmtDiff(delta);
                        const playerName =
                          (b.player_uid &&
                            players[b.player_uid]?.display_name) ||
                          players[h.changer_uid]?.display_name ||
                          h.changer_uid;

                        // 行ラベル
                        let rowLabel = "";
                        if (h.change_category === "update") {
                          rowLabel = r.kind === "before" ? "Before" : "After";
                        } else {
                          rowLabel = "Record";
                        }

                        return (
                          <tr key={`${hi}-${ri}`}>
                            {/* 同一履歴の最初の行にだけ「日時・種別」を表示（rowSpan） */}
                            {ri === 0 && (
                              <>
                                <td style={td} rowSpan={rowSpan}>
                                  {formatTs(h.changed_at)}
                                </td>
                                <td
                                  style={{
                                    ...td,
                                    color: CAT_COLOR[h.change_category],
                                    fontWeight: 700,
                                  }}
                                  rowSpan={rowSpan}
                                >
                                  {h.change_category}
                                </td>
                              </>
                            )}
                            <td
                              style={{
                                ...td,
                                whiteSpace: "nowrap",
                                fontSize: 12,
                                opacity: 0.8,
                              }}
                            >
                              {rowLabel}
                            </td>
                            <td style={td}>{playerName}</td>
                            <td style={td}>{b.date || "-"}</td>
                            <td style={td}>{b.stakes || "-"}</td>
                            <td style={{ ...td, textAlign: "right" }}>
                              {b.buy_in_bb != null ? String(b.buy_in_bb) : "-"}
                            </td>
                            <td style={{ ...td, textAlign: "right" }}>
                              {b.ending_bb != null ? String(b.ending_bb) : "-"}
                            </td>
                            <td
                              style={{
                                ...td,
                                textAlign: "right",
                                fontWeight: 600,
                                color,
                              }}
                            >
                              {b.buy_in_bb != null && b.ending_bb != null
                                ? text
                                : "-"}
                            </td>
                            <td style={td}>{b.memo || "-"}</td>
                            <td style={td}>{h.balance_id}</td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              )}
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                ※ create/delete はその収支を1行表示、update は Before/After
                を2行表示します。
              </div>
              <Modal
                open={openHistoryFilter}
                onClose={() => setOpenHistoryFilter(false)}
                width={720}
              >
                <h3 style={{ marginTop: 0 }}>更新履歴の絞り込み</h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div>
                    <label style={lbl}>更新日時（開始）</label>
                    <input
                      type="datetime-local"
                      value={fHChangedStart}
                      onChange={(e) => setFHChangedStart(e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>更新日時（終了）</label>
                    <input
                      type="datetime-local"
                      value={fHChangedEnd}
                      onChange={(e) => setFHChangedEnd(e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>種別</label>
                    <select
                      value={fHCategory}
                      onChange={(e) => setFHCategory(e.target.value)}
                      style={inp}
                    >
                      <option value="">すべて</option>
                      <option value="create">create</option>
                      <option value="update">update</option>
                      <option value="delete">delete</option>
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>プレイヤー</label>
                    <select
                      value={fHPlayer}
                      onChange={(e) => setFHPlayer(e.target.value)}
                      style={inp}
                    >
                      <option value="">全員</option>
                      {playerOptions.map((p) => (
                        <option key={p.uid} value={p.uid}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>日付（開始）</label>
                    <input
                      type="date"
                      value={fHDateStart}
                      onChange={(e) => setFHDateStart(e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>日付（終了）</label>
                    <input
                      type="date"
                      value={fHDateEnd}
                      onChange={(e) => setFHDateEnd(e.target.value)}
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>ステークス</label>
                    <input
                      value={fHStakes}
                      onChange={(e) => setFHStakes(e.target.value)}
                      placeholder="部分一致"
                      style={inp}
                    />
                  </div>
                  <div />
                  <div>
                    <label style={lbl}>BuyIn 最小</label>
                    <input
                      value={fHBuyInMin}
                      onChange={(e) => setFHBuyInMin(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>BuyIn 最大</label>
                    <input
                      value={fHBuyInMax}
                      onChange={(e) => setFHBuyInMax(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Ending 最小</label>
                    <input
                      value={fHEndingMin}
                      onChange={(e) => setFHEndingMin(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>Ending 最大</label>
                    <input
                      value={fHEndingMax}
                      onChange={(e) => setFHEndingMax(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>差分 最小</label>
                    <input
                      value={fHDeltaMin}
                      onChange={(e) => setFHDeltaMin(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>差分 最大</label>
                    <input
                      value={fHDeltaMax}
                      onChange={(e) => setFHDeltaMax(e.target.value)}
                      inputMode="decimal"
                      style={inp}
                    />
                  </div>
                  <div>
                    <label style={lbl}>メモ</label>
                    <input
                      value={fHMemo}
                      onChange={(e) => setFHMemo(e.target.value)}
                      placeholder="部分一致"
                      style={inp}
                    />
                  </div>
                  <div />
                  <div>
                    <label style={lbl}>balance_id（完全一致）</label>
                    <input
                      value={fHBalanceId}
                      onChange={(e) =>
                        setFHBalanceId(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      inputMode="numeric"
                      style={inp}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  <button
                    onClick={() => {
                      setFHChangedStart("");
                      setFHChangedEnd("");
                      setFHCategory("");
                      setFHPlayer("");
                      setFHDateStart("");
                      setFHDateEnd("");
                      setFHStakes("");
                      setFHBuyInMin("");
                      setFHBuyInMax("");
                      setFHEndingMin("");
                      setFHEndingMax("");
                      setFHDeltaMin("");
                      setFHDeltaMax("");
                      setFHMemo("");
                      setFHBalanceId("");
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      background: "#fff",
                    }}
                  >
                    クリア
                  </button>
                  <button
                    onClick={() => setOpenHistoryFilter(false)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #111",
                      background: "#111",
                      color: "#fff",
                    }}
                  >
                    適用
                  </button>
                </div>
              </Modal>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- テーブル・フォーム用スタイル ----
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 6px",
  borderBottom: "1px solid #eee",
  background: "#fafafa",
  position: "sticky",
  top: 0,
};
const td: React.CSSProperties = {
  padding: "8px 6px",
  borderBottom: "1px solid #f2f2f2",
};
const lbl: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  opacity: 0.8,
  margin: "10px 0 6px",
};
const inp: React.CSSProperties = {
  width: "100%",
  padding: 10,
  borderRadius: 10,
  border: "1px solid #ddd",
};
