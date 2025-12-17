import { useMemo, useState } from "react";
import type { BalanceRow, PlayerDoc } from "../types/poker";
import {
  type BalanceFilterState,
  INITIAL_FILTER_STATE,
  type SortKey,
  type BalanceItem,
} from "../hooks/useBalanceFilter";
import Modal from "./Modal";
import { fmtDiff, playerNameOf } from "../utils/poker";

type Props = {
  // Lifted state from useBalanceFilter
  filterState: BalanceFilterState;
  setFilterState: React.Dispatch<React.SetStateAction<BalanceFilterState>>;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  sortClicked: boolean;
  toggleSort: (k: SortKey) => void;
  sortedBalances: BalanceItem[];
  totalDelta: number;

  balances?: BalanceRow[]; // Optional now as we use sortedBalances
  players: Record<string, PlayerDoc>;
  mode: "admin" | "player";
  // Player mode might have actions
  onAction?: (b: BalanceRow) => void;
};

export default function BalanceDatabaseView({
  filterState,
  setFilterState,
  sortKey,
  sortDir,
  sortClicked,
  toggleSort,
  sortedBalances,
  totalDelta,
  players,
  mode,
  onAction,
}: Props) {

  const [openFilter, setOpenFilter] = useState(false);

  // Player Selection Options
  const playerOptions = useMemo(
    () =>
      Object.entries(players)
        .map(([uid, p]) => ({ uid, name: p.display_name || uid }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [players]
  );

  // Helper to update one filter field
  const setF = (key: keyof BalanceFilterState, val: string) => {
    setFilterState((prev) => ({ ...prev, [key]: val }));
  };

  // Filter Summary Chips
  const filterSummary = useMemo(() => {
    const items: { label: string; clear: () => void }[] = [];
    const s = filterState;

    if (s.fBUStart || s.fBUEnd) {
      items.push({
        label: `最終更新: ${s.fBUStart || "…"}〜${s.fBUEnd || "…"}`,
        clear: () => setFilterState((p) => ({ ...p, fBUStart: "", fBUEnd: "" })),
      });
    }
    if (s.fBPlayer) {
      items.push({
        label: `プレイヤー: ${playerNameOf(s.fBPlayer, players) || s.fBPlayer}`,
        clear: () => setF("fBPlayer", ""),
      });
    }
    if (s.fBDateStart || s.fBDateEnd) {
      items.push({
        label: `日付: ${s.fBDateStart || "…"}〜${s.fBDateEnd || "…"}`,
        clear: () =>
          setFilterState((p) => ({ ...p, fBDateStart: "", fBDateEnd: "" })),
      });
    }
    if (s.fBStakes) {
      items.push({
        label: `ステークス: ${s.fBStakes}`,
        clear: () => setF("fBStakes", ""),
      });
    }
    if (s.fBBuyInMin || s.fBBuyInMax) {
      items.push({
        label: `BuyIn: ${s.fBBuyInMin || "…"}〜${s.fBBuyInMax || "…"}`,
        clear: () =>
          setFilterState((p) => ({ ...p, fBBuyInMin: "", fBBuyInMax: "" })),
      });
    }
    if (s.fBEndingMin || s.fBEndingMax) {
      items.push({
        label: `Ending: ${s.fBEndingMin || "…"}〜${s.fBEndingMax || "…"}`,
        clear: () =>
          setFilterState((p) => ({ ...p, fBEndingMin: "", fBEndingMax: "" })),
      });
    }
    if (s.fBDeltaMin || s.fBDeltaMax) {
      items.push({
        label: `差分: ${s.fBDeltaMin || "…"}〜${s.fBDeltaMax || "…"}`,
        clear: () =>
          setFilterState((p) => ({ ...p, fBDeltaMin: "", fBDeltaMax: "" })),
      });
    }
    if (s.fBMemo) {
      items.push({
        label: `メモ: ${s.fBMemo}`,
        clear: () => setF("fBMemo", ""),
      });
    }
    if (s.fBBalanceId) {
      items.push({
        label: `ID: ${s.fBBalanceId}`,
        clear: () => setF("fBBalanceId", ""),
      });
    }
    return items;
  }, [filterState, players]);

  // Styles
  const th: React.CSSProperties = {
    padding: "8px 12px",
    background: "#f4f4f5",
    fontSize: 12,
    color: "#555",
    fontWeight: 600,
    textAlign: "left",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "8px 12px",
    borderBottom: "1px solid #eee",
    fontSize: 14,
  };
  const inp: React.CSSProperties = {
    padding: 8,
    borderRadius: 6,
    border: "1px solid #ccc",
    width: "100%",
    boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
    display: "block",
  };

  const SortHeader = ({
    k,
    label,
    align = "left",
  }: {
    k: SortKey;
    label: string;
    align?: "left" | "right";
  }) => (
    <th style={{ ...th, textAlign: align }}>
      <button
        onClick={() => toggleSort(k)}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {(!sortClicked || sortKey !== k) && "▲▼"}
          {sortClicked && sortKey === k && (sortDir === "asc" ? "▲" : "▼")}
        </span>
      </button>
    </th>
  );

  return (
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 12,
        padding: 12,
        overflow: "auto",
        background: "#fff",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 6 }}>
        {mode === "admin" ? "現在の収支一覧" : "データベースビュー"}
      </h3>
      <div style={{ marginTop: 8, fontSize: 14 }}>
        合計（差分）:{" "}
        {(() => {
          const { text, color } = fmtDiff(totalDelta);
          return <span style={{ fontWeight: 700, color }}>{text}</span>;
        })()}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginTop: 8,
          marginBottom: 8,
        }}
      >
        <button
          onClick={() => setOpenFilter(true)}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          絞り込み
        </button>
        {filterSummary.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {filterSummary.map((it, i) => (
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

      {sortedBalances.length === 0 ? (
        <div style={{ opacity: 0.7 }}>データがありません。</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <SortHeader k="last_updated" label="最終更新" />
              {mode === "admin" && <th style={th}>プレイヤー</th>}
              <SortHeader k="date" label="日付" />
              <th style={th}>ステークス</th>
              <SortHeader k="buy_in_bb" label="BuyIn" align="right" />
              <SortHeader k="ending_bb" label="Ending" align="right" />
              <SortHeader k="delta" label="差分" align="right" />
              <th style={th}>メモ</th>
              <th style={th}>ID</th>
              {mode === "player" && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {sortedBalances.map((b, idx) => {
              const delta =
                (Number(b.ending_bb) || 0) - (Number(b.buy_in_bb) || 0);
              const { text, color } = fmtDiff(delta);
              const name = playerNameOf(b.player_uid, players) || "(unknown)";
              const when = b.last_updated?.toDate?.() || b.date_ts?.toDate?.();

              return (
                <tr key={(b as any).__id || idx}>
                  <td style={td}>{when ? when.toLocaleString() : "-"}</td>
                  {mode === "admin" && <td style={td}>{name}</td>}
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
                      color: color,
                    }}
                  >
                    {b.buy_in_bb != null && b.ending_bb != null ? text : "-"}
                  </td>
                  <td style={td}>{b.memo || "-"}</td>
                  <td style={td}>{b.balance_id}</td>
                  {mode === "player" && (
                    <td style={{ ...td, textAlign: "right", width: 48 }}>
                      <button
                        onClick={() => onAction && onAction(b as BalanceRow)}
                        title="編集/削除"
                        style={{
                          padding: "4px 8px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        ︙
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Filter Modal */}
      <Modal
        open={openFilter}
        onClose={() => setOpenFilter(false)}
        width={720}
      >
        <h3 style={{ marginTop: 0 }}>絞り込み</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {/* Admin filters for Last Updated & Player */}
          {mode === "admin" && (
            <>
              <div>
                <label style={lbl}>最終更新（開始）</label>
                <input
                  type="datetime-local"
                  value={filterState.fBUStart}
                  onChange={(e) => setF("fBUStart", e.target.value)}
                  style={inp}
                />
              </div>
              <div>
                <label style={lbl}>最終更新（終了）</label>
                <input
                  type="datetime-local"
                  value={filterState.fBUEnd}
                  onChange={(e) => setF("fBUEnd", e.target.value)}
                  style={inp}
                />
              </div>
              <div>
                <label style={lbl}>プレイヤー</label>
                <select
                  value={filterState.fBPlayer}
                  onChange={(e) => setF("fBPlayer", e.target.value)}
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
            </>
          )}

          <div>
            <label style={lbl}>日付（開始）</label>
            <input
              type="date"
              value={filterState.fBDateStart}
              onChange={(e) => setF("fBDateStart", e.target.value)}
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>日付（終了）</label>
            <input
              type="date"
              value={filterState.fBDateEnd}
              onChange={(e) => setF("fBDateEnd", e.target.value)}
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>ステークス</label>
            <input
              value={filterState.fBStakes}
              onChange={(e) => setF("fBStakes", e.target.value)}
              placeholder="部分一致"
              style={inp}
            />
          </div>
          <div />
          <div>
            <label style={lbl}>BuyIn 最小</label>
            <input
              value={filterState.fBBuyInMin}
              onChange={(e) => setF("fBBuyInMin", e.target.value)}
              inputMode="decimal"
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>BuyIn 最大</label>
            <input
              value={filterState.fBBuyInMax}
              onChange={(e) => setF("fBBuyInMax", e.target.value)}
              inputMode="decimal"
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>Ending 最小</label>
            <input
              value={filterState.fBEndingMin}
              onChange={(e) => setF("fBEndingMin", e.target.value)}
              inputMode="decimal"
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>Ending 最大</label>
            <input
              value={filterState.fBEndingMax}
              onChange={(e) => setF("fBEndingMax", e.target.value)}
              inputMode="decimal"
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>差分 最小</label>
            <input
              value={filterState.fBDeltaMin}
              onChange={(e) => setF("fBDeltaMin", e.target.value)}
              inputMode="decimal"
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>差分 最大</label>
            <input
              value={filterState.fBDeltaMax}
              onChange={(e) => setF("fBDeltaMax", e.target.value)}
              inputMode="decimal"
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>メモ</label>
            <input
              value={filterState.fBMemo}
              onChange={(e) => setF("fBMemo", e.target.value)}
              placeholder="部分一致"
              style={inp}
            />
          </div>
          <div />
          <div>
            <label style={lbl}>balance_id（完全一致）</label>
            <input
              value={filterState.fBBalanceId}
              onChange={(e) =>
                setF("fBBalanceId", e.target.value.replace(/[^0-9]/g, ""))
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
            onClick={() => setFilterState(INITIAL_FILTER_STATE)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            クリア
          </button>
          <button
            onClick={() => setOpenFilter(false)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            適用
          </button>
        </div>
      </Modal>
    </div>
  );
}
