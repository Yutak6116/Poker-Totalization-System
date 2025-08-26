import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

type GroupDoc = {
  group_id: number;
  group_name: string;
  creator: string;
  player_password: string;
  admin_password: string;
};

export default function AdminGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<GroupDoc | null>(null);

  useEffect(() => {
    const fetchGroup = async () => {
      if (!groupId) return;
      const ref = doc(db, "groups", String(groupId));
      const snap = await getDoc(ref);
      if (snap.exists()) setGroup(snap.data() as GroupDoc);
      setLoading(false);
    };
    fetchGroup();
  }, [groupId]);

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;
  if (!group)
    return <div style={{ padding: 24 }}>グループが見つかりません。</div>;

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
          width: 720,
          maxWidth: "96vw",
          padding: 24,
          borderRadius: 16,
          boxShadow: "0 10px 28px rgba(0,0,0,.08)",
          background: "#fff",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Admin: {group.group_name}</h2>
        <p>
          ID: <code>{group.group_id}</code>
        </p>
        <p>作成者: {group.creator}</p>

        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px dashed #ddd",
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
            （デバッグ用）発行済みパスワード
          </div>
          <p>
            Player PW: <code>{group.player_password}</code>
          </p>
          <p>
            Admin PW: <code>{group.admin_password}</code>
          </p>
        </div>

        <div style={{ marginTop: 16 }}>
          <Link
            to="/admin"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          >
            管理ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
