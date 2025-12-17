import { useMemo, useState } from "react";
import type { BalanceRow } from "../types/poker";
import { fmtDiff } from "../utils/poker";

type Props = {
  balances: BalanceRow[];
  onDateClick?: (date: string) => void;
};

export default function BalanceCalendarView({ balances, onDateClick }: Props) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const monthStr = useMemo(
    () =>
      `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
    [month]
  );

  const monthBalances = useMemo(() => {
    const prefix = monthStr + "-";
    return balances.filter((b) => b.date.startsWith(prefix));
  }, [balances, monthStr]);

  const gridDays = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const days = last.getDate();
    const startWeek = (first.getDay() + 6) % 7; // 月曜スタート
    const cells: { label: string; inMonth: boolean; date?: string }[] = [];
    for (let i = 0; i < startWeek; i++)
      cells.push({ label: "", inMonth: false });
    for (let d = 1; d <= days; d++) {
      const dd = String(d).padStart(2, "0");
      cells.push({
        label: String(d),
        inMonth: true,
        date: `${monthStr}-${dd}`,
      });
    }
    return cells;
  }, [month, monthStr]);

  // 月間合計
  const totalDelta = useMemo(
    () => monthBalances.reduce((a, b) => a + (b.ending_bb - b.buy_in_bb), 0),
    [monthBalances]
  );

  return (
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 16,
        padding: 24,
        background: "#fff",
      }}
    >
      {/* 年月ナビ */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <button
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
          style={{
            background: "transparent",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: "4px 8px",
            cursor: "pointer",
          }}
        >
          &lt; 前月
        </button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {month.getFullYear()}年 {month.getMonth() + 1}月
        </div>
        <button
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
          style={{
            background: "transparent",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: "4px 8px",
            cursor: "pointer",
          }}
        >
          翌月 &gt;
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 700,
          color: "#999",
          paddingBottom: 8,
          borderBottom: "1px solid #eee",
        }}
      >
        <div>月</div>
        <div>火</div>
        <div>水</div>
        <div>木</div>
        <div>金</div>
        <div style={{ color: "blue" }}>土</div>
        <div style={{ color: "red" }}>日</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
        }}
      >
        {gridDays.map((c, i) => {
          const dayBalances = c.date
            ? monthBalances.filter((b) => b.date === c.date)
            : [];
          // 日次集計
          const dayDelta = dayBalances.reduce(
            (a, b) => a + (b.ending_bb - b.buy_in_bb),
            0
          );
          const hasData = dayBalances.length > 0;
          const { text, color } = fmtDiff(dayDelta);

          return (
            <div
              key={i}
              style={{
                minHeight: 80,
                borderBottom: "1px solid #f4f4f7",
                borderRight: (i + 1) % 7 === 0 ? "none" : "1px solid #f4f4f7",
                padding: 4,
                background: c.inMonth ? "#fff" : "#fafafa",
                cursor: c.inMonth && c.date ? "pointer" : "default",
              }}
              onClick={() => {
                if (c.inMonth && c.date && onDateClick) {
                  onDateClick(c.date);
                }
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: c.inMonth ? "#333" : "#ccc",
                }}
              >
                {c.label}
              </div>
              {c.inMonth && hasData && (
                <div
                  style={{
                    marginTop: 4,
                    textAlign: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    color: color,
                  }}
                >
                  {text}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, textAlign: "right" }}>
        <span style={{ fontSize: 12, color: "#777" }}>月間合計:</span>
        <span
          style={{
            marginLeft: 8,
            fontSize: 16,
            fontWeight: 700,
            color: totalDelta >= 0 ? "#111" : "#d00",
          }}
        >
          {fmtDiff(totalDelta).text}
        </span>
      </div>
      <div
        style={{
          marginTop: 16,
          fontSize: 12,
          color: "#888",
          textAlign: "center",
        }}
      >
        ※ 日付をクリックするとデータベースビューに移り、詳細を確認できます
      </div>
    </div>
  );
}
