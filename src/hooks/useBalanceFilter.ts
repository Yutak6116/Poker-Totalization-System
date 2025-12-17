import { useMemo, useState } from "react";
import type { BalanceDoc, BalanceRow } from "../types/poker";
import { toMs, toMsDateOnly, toMsDateOnlyEnd, deltaOf } from "../utils/poker";

// Extend BalanceDoc to allow __id if present, but base logic works on BalanceDoc fields
export type BalanceItem = BalanceRow | BalanceDoc;

export type BalanceFilterState = {
  fBUStart: string;
  fBUEnd: string;
  fBPlayer: string; // uid
  fBDateStart: string;
  fBDateEnd: string;
  fBStakes: string;
  fBBuyInMin: string;
  fBBuyInMax: string;
  fBEndingMin: string;
  fBEndingMax: string;
  fBDeltaMin: string;
  fBDeltaMax: string;
  fBMemo: string;
  fBBalanceId: string;
};

export const INITIAL_FILTER_STATE: BalanceFilterState = {
  fBUStart: "",
  fBUEnd: "",
  fBPlayer: "",
  fBDateStart: "",
  fBDateEnd: "",
  fBStakes: "",
  fBBuyInMin: "",
  fBBuyInMax: "",
  fBEndingMin: "",
  fBEndingMax: "",
  fBDeltaMin: "",
  fBDeltaMax: "",
  fBMemo: "",
  fBBalanceId: "",
};

export type SortKey =
  | "last_updated"
  | "date"
  | "buy_in_bb"
  | "ending_bb"
  | "delta";
export type SortDir = "asc" | "desc";

export function useBalanceFilter(
  balances: BalanceItem[],
  initialSortKey: SortKey = "last_updated",
  initialSortDir: SortDir = "desc"
) {
  const [filterState, setFilterState] =
    useState<BalanceFilterState>(INITIAL_FILTER_STATE);

  const [sortKey, setSortKey] = useState<SortKey>(initialSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [sortClicked, setSortClicked] = useState(false);

  const filteredBalances = useMemo(() => {
    const {
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
    } = filterState;

    const uStart = toMs(fBUStart);
    const uEnd = toMs(fBUEnd);
    const dStart = toMsDateOnly(fBDateStart);
    const dEnd = toMsDateOnlyEnd(fBDateEnd);
    const biMin = parseFloat(fBBuyInMin);
    const biMax = parseFloat(fBBuyInMax);
    const enMin = parseFloat(fBEndingMin);
    const enMax = parseFloat(fBEndingMax);
    const deMin = parseFloat(fBDeltaMin);
    const deMax = parseFloat(fBDeltaMax);

    return balances.filter((b) => {
      // 最終更新日時
      const t = b.last_updated?.toMillis?.() || null;
      if (uStart != null && (t == null || t < uStart)) return false;
      if (uEnd != null && (t == null || t > uEnd)) return false;
      // プレイヤー
      if (fBPlayer && b.player_uid !== fBPlayer) return false;
      // 日付
      if (fBDateStart || fBDateEnd) {
        const dm =
          b.date_ts?.toMillis?.() ??
          (b.date ? new Date(b.date).setHours(0, 0, 0, 0) : null);
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
      if (!isNaN(biMin) && !(bi >= biMin)) return false;
      if (!isNaN(biMax) && !(bi <= biMax)) return false;
      if (!isNaN(enMin) && !(en >= enMin)) return false;
      if (!isNaN(enMax) && !(en <= enMax)) return false;
      if (!isNaN(deMin) && !(de >= deMin)) return false;
      if (!isNaN(deMax) && !(de <= deMax)) return false;
      // メモ
      if (
        fBMemo &&
        !(b.memo || "").toLowerCase().includes(fBMemo.toLowerCase())
      )
        return false;
      // balance_id
      if (fBBalanceId && String(b.balance_id) !== fBBalanceId.trim())
        return false;

      return true;
    });
  }, [balances, filterState]);

  const sortedBalances = useMemo(() => {
    const arr = [...filteredBalances];
    const getVal = (b: BalanceItem, k: SortKey): number => {
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
          return deltaOf(b);
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
  }, [filteredBalances, sortKey, sortDir]);

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

  const totalDelta = useMemo(
    () => sortedBalances.reduce((sum, b) => sum + deltaOf(b), 0),
    [sortedBalances]
  );

  return {
    filterState,
    setFilterState,
    sortKey,
    sortDir,
    sortClicked,
    toggleSort,
    sortedBalances,
    totalDelta,
  };
}
