import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type {
  BalanceDoc,
  GroupDoc,
  HistoryDoc,
  PlayerDoc,
} from "../types/poker";
import { creatorNameOf, pad6 } from "../utils/poker";
import TabButton from "../components/TabButton";
import RankingTable from "../components/RankingTable";
import BalanceDatabaseView from "../components/BalanceDatabaseView";
import HistoryList from "../components/HistoryList";
import GroupSettingsForm from "../components/GroupSettingsForm";
import { useBalanceFilter } from "../hooks/useBalanceFilter";

// ========== ページ本体 ==========
export default function AdminGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();

  const TABS = [
    "グループ設定",
    "収支ランキング",
    "収支一覧",
    "更新履歴",
  ] as const;
  type TabType = (typeof TABS)[number];
  const [tab, setTab] = useState<TabType>("グループ設定");

  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  const [balances, setBalances] = useState<BalanceDoc[]>([]);
  const [histories, setHistories] = useState<HistoryDoc[]>([]);


  useEffect(() => {
    (async () => {
      if (!groupId) return;

      // group
      const gref = doc(db, "groups", groupId);
      const gsnap = await getDoc(gref);
      if (gsnap.exists()) {
        const g = gsnap.data() as GroupDoc;
        setGroup(g);
      }

      // players
      const plist = await getDocs(collection(db, "groups", groupId, "players"));
      const pmap: Record<string, PlayerDoc> = {};
      plist.docs.forEach((d) => (pmap[d.id] = d.data() as PlayerDoc));
      setPlayers(pmap);

      // balances（ランキング用）
      const bq = query(
        collection(db, "groups", groupId, "balances"),
        where("is_deleted", "==", false)
      );
      const bs = await getDocs(bq);
      // __id is not strictly needed for admin view list unless we add delete/edit features there
      // casting is fine
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

  const balanceHook = useBalanceFilter(balances as any);



  if (!group) return <div style={{ padding: 24 }}>Loading...</div>;


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
            <GroupSettingsForm group={group} onUpdate={setGroup} />
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
              {/* Use shared component */}
              <RankingTable balances={balances} players={players} />
            </div>
          )}

          {/* ========== 収支一覧 ========== */}
          {tab === "収支一覧" && (
            // Use shared component w/ cast
            // Use shared component w/ cast
            <BalanceDatabaseView
              players={players}
              mode="admin"
              {...balanceHook}
            />
          )}

          {/* ========== 更新履歴 ========== */}
          {tab === "更新履歴" && (
            <HistoryList histories={histories} players={players} />
          )}
        </div>
      </div>
    </div>
  );
}
