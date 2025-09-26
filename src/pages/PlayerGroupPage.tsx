import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import Modal from "../components/Modal";

// ========== 型 ==========
type GroupSettings = {
  stakes_fixed: boolean;
  // 新仕様: SB/BBを別で固定
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
};

type PlayerDoc = {
  player_id: number; // 6桁
  group_id: number;
  display_name: string;
  email: string;
  total_balance: number; // 累計BB
};

type BalanceDoc = {
  balance_id: number; // 9桁
  group_id: number;
  player_id: number;
  player_uid: string;
  date: string; // YYYY-MM-DD
  date_ts: any; // Timestamp
  stakes: string; // "SB/BB" として保存（例: "1/3"）
  buy_in_bb: number;
  ending_bb: number;
  memo: string;
  last_updated: any; // Timestamp
  is_deleted: boolean;
};

type BalanceRow = BalanceDoc & { __id: string }; // Firestore doc id 保持

// ========== util ==========
const pad6 = (n: number | string) =>
  String(n).replace(/\D/g, "").padStart(6, "0");
const randDigits = (k: number) =>
  Array.from({ length: k }, () => Math.floor(Math.random() * 10)).join("");

const fmtDiff = (v: number) => {
  const sign = v >= 0 ? "+" : "-";
  const num = Math.abs(v).toFixed(1);
  const color = v >= 0 ? "#111" : "#d00";
  return { text: `${sign}${num}BB`, color };
};

