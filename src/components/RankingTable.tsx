import { useMemo } from "react";
import type { BalanceDoc, PlayerDoc } from "../types/poker";
import { fmtDiff } from "../utils/poker";

type Props = {
  balances: BalanceDoc[];
  players: Record<string, PlayerDoc>;
  topN?: number; // If provided, slice the result
  myPlayerUid?: string; // If provided, highlight self & ensure visibility
};

export default function RankingTable({
  balances,
  players,
  topN,
  myPlayerUid,
}: Props) {
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

  const displayRows = useMemo(() => {
    if (!topN) return ranking;
    const top = ranking.slice(0, topN);

    // If highlighting self is requested:
    if (myPlayerUid) {
      const inTop = top.some((r) => r.uid === myPlayerUid);
      const myRow = ranking.find((r) => r.uid === myPlayerUid);

      if (!inTop && myRow) {
        // Not in top N, append with a separator indicator if feasible,
        // or just append to list.
        // We'll trust the rendering logic to show rank properly.
        return [...top, { ...myRow, isOutsider: true }];
      }
    }
    return top;
  }, [ranking, topN, myPlayerUid]);

  // Shared styles
  const th: React.CSSProperties = {
    padding: "8px 12px",
    background: "#f4f4f5",
    fontSize: 12,
    color: "#555",
    fontWeight: 600,
    textAlign: "left",
  };
  const td: React.CSSProperties = {
    padding: "8px 12px",
    borderBottom: "1px solid #eee",
    fontSize: 14,
  };

  if (displayRows.length === 0) {
    return <div style={{ opacity: 0.7 }}>データがありません。</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>順位</th>
          <th style={th}>表示名</th>
          <th style={{ ...th, textAlign: "right" }}>累計BB</th>
        </tr>
      </thead>
      <tbody>
        {displayRows.map((r) => {
          // If isOutsider, we might want a separator or visual cue.
          // But simpler: just render. The index usually implies rank,
          // but for outsider we need real rank from full list.
          const realRank =
            ranking.findIndex((x) => x.uid === r.uid) + 1;
          const isMe = r.uid === myPlayerUid;

          // Outsider separator
          const isOutsider = (r as any).isOutsider;

          return (
            <>
              {isOutsider && (
                <tr key="sep">
                  <td
                    colSpan={3}
                    style={{
                      textAlign: "center",
                      fontSize: 12,
                      color: "#999",
                      padding: 4,
                      background: "#fafafa",
                    }}
                  >
                    ...
                  </td>
                </tr>
              )}
              <tr
                key={r.uid}
                style={{
                  background: isMe ? "#eef2ff" : undefined,
                }}
              >
                <td style={{ ...td, fontWeight: isMe ? 700 : undefined }}>
                  {realRank}
                </td>
                <td style={{ ...td, fontWeight: isMe ? 700 : undefined }}>
                  {r.name}
                </td>
                <td
                  style={{
                    ...td,
                    textAlign: "right",
                    fontWeight: 600,
                  }}
                >
                  {(() => {
                    const { text, color } = fmtDiff(r.total);
                    return <span style={{ color }}>{text}</span>;
                  })()}
                </td>
              </tr>
            </>
          );
        })}
      </tbody>
    </table>
  );
}
