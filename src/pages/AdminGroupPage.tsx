// src/pages/AdminGroupPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../lib/firebase";
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

  const TABS = ["グループ設定", "収支ランキング", "更新履歴"] as const;
  const [tab, setTab] = useState<(typeof TABS)[number]>("グループ設定");

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [balances, setBalances] = useState<BalanceDoc[]>([]);
  const [histories, setHistories] = useState<HistoryDoc[]>([]);

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
          {tab === "更新履歴" && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
                overflow: "auto",
              }}
            >
              <h3 style={{ marginTop: 0 }}>更新履歴</h3>
              {histories.length === 0 ? (
                <div style={{ opacity: 0.7 }}>まだ履歴がありません。</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>日時</th>
                      <th style={th}>種別</th>
                      <th style={th}>行</th>
                      <th style={th}>プレイヤー</th>
                      <th style={th}>日付</th>
                      <th style={th}>ステークス</th>
                      <th style={{ ...th, textAlign: "right" }}>BuyIn</th>
                      <th style={{ ...th, textAlign: "right" }}>Ending</th>
                      <th style={{ ...th, textAlign: "right" }}>差分</th>
                      <th style={th}>メモ</th>
                      <th style={th}>balance_id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {histories.map((h, hi) => {
                      const rows = expandHistory(h);
                      if (rows.length === 0) return null;
                      const rowSpan = rows.length;

                      return rows.map((r, ri) => {
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
