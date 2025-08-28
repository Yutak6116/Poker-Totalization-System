// src/pages/AdminDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../providers/AuthProvider";
import { auth, db } from "../lib/firebase";
import { signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { Link, useNavigate } from "react-router-dom";
import Modal from "../components/Modal";

// ===== 型 =====
type GroupDoc = {
  group_id: number;
  group_name: string;
  creator: string;
  player_password: string;
  admin_password: string;
  created_at?: any;
  last_updated?: any;
};

type AdminMembership = {
  group_id: number;
  uid: string;
  joinedAt: any;
};

// ===== 生成ユーティリティ =====
const genNumeric = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const genAlnum = (n: number) =>
  Array.from(
    { length: n },
    () => ALNUM[Math.floor(Math.random() * ALNUM.length)]
  ).join("");

// 6桁ID生成（先頭0埋め）
const gen6 = () =>
  Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");

// 6桁0埋め（入力の正規化用）
const pad6 = (n: number | string) =>
  String(n).replace(/\D/g, "").padStart(6, "0");

const formatTs = (t?: any) => t?.toDate?.().toLocaleString?.() || "-";

export default function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const email = user?.email ?? "unknown";

  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<AdminMembership[]>([]);
  const [groups, setGroups] = useState<Record<string, GroupDoc>>({});
  // Create Modal
  const [openCreate, setOpenCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [createResult, setCreateResult] = useState<GroupDoc | null>(null);

  // Join Modal
  const [openJoin, setOpenJoin] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinGroupId, setJoinGroupId] = useState<string>("");
  const [joinAdminPw, setJoinAdminPw] = useState("");

  // ========== 所属しているグループ一覧 ==========
  useEffect(() => {
    const fetch = async () => {
      if (!user) return;
      setLoading(true);
      // 自分の membership を取得
      const q = query(
        collection(db, "group_admins"),
        where("uid", "==", user.uid)
      );
      const ms = await getDocs(q);
      const items: AdminMembership[] = ms.docs.map(
        (d) => d.data() as AdminMembership
      );
      setMemberships(items);

      // それぞれの Groups を取得
      const groupMap: Record<string, GroupDoc> = {};
      await Promise.all(
        items.map(async (m) => {
          const ref = doc(db, "groups", pad6(m.group_id));
          const snap = await getDoc(ref);
          if (snap.exists())
            groupMap[pad6(m.group_id)] = snap.data() as GroupDoc;
        })
      );
      setGroups(groupMap);
      setLoading(false);
    };
    fetch();
  }, [user]);

  const myGroups = useMemo(() => {
    return memberships
      .map((m) => groups[pad6(m.group_id)])
      .filter((g): g is GroupDoc => !!g)
      .sort(
        (a, b) =>
          (b.last_updated?.seconds ?? 0) - (a.last_updated?.seconds ?? 0) ||
          b.group_id - a.group_id // 同秒ならID降順でフォールバック
      );
  }, [memberships, groups]);

  // ========== 新規グループ作成 ==========
  const createGroup = async () => {
    if (!user) return;
    if (!newGroupName.trim()) {
      alert("グループ名を入力してください");
      return;
    }
    try {
      setCreating(true);

      let created: GroupDoc | null = null;

      // 最大10回まで衝突リトライ
      for (let attempt = 0; attempt < 10; attempt++) {
        const gidStr = gen6(); // ★6桁ランダム
        const gidNum = parseInt(gidStr, 10);

        try {
          await runTransaction(db, async (tx) => {
            const groupRef = doc(db, "groups", gidStr);
            const existed = await tx.get(groupRef);
            if (existed.exists()) {
              throw new Error("COLLISION"); // 衝突 → リトライ
            }

            const playerPw = genNumeric(6);
            const adminPw = genAlnum(8);

            const groupDoc: GroupDoc = {
              group_id: gidNum,
              group_name: newGroupName.trim(),
              creator: email,
              player_password: playerPw,
              admin_password: adminPw,
              created_at: serverTimestamp(),
              last_updated: serverTimestamp(),
            };

            // groups 作成
            tx.set(groupRef, groupDoc);

            // 自分を group_admins に登録（docIdは "XXXXXX_uid" 形式）
            const mRef = doc(db, "group_admins", `${gidStr}_${user.uid}`);
            tx.set(mRef, {
              group_id: gidNum,
              uid: user.uid,
              joinedAt: serverTimestamp(),
            });

            created = groupDoc; // Tx 内で作った内容を拾う
          });

          // ここまで来たら成功
          if (created) {
            setCreateResult(created);

            // ローカル一覧に即反映
            setMemberships((prev) => [
              ...prev,
              {
                group_id: created!.group_id,
                uid: user.uid,
                joinedAt: new Date(),
              } as any,
            ]);
            setGroups((prev) => ({
              ...prev,
              [pad6(created!.group_id)]: {
                ...created!,
                last_updated: { seconds: Math.floor(Date.now() / 1000) } as any,
              },
            }));
            break;
          }
        } catch (e: any) {
          // 衝突は再試行、それ以外は投げる
          if (String(e?.message || "").includes("COLLISION")) {
            continue;
          } else {
            throw e;
          }
        }
      }

      if (!created) {
        alert("ID生成に失敗しました。もう一度お試しください。");
      }
    } catch (e) {
      console.error(e);
      alert("グループ作成に失敗しました。コンソールを確認してください。");
    } finally {
      setCreating(false);
    }
  };

  // ========== 既存グループ参加 ==========
  const joinGroup = async () => {
    if (!user) return;
    const gidStr = pad6(joinGroupId);
    if (!/^\d{6}$/.test(gidStr) || !joinAdminPw.trim()) {
      alert("グループID（6桁）とAdminパスワードを入力してください");
      return;
    }
    try {
      setJoining(true);
      const ref = doc(db, "groups", gidStr);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        alert("グループが見つかりません");
        setJoining(false);
        return;
      }
      const data = snap.data() as GroupDoc;
      if (data.admin_password !== joinAdminPw.trim()) {
        alert("Adminパスワードが一致しません");
        setJoining(false);
        return;
      }

      // 所属登録（"XXXXXX_uid"）
      await setDoc(doc(db, "group_admins", `${gidStr}_${user.uid}`), {
        group_id: data.group_id,
        uid: user.uid,
        joinedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "groups", gidStr), {
        last_updated: serverTimestamp(),
      });

      // ローカル更新
      setMemberships((prev) => {
        if (prev.some((p) => pad6(p.group_id) === gidStr)) return prev;
        return [
          ...prev,
          {
            group_id: data.group_id,
            uid: user.uid,
            joinedAt: new Date(),
          } as any,
        ];
      });
      setGroups((prev) => ({ ...prev, [gidStr]: data }));

      alert("ログインに成功しました。グループに参加しました。");
      setOpenJoin(false);
      setJoinGroupId("");
      setJoinAdminPw("");
    } catch (e) {
      console.error(e);
      alert("参加に失敗しました。コンソールを確認してください。");
    } finally {
      setJoining(false);
    }
  };

  if (!user) {
    return <div style={{ padding: 24 }}>ログインしてください。</div>;
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
          width: 960,
          maxWidth: "96vw",
          padding: 24,
          borderRadius: 16,
          boxShadow: "0 10px 28px rgba(0,0,0,.08)",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>Admin ダッシュボード</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setOpenJoin(true)}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
              }}
            >
              既存グループへの参加
            </button>
            <button
              onClick={() => setOpenCreate(true)}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
              }}
            >
              新規グループの作成
            </button>
            <button
              onClick={async () => {
                await signOut(auth);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
              }}
            >
              ログアウト
            </button>
          </div>
        </div>

        <p style={{ marginTop: 8, opacity: 0.7 }}>
          ユーザー: <strong>{user.displayName ?? "No Name"}</strong>（
          {user.email ?? "-"}）
        </p>

        <hr style={{ margin: "16px 0 12px" }} />

        <h3 style={{ margin: "0 0 8px" }}>1. 参加済みグループ一覧</h3>
        {loading ? (
          <div>Loading...</div>
        ) : myGroups.length === 0 ? (
          <div style={{ opacity: 0.7 }}>参加済みグループはありません。</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {myGroups.map((g) => (
              <div
                key={g.group_id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{g.group_name}</div>
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>ID: {pad6(g.group_id)}</span>
                    <span>最終更新: {formatTs(g.last_updated)}</span>
                    <span>作成者: {g.creator}</span>
                  </div>
                </div>
                <Link
                  to={`/admin/group/${pad6(g.group_id)}`}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                  }}
                >
                  このグループのAdminへ
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新規グループ作成モーダル */}
      <Modal
        open={openCreate}
        onClose={() => {
          if (!creating) {
            setOpenCreate(false);
            setCreateResult(null);
          }
        }}
      >
        {!createResult ? (
          <div>
            <h3 style={{ marginTop: 0 }}>新規グループの作成</h3>
            <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
              グループ名
            </label>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="例: BigFish 2025"
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={createGroup}
                disabled={creating}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                {creating ? "作成中..." : "作成する"}
              </button>
              <button
                onClick={() => {
                  if (!creating) {
                    setOpenCreate(false);
                    setCreateResult(null);
                  }
                }}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h3 style={{ marginTop: 0 }}>発行情報</h3>
            <p>
              グループ名: <strong>{createResult.group_name}</strong>
            </p>
            <p>
              グループID: <code>{pad6(createResult.group_id)}</code>
            </p>
            <p>
              Player パスワード（6桁）:{" "}
              <code>{createResult.player_password}</code>
            </p>
            <p>
              Admin パスワード（8桁）:{" "}
              <code>{createResult.admin_password}</code>
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={() => {
                  setOpenCreate(false);
                  setCreateResult(null);
                  setNewGroupName("");
                }}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                閉じる
              </button>
              <button
                onClick={() =>
                  navigate(`/admin/group/${pad6(createResult.group_id)}`)
                }
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                このグループへ移動
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 既存グループ参加モーダル */}
      <Modal
        open={openJoin}
        onClose={() => {
          if (!joining) setOpenJoin(false);
        }}
      >
        <div>
          <h3 style={{ marginTop: 0 }}>既存グループへの参加</h3>
          <label style={{ display: "block", fontSize: 14, marginBottom: 6 }}>
            グループID
          </label>
          <input
            value={joinGroupId}
            onChange={(e) =>
              setJoinGroupId(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="整数ID"
            inputMode="numeric"
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          />
          <label
            style={{ display: "block", fontSize: 14, margin: "12px 0 6px" }}
          >
            Admin パスワード
          </label>
          <input
            value={joinAdminPw}
            onChange={(e) => setJoinAdminPw(e.target.value)}
            placeholder="8桁（英数字）"
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          />

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={joinGroup}
              disabled={joining}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
              }}
            >
              {joining ? "参加中..." : "参加する"}
            </button>
            <button
              onClick={() => {
                if (!joining) setOpenJoin(false);
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