// Adminが固定しているSB/BBを取得（旧stakes_valueの後方互換も考慮）
function getFixedStakes(
  group: GroupDoc | null
): { sb: number; bb: number } | null {
  if (!group?.settings?.stakes_fixed) return null;
  const s = group.settings!;
  if (typeof s.stakes_sb === "number" && typeof s.stakes_bb === "number") {
    return { sb: s.stakes_sb, bb: s.stakes_bb };
  }
  // 旧: "1/3" をパース
  if (s.stakes_value) {
    const [sb, bb] = String(s.stakes_value).split("/").map(Number);
    if (!isNaN(sb) && !isNaN(bb)) return { sb, bb };
  }
  return null;
}

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

  // --- 個人設定（表示名） ---
  const [openName, setOpenName] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // --- 収支報告 ---
  const [openReport, setOpenReport] = useState(false);
  const [reportDate, setReportDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  // ステークスは SB / BB を別入力して "SB/BB" 文字列で保存
  const [stakesSB, setStakesSB] = useState<string>("");
  const [stakesBB, setStakesBB] = useState<string>("");
  const [buyIn, setBuyIn] = useState<string>("");
  const [ending, setEnding] = useState<string>("");
  const [memo, setMemo] = useState("");
  const [savingReport, setSavingReport] = useState(false);

  // --- 収支確認（ビュー切替・カレンダー） ---
  const [confirmView, setConfirmView] = useState<"calendar" | "table">(
    "calendar"
  );
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const monthStr = useMemo(
    () =>
      `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
    [month]
  );

  // --- 編集/削除（︙メニュー & モーダル） ---
  const [menuTarget, setMenuTarget] = useState<BalanceRow | null>(null);
  const [openEdit, setOpenEdit] = useState(false);
  const [editSB, setEditSB] = useState("");
  const [editBB, setEditBB] = useState("");
  const [editBuyIn, setEditBuyIn] = useState("");
  const [editEnding, setEditEnding] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editDate, setEditDate] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [openDelete, setOpenDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
  const myBalancesSorted = useMemo(
    () =>
      [...myBalances].sort(
        (a, b) =>
          (b.date_ts?.toMillis?.() ?? 0) - (a.date_ts?.toMillis?.() ?? 0)
      ),
    [myBalances]
  );

  const monthBalances = useMemo(() => {
    const prefix = monthStr + "-";
    return myBalancesSorted.filter((b) => b.date.startsWith(prefix));
  }, [myBalancesSorted, monthStr]);

  const daysHas = useMemo(() => {
    const set = new Set(monthBalances.map((b) => b.date.slice(-2)));
    return set;
  }, [monthBalances]);

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

  const ranking = useMemo(() => {
    type RankRow = { uid: string; name: string; total: number };
    const sums: Record<string, number> = {};
    allBalances.forEach((b) => {
      sums[b.player_uid] =
        (sums[b.player_uid] ?? 0) + (b.ending_bb - b.buy_in_bb);
    });
    const rows: RankRow[] = Object.entries(sums).map(([uid, total]) => ({
      uid,
      name: playersMap[uid]?.display_name ?? "(unknown)",
      total,
    }));
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [allBalances, playersMap]);

  const rankingTopN = group?.settings?.ranking_top_n ?? 10;
  const rankingTop = useMemo(
    () => ranking.slice(0, rankingTopN),
    [ranking, rankingTopN]
  );

  // -------------- 共通: 履歴作成 --------------
  async function writeHistory(
    change_category: "create" | "update" | "delete",
    targetBalanceId: number,
    details: any
  ) {
    if (!groupId || !user || !me) return;
    await addDoc(collection(db, "groups", groupId, "balance_histories"), {
      history_id: parseInt(randDigits(9), 10),
      balance_id: targetBalanceId,
      changed_at: serverTimestamp(),
      change_category,
      change_details: details,
      changer_uid: user.uid,
      changer_player_id: me.player_id,
    });
  }

  // -------------- アクション --------------
  const saveDisplayName = async () => {
    if (!groupId || !user || !me) return;
    const name = newName.trim();
    if (!name) {
      alert("表示名を入力してください");
      return;
    }
    setSavingName(true);
    try {
      await updateDoc(doc(db, "groups", groupId, "players", user.uid), {
        display_name: name,
      });
      setMe({ ...me, display_name: name });
      setOpenName(false);
      setNewName("");
    } catch (e) {
      console.error(e);
      alert("表示名の更新に失敗しました");
    } finally {
      setSavingName(false);
    }
  };

  const submitBalance = async () => {
    if (!groupId || !user || !me || !group) return;

    const bi = Number(buyIn);
    const ed = Number(ending);
    const fixed = getFixedStakes(group);

    let sb: number;
    let bb: number;
    if (fixed) {
      sb = fixed.sb;
      bb = fixed.bb;
    } else {
      sb = Number(stakesSB);
      bb = Number(stakesBB);
    }

    if (!reportDate || isNaN(bi) || isNaN(ed) || isNaN(sb) || isNaN(bb)) {
      alert("日付 / SB / BB / バイイン / 終了BB を正しく入力してください");
      return;
    }
    if (sb <= 0 || bb <= 0) {
      alert("SB と BB は 0 より大きい数値にしてください");
      return;
    }

    setSavingReport(true);
    try {
      const stakesStr = `${sb}/${bb}`;

      const balance: BalanceDoc = {
        balance_id: parseInt(randDigits(9), 10),
        group_id: group.group_id,
        player_id: me.player_id,
        player_uid: user.uid,
        date: reportDate,
        date_ts: Timestamp.fromDate(new Date(reportDate + "T00:00:00")),
        stakes: stakesStr,
        buy_in_bb: bi,
        ending_bb: ed,
        memo: memo || "",
        last_updated: serverTimestamp(),
        is_deleted: false,
      };

      const ref = await addDoc(
        collection(db, "groups", groupId, "balances"),
        balance
      );
      // 画面に即反映
      const row: BalanceRow = {
        __id: ref.id,
        ...balance,
        last_updated: Timestamp.now(),
      };
      setMyBalances((prev) => [row, ...prev]);
      setAllBalances((prev) => [row, ...prev]);

      // 累計（簡易）：本番は Cloud Functions で厳密に
      const delta = ed - bi;
      await updateDoc(doc(db, "groups", groupId, "players", user.uid), {
        total_balance: (me.total_balance ?? 0) + delta,
      });
      setMe((prev) =>
        prev
          ? { ...prev, total_balance: (prev.total_balance ?? 0) + delta }
          : prev
      );

      await updateDoc(doc(db, "groups", groupId), {
        last_updated: serverTimestamp(),
      });

      // 履歴（create）
      await writeHistory("create", balance.balance_id, { after: balance });

      setOpenReport(false);
      setReportDate(new Date().toISOString().slice(0, 10));
      setStakesSB("");
      setStakesBB("");
      setBuyIn("");
      setEnding("");
      setMemo("");
    } catch (e) {
      console.error(e);
      alert("収支の登録に失敗しました");
    } finally {
      setSavingReport(false);
    }
  };

  function openMenuFor(b: BalanceRow) {
    setMenuTarget(b);
    setEditDate(b.date);

    const fixed = getFixedStakes(group);
    if (fixed) {
      setEditSB(String(fixed.sb));
      setEditBB(String(fixed.bb));
    } else {
      const [sb0, bb0] = (b.stakes || "").split("/");
      setEditSB(sb0 || "");
      setEditBB(bb0 || "");
    }

    setEditBuyIn(String(b.buy_in_bb));
    setEditEnding(String(b.ending_bb));
    setEditMemo(b.memo || "");
  }

  async function saveEdit() {
    if (!groupId || !user || !me || !menuTarget) return;
    setSavingEdit(true);
    try {
      const ref = doc(db, "groups", groupId, "balances", menuTarget.__id);

      // ステークス：固定なら固定値、未固定なら入力値
      const fixed = getFixedStakes(group);
      const sb = fixed ? fixed.sb : Number(editSB);
      const bb = fixed ? fixed.bb : Number(editBB);
      if (isNaN(sb) || isNaN(bb) || sb <= 0 || bb <= 0) {
        alert("SB/BB を正しく入力してください");
        setSavingEdit(false);
        return;
      }

      const before = { ...menuTarget };
      const deltaBefore = menuTarget.ending_bb - menuTarget.buy_in_bb;

      const patch = {
        date: editDate,
        date_ts: Timestamp.fromDate(new Date(editDate + "T00:00:00")),
        stakes: `${sb}/${bb}`,
        buy_in_bb: Number(editBuyIn),
        ending_bb: Number(editEnding),
        memo: editMemo,
        last_updated: serverTimestamp(),
      };

      await updateDoc(ref, patch);

      // ローカル更新
      setMyBalances((prev) =>
        prev.map((x) => (x.__id === menuTarget.__id ? { ...x, ...patch } : x))
      );
      setAllBalances((prev) =>
        prev.map((x) => (x.__id === menuTarget.__id ? { ...x, ...patch } : x))
      );

      // 累計の差分補正（簡易）
      const deltaAfter = Number(editEnding) - Number(editBuyIn);
      const deltaDiff = deltaAfter - deltaBefore;
      await updateDoc(doc(db, "groups", groupId, "players", user.uid), {
        total_balance: (me.total_balance ?? 0) + deltaDiff,
      });
      setMe((prev) =>
        prev
          ? { ...prev, total_balance: (prev.total_balance ?? 0) + deltaDiff }
          : prev
      );

      await updateDoc(doc(db, "groups", groupId), {
        last_updated: serverTimestamp(),
      });

      // 履歴（update）
      await writeHistory("update", before.balance_id, { before, after: patch });

      setOpenEdit(false);
      setMenuTarget(null);
    } catch (e) {
      console.error(e);
      alert("編集に失敗しました");
    } finally {
      setSavingEdit(false);
    }
  }

  async function doDelete() {
    if (!groupId || !user || !me || !menuTarget) return;
    setDeleting(true);
    try {
      const ref = doc(db, "groups", groupId, "balances", menuTarget.__id);
      const before = { ...menuTarget };

      await updateDoc(ref, {
        is_deleted: true,
        last_updated: serverTimestamp(),
      });

      // ローカルから除外
      setMyBalances((prev) => prev.filter((x) => x.__id !== menuTarget.__id));
      setAllBalances((prev) => prev.filter((x) => x.__id !== menuTarget.__id));

      // 累計補正（差分を打ち消す）
      const delta = menuTarget.ending_bb - menuTarget.buy_in_bb;
      await updateDoc(doc(db, "groups", groupId, "players", user.uid), {
        total_balance: (me.total_balance ?? 0) - delta,
      });
      setMe((prev) =>
        prev
          ? { ...prev, total_balance: (prev.total_balance ?? 0) - delta }
          : prev
      );

      await updateDoc(doc(db, "groups", groupId), {
        last_updated: serverTimestamp(),
      });

      // 履歴（delete）
      await writeHistory("delete", before.balance_id, { before });

      setOpenDelete(false);
      setMenuTarget(null);
    } catch (e) {
      console.error(e);
      alert("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  // -------------- 表示 --------------
  if (!group || !me) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }

  const fixed = getFixedStakes(group);
  const stakesFixed = !!fixed;

  // 報告モーダルを開くとき、固定されているならSB/BB表示用に値を入れておく
  function openReportModal() {
    if (fixed) {
      setStakesSB(String(fixed.sb));
      setStakesBB(String(fixed.bb));
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
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>
              Player: {group.group_name}{" "}
              <span style={{ opacity: 0.6, fontSize: 14 }}>
                ID {pad6(group.group_id)}
              </span>
            </h2>
            <div style={{ opacity: 0.7, fontSize: 13 }}>
              あなた: <strong>{me.display_name}</strong>（{me.email || "-"}） /
              累計:{" "}
              <strong>
                {(() => {
                  const { text, color } = fmtDiff(me.total_balance ?? 0);
                  return <span style={{ color }}>{text}</span>;
                })()}
              </strong>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link
              to="/player"
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            >
              参加グループ一覧へ
            </Link>
          </div>
        </div>

        <hr style={{ margin: "16px 0 12px" }} />

        {/* タブ */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <TabButton key={t} active={tab === t} onClick={() => setTab(t)}>
              {t}
            </TabButton>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          {/* --- 収支報告 --- */}
          {tab === "収支報告" && (
            <div>
              <button
                onClick={openReportModal}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                収支報告モーダルを開く
              </button>
              <div style={{ marginTop: 12, opacity: 0.7, fontSize: 13 }}>
                ※ ステークスは <strong>SB</strong> と <strong>BB</strong>{" "}
                を入力すると、
                <code>"SB/BB"</code> 形式で保存されます（例: <code>1/3</code>
                ）。
                <br />
                グループでステークスが固定されている場合、固定値（SB/BB）が表示され編集できません。
                <br />
                差分 = 終了BB - バイインBB を累計に反映します。
              </div>
            </div>
          )}

          {/* --- 収支確認 --- */}
          {tab === "収支確認" && (
            <div>
              {/* 切替ボタン */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <TabButton
                  active={confirmView === "calendar"}
                  onClick={() => setConfirmView("calendar")}
                >
                  カレンダービュー
                </TabButton>
                <TabButton
                  active={confirmView === "table"}
                  onClick={() => setConfirmView("table")}
                >
                  データベースビュー
                </TabButton>
              </div>

              {/* カレンダー */}
              {confirmView === "calendar" && (
                <div
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <h3 style={{ margin: 0 }}>カレンダービュー</h3>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() =>
                          setMonth(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() - 1,
                              1
                            )
                          )
                        }
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "#fff",
                        }}
                      >
                        ←
                      </button>
                      <div style={{ padding: "6px 10px" }}>{monthStr}</div>
                      <button
                        onClick={() =>
                          setMonth(
                            new Date(
                              month.getFullYear(),
                              month.getMonth() + 1,
                              1
                            )
                          )
                        }
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "#fff",
                        }}
                      >
                        →
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7,1fr)",
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                      (d) => (
                        <div
                          key={d}
                          style={{
                            textAlign: "center",
                            fontSize: 12,
                            opacity: 0.7,
                          }}
                        >
                          {d}
                        </div>
                      )
                    )}
                    {gridDays.map((c, i) => (
                      <div
                        key={i}
                        style={{
                          minHeight: 90,
                          border: "1px solid #eee",
                          borderRadius: 8,
                          padding: 6,
                          background: c.inMonth
                            ? c.date && daysHas.has(c.label.padStart(2, "0"))
                              ? "#f5fff5"
                              : "#fff"
                            : "#fafafa",
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
                        <div
                          style={{
                            textAlign: "right",
                            fontSize: 12,
                            opacity: 0.7,
                            marginBottom: 4,
                          }}
                        >
                          {c.label}
                        </div>
                        {c.date &&
                          monthBalances
                            .filter((b) => b.date === c.date)
                            .slice(0, 3)
                            .map((b, idx) => {
                              const delta = b.ending_bb - b.buy_in_bb;
                              const { text, color } = fmtDiff(delta);
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    position: "relative",
                                    fontSize: 12,
                                    marginBottom: 6,
                                    padding: 6,
                                    border: "1px dashed #eee",
                                    borderRadius: 8,
                                  }}
                                >
                                  <button
                                    onClick={() => openMenuFor(b)}
                                    title="編集/削除"
                                    style={{
                                      position: "absolute",
                                      top: 4,
                                      right: 4,
                                      padding: "2px 6px",
                                      borderRadius: 6,
                                      border: "1px solid #ddd",
                                      background: "#fff",
                                      fontSize: 11,
                                    }}
                                  >
                                    ︙
                                  </button>
                                  {/* 1段目: ステークス / 2段目: 差分 */}
                                  <div
                                    style={{
                                      lineHeight: 1.2,
                                      paddingRight: 24,
                                    }}
                                  >
                                    {b.stakes || "(no stakes)"}
                                  </div>
                                  <div style={{ lineHeight: 1.2, color }}>
                                    {text}
                                  </div>
                                </div>
                              );
                            })}
                        {c.date &&
                          monthBalances.filter((b) => b.date === c.date)
                            .length > 3 && (
                            <div style={{ fontSize: 11, opacity: 0.7 }}>
                              …他{" "}
                              {monthBalances.filter((b) => b.date === c.date)
                                .length - 3}{" "}
                              件
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* テーブル */}
              {confirmView === "table" && (
                <div
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 12,
                    padding: 12,
                    overflow: "auto",
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>データベースビュー</h3>
                  {myBalancesSorted.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>まだデータがありません。</div>
                  ) : (
                    <table
                      style={{ width: "100%", borderCollapse: "collapse" }}
                    >
                      <thead>
                        <tr>
                          <th style={th}>日付</th>
                          <th style={th}>ステークス</th>
                          <th style={{ ...th, textAlign: "right" }}>BuyIn</th>
                          <th style={{ ...th, textAlign: "right" }}>Ending</th>
                          <th style={{ ...th, textAlign: "right" }}>差分</th>
                          <th style={th}>メモ</th>
                          <th style={th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {myBalancesSorted.map((b) => {
                          const d = b.ending_bb - b.buy_in_bb;
                          const { text, color } = fmtDiff(d);
                          return (
                            <tr key={b.__id}>
                              <td style={td}>{b.date}</td>
                              <td style={td}>{b.stakes}</td>
                              <td style={{ ...td, textAlign: "right" }}>
                                {b.buy_in_bb}
                              </td>
                              <td style={{ ...td, textAlign: "right" }}>
                                {b.ending_bb}
                              </td>
                              <td
                                style={{
                                  ...td,
                                  textAlign: "right",
                                  fontWeight: 600,
                                  color,
                                }}
                              >
                                {text}
                              </td>
                              <td style={td}>{b.memo}</td>
                              <td
                                style={{ ...td, width: 48, textAlign: "right" }}
                              >
                                <button
                                  onClick={() => openMenuFor(b)}
                                  title="編集/削除"
                                  style={{
                                    padding: "4px 8px",
                                    borderRadius: 8,
                                    border: "1px solid #ddd",
                                    background: "#fff",
                                  }}
                                >
                                  ︙
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* --- 上位ランキング --- */}
          {tab === "上位ランキング" && (
            <div
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <h3 style={{ marginTop: 0 }}>
                上位ランキング（累計BB / 公開は上位{rankingTopN}位まで）
              </h3>
              {rankingTop.length === 0 ? (
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
                    {rankingTop.map((r, idx) => (
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
        </div>
      </div>

      {/* ---- 表示名変更モーダル ---- */}
      <Modal
        open={openName}
        onClose={() => {
          if (!savingName) setOpenName(false);
        }}
      >
        <h3 style={{ marginTop: 0 }}>表示名を変更</h3>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="例: Yuta"
          style={inp}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={saveDisplayName} disabled={savingName} style={btn}>
            {savingName ? "保存中..." : "保存"}
          </button>
          <button
            onClick={() => {
              if (!savingName) setOpenName(false);
            }}
            style={btn}
          >
            キャンセル
          </button>
        </div>
      </Modal>

      {/* ---- 収支報告モーダル ---- */}
      <Modal
        open={openReport}
        onClose={() => {
          if (!savingReport) setOpenReport(false);
        }}
      >
        <h3 style={{ marginTop: 0 }}>収支報告</h3>

        <label style={lbl}>日付</label>
        <input
          type="date"
          value={reportDate}
          onChange={(e) => setReportDate(e.target.value)}
          style={inp}
        />

        {/* ステークス（固定時は固定値を表示＆編集不可） */}
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <div>
            <label style={lbl}>SB</label>
            <input
              value={stakesFixed ? String(fixed!.sb) : stakesSB}
              onChange={(e) =>
                !stakesFixed &&
                setStakesSB(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              placeholder={stakesFixed ? "" : "例: 1"}
              disabled={stakesFixed}
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>BB</label>
            <input
              value={stakesFixed ? String(fixed!.bb) : stakesBB}
              onChange={(e) =>
                !stakesFixed &&
                setStakesBB(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              placeholder={stakesFixed ? "" : "例: 3"}
              disabled={stakesFixed}
              style={inp}
            />
          </div>
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <div>
            <label style={lbl}>バイイン(BB)</label>
            <input
              value={buyIn}
              onChange={(e) => setBuyIn(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>終了(BB)</label>
            <input
              value={ending}
              onChange={(e) =>
                setEnding(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              style={inp}
            />
          </div>
        </div>

        <label style={lbl}>ひとこと</label>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
          style={{ ...inp, resize: "vertical" }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={submitBalance} disabled={savingReport} style={btn}>
            {savingReport ? "登録中..." : "登録"}
          </button>
          <button
            onClick={() => {
              if (!savingReport) setOpenReport(false);
            }}
            style={btn}
          >
            キャンセル
          </button>
        </div>
      </Modal>

      {/* ---- ︙メニュー（編集/削除の選択） ---- */}
      {menuTarget && !openEdit && !openDelete && (
        <Modal open={true} onClose={() => setMenuTarget(null)} width={360}>
          <h3 style={{ marginTop: 0 }}>操作を選択</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <button onClick={() => setOpenEdit(true)} style={btn}>
              編集
            </button>
            <button
              onClick={() => setOpenDelete(true)}
              style={{ ...btn, borderColor: "#f33", color: "#f33" }}
            >
              削除
            </button>
          </div>
        </Modal>
      )}

      {/* ---- 編集モーダル ---- */}
      <Modal
        open={!!menuTarget && openEdit}
        onClose={() => {
          if (!savingEdit) setOpenEdit(false);
        }}
      >
        <h3 style={{ marginTop: 0 }}>収支を編集</h3>
        <label style={lbl}>日付</label>
        <input
          type="date"
          value={editDate}
          onChange={(e) => setEditDate(e.target.value)}
          style={inp}
        />

        {/* ステークス：固定時は固定値を表示＆編集不可 */}
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <div>
            <label style={lbl}>SB</label>
            <input
              value={stakesFixed ? String(fixed!.sb) : editSB}
              onChange={(e) =>
                !stakesFixed &&
                setEditSB(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              disabled={stakesFixed}
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>BB</label>
            <input
              value={stakesFixed ? String(fixed!.bb) : editBB}
              onChange={(e) =>
                !stakesFixed &&
                setEditBB(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              disabled={stakesFixed}
              style={inp}
            />
          </div>
        </div>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <div>
            <label style={lbl}>バイイン(BB)</label>
            <input
              value={editBuyIn}
              onChange={(e) =>
                setEditBuyIn(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              style={inp}
            />
          </div>
          <div>
            <label style={lbl}>終了(BB)</label>
            <input
              value={editEnding}
              onChange={(e) =>
                setEditEnding(e.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              style={inp}
            />
          </div>
        </div>

        <label style={lbl}>ひとこと</label>
        <textarea
          value={editMemo}
          onChange={(e) => setEditMemo(e.target.value)}
          rows={3}
          style={{ ...inp, resize: "vertical" }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={saveEdit} disabled={savingEdit} style={btn}>
            {savingEdit ? "保存中..." : "保存"}
          </button>
          <button
            onClick={() => {
              if (!savingEdit) setOpenEdit(false);
            }}
            style={btn}
          >
            キャンセル
          </button>
        </div>
      </Modal>

      {/* ---- 削除確認モーダル ---- */}
      <Modal
        open={!!menuTarget && openDelete}
        onClose={() => {
          if (!deleting) setOpenDelete(false);
        }}
      >
        <h3 style={{ marginTop: 0 }}>削除の確認</h3>
        <p>この収支を削除しますか？（元に戻せません）</p>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={doDelete}
            disabled={deleting}
            style={{ ...btn, borderColor: "#f33", color: "#f33" }}
          >
            {deleting ? "削除中..." : "削除する"}
          </button>
          <button
            onClick={() => {
              if (!deleting) setOpenDelete(false);
            }}
            style={btn}
          >
            キャンセル
          </button>
        </div>
      </Modal>
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
const btn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "#fff",
};
