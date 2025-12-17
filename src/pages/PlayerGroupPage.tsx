import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import type {
  BalanceDoc,
  BalanceRow,
  GroupDoc,
  PlayerDoc,
} from "../types/poker";
import {
  fmtDiff,
  getFixedStakes,
  pad6,
  randDigits,
} from "../utils/poker";
import TabButton from "../components/TabButton";
import RankingTable from "../components/RankingTable";
import BalanceDatabaseView from "../components/BalanceDatabaseView";
import BalanceCalendarView from "../components/BalanceCalendarView";
import BalanceFormModal from "../components/BalanceFormModal";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import { usePlayerActions } from "../hooks/usePlayerActions";
import {
  INITIAL_FILTER_STATE,
  useBalanceFilter,
} from "../hooks/useBalanceFilter";

export default function PlayerGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const user = auth.currentUser;

  // --- 基本情報 ---
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [me, setMe] = useState<PlayerDoc | null>(null);

  // --- タブ ---
  const TABS = ["収支報告", "収支確認", "上位ランキング"] as const;
  const [tab, setTab] = useState<(typeof TABS)[number]>("収支報告");

  // --- balances / players ---
  const [myBalances, setMyBalances] = useState<BalanceRow[]>([]);
  const [allBalances, setAllBalances] = useState<BalanceRow[]>([]);
  const [playersMap, setPlayersMap] = useState<Record<string, PlayerDoc>>({}); // key = uid

  // --- 収支報告 ---
  const [openReport, setOpenReport] = useState(false);
  // Default values for report modal
  const [defReportDate, setDefReportDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  // Optional: preserve last entered stakes if not fixed?
  // User logic: "staksSB" / "stakesBB" were state.
  // We can keep them as "defaults" to pass to modal.
  const [defStakesSB] = useState("");
  const [defStakesBB] = useState("");

  // --- 収支確認（ビュー切替・カレンダー） ---
  const [confirmView, setConfirmView] = useState<"calendar" | "table">(
    "calendar"
  );

  // --- 編集/削除（︙メニュー & モーダル）
  const [menuTarget, setMenuTarget] = useState<BalanceRow | null>(null);
  const [openEdit, setOpenEdit] = useState(false);
  // State variables moved to BalanceEditModal

  const [openDelete, setOpenDelete] = useState(false);

  // -------------- 初期ロード --------------
  useEffect(() => {
    (async () => {
      if (!groupId || !user) return;

      // 1) グループ取得
      const gref = doc(db, "groups", groupId);
      const gsnap = await getDoc(gref);
      if (!gsnap.exists()) return;
      const g = gsnap.data() as GroupDoc;
      setGroup(g);

      // 2) 自分の players ドキュメント（なければ作成）
      const pref = doc(db, "groups", groupId, "players", user.uid);
      const psnap = await getDoc(pref);
      if (!psnap.exists()) {
        const uref = doc(db, "users", user.uid);
        const usnap = await getDoc(uref);
        const fixedName =
          (usnap.exists() ? (usnap.data() as any).display_name : null) ||
          user.displayName ||
          "No Name";
        const pdoc: PlayerDoc = {
          player_id: parseInt(randDigits(6), 10),
          group_id: g.group_id,
          display_name: fixedName,
          email: user.email ?? "",
          total_balance: 0,
        };
        await setDoc(pref, pdoc);
        setMe(pdoc);
      } else {
        setMe(psnap.data() as PlayerDoc);
      }

      // 3) 自分の balances（is_deleted=false & 日付降順）
      const q1 = query(
        collection(db, "groups", groupId, "balances"),
        where("player_uid", "==", user.uid),
        where("is_deleted", "==", false),
        orderBy("date_ts", "desc")
      );
      const b1 = await getDocs(q1);
      setMyBalances(
        b1.docs.map((d) => ({ __id: d.id, ...(d.data() as BalanceDoc) }))
      );

      // 4) 全員の balances（ランキング用）
      const q2 = query(
        collection(db, "groups", groupId, "balances"),
        where("is_deleted", "==", false),
        orderBy("date_ts", "desc")
      );
      const b2 = await getDocs(q2);
      setAllBalances(
        b2.docs.map((d) => ({ __id: d.id, ...(d.data() as BalanceDoc) }))
      );

      // 5) players 一覧（uid -> PlayerDoc）
      const plist = await getDocs(collection(db, "groups", groupId, "players"));
      const pmap: Record<string, PlayerDoc> = {};
      plist.docs.forEach((d) => {
        pmap[d.id] = d.data() as PlayerDoc;
      });
      setPlayersMap(pmap);
    })();
  }, [groupId, user]);

  // -------------- 集計・派生 --------------
  // カレンダー用（日付降順）
  const myBalancesSorted = useMemo(
    () =>
      [...myBalances].sort(
        (a, b) =>
          (b.date_ts?.toMillis?.() ?? 0) - (a.date_ts?.toMillis?.() ?? 0)
      ),
    [myBalances]
  );

  const balanceHook = useBalanceFilter(myBalances as BalanceRow[]);

  // -------------- 共通: 履歴作成 --------------
  // -------------- アクション (Hook) --------------
  const { submitBalance, saveEdit, doDelete, deleting } = usePlayerActions({
    groupId,
    user,
    me,
    group,
    setMyBalances,
    setAllBalances,
    setMe,
    onCloseReport: () => {
      setOpenReport(false);
      // Reset defaults handled by component or simple state reset if needed
      setDefReportDate(new Date().toISOString().slice(0, 10));
    },
    onCloseEdit: () => {
      setOpenEdit(false);
      setMenuTarget(null);
    },
    onCloseDelete: () => {
      setOpenDelete(false);
      setMenuTarget(null);
    },
  });

  // -------------- 表示 --------------
  if (!group || !me) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  const fixed = getFixedStakes(group);

  function openReportModal() {
    if (fixed) {
      // Logic handled via props or component internal
    }
    setOpenReport(true);
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
              {group.group_name}{" "}
              <span style={{ opacity: 0.6, fontSize: 14 }}>
                ID {pad6(group.group_id)}
              </span>
            </h2>
            <div style={{ opacity: 0.7, fontSize: 13 }}>
              Player: <strong>{me.display_name}</strong>（{me.email || "-"}） /
              累計:{" "}
              <strong>
                {(() => {
                  const { text, color } = fmtDiff(me.total_balance ?? 0);
                  return <span style={{ color }}>{text}</span>;
                })()}
              </strong>
            </div>
          </div>
          <Link
            to="/player"
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
          {/* ========== 収支報告 ========== */}
          {tab === "収支報告" && (
            <div
              style={{
                display: "grid",
                placeItems: "center",
                padding: "40px 0",
                background: "#f8f8fb",
                borderRadius: 16,
              }}
            >
              <button
                onClick={openReportModal}
                style={{
                  padding: "16px 32px",
                  borderRadius: 999,
                  background: "#111",
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
              >
                + 収支を報告する
              </button>
              <div
                style={{
                  marginTop: 20,
                  fontSize: 12,
                  color: "#666",
                  textAlign: "left",
                  lineHeight: 1.6,
                }}
              >
                ※ ステークスは SB と BB を入力すると、&quot;SB/BB&quot;
                形式で保存されます（例: 1/3）。
                <br />
                グループでステークスが固定されている場合、固定値（SB/BB）が表示され編集できません。
                <br />
                差分 = 終了BB - バイインBB を累計に反映します。
              </div>
              
            </div>
          )}

          {/* ========== 収支確認 ========== */}
          {tab === "収支確認" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 12,
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    background: "#f4f4f7",
                    borderRadius: 999,
                    padding: 4,
                    display: "flex",
                  }}
                >
                  <button
                    onClick={() => setConfirmView("calendar")}
                    style={{
                      border: "none",
                      background:
                        confirmView === "calendar" ? "#fff" : "transparent",
                      borderRadius: 999,
                      padding: "6px 16px",
                      fontSize: 14,
                      fontWeight: confirmView === "calendar" ? 700 : 500,
                      cursor: "pointer",
                      boxShadow:
                        confirmView === "calendar"
                          ? "0 2px 5px rgba(0,0,0,0.05)"
                          : "none",
                    }}
                  >
                    カレンダー
                  </button>
                  <button
                    onClick={() => setConfirmView("table")}
                    style={{
                      border: "none",
                      background:
                        confirmView === "table" ? "#fff" : "transparent",
                      borderRadius: 999,
                      padding: "6px 16px",
                      fontSize: 14,
                      fontWeight: confirmView === "table" ? 700 : 500,
                      cursor: "pointer",
                      boxShadow:
                        confirmView === "table"
                          ? "0 2px 5px rgba(0,0,0,0.05)"
                          : "none",
                    }}
                  >
                    データベース
                  </button>
                </div>
              </div>

              {confirmView === "calendar" && (
                <BalanceCalendarView
                  balances={myBalancesSorted}
                  onDateClick={(date) => {
                    balanceHook.setFilterState({
                      ...INITIAL_FILTER_STATE,
                      fBDateStart: date,
                      fBDateEnd: date,
                    });
                    setConfirmView("table");
                  }}
                />
              )}

              {confirmView === "table" && (
                // Use shared component
                <BalanceDatabaseView
                  {...balanceHook}
                  players={playersMap}
                  mode="player"
                  onAction={(b) => {
                    setMenuTarget(b);
                    setOpenEdit(true);
                  }}
                />
              )}
            </div>
          )}

          {/* ========== 上位ランキング ========== */}
          {tab === "上位ランキング" && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <h3 style={{ marginTop: 0 }}>上位ランキング (Top {group!.settings?.ranking_top_n ?? 10})</h3>
              <RankingTable
                balances={allBalances}
                players={playersMap}
                topN={group!.settings?.ranking_top_n ?? 10}
                myPlayerUid={user?.uid}
              />
            </div>
          )}
        </div>
      </div>

      {/* --- 収支報告モーダル --- */}
      <BalanceFormModal
        open={openReport}
        onClose={() => setOpenReport(false)}
        balance={null}
        group={group}
        defaultDate={defReportDate}
        defaultStakes={{ sb: defStakesSB, bb: defStakesBB }}
        onSave={submitBalance}
      />

      {/* --- 編集モーダル --- */}
      <BalanceFormModal
        open={openEdit}
        onClose={() => setOpenEdit(false)}
        balance={menuTarget}
        group={group}
        onSave={async (data) => {
          if (menuTarget) await saveEdit(menuTarget, data);
        }}
        onDeleteRequest={() => {
          setOpenEdit(false);
          setOpenDelete(true);
        }}
      />

      {/* --- 削除確認モーダル --- */}
      <DeleteConfirmModal
        open={openDelete}
        onClose={() => setOpenDelete(false)}
        onDelete={() => {
          if (menuTarget) doDelete(menuTarget);
        }}
        deleting={deleting}
      />
    </div>
  );
}
