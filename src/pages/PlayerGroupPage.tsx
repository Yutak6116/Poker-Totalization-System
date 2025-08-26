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

export default function PlayerGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<GroupDoc | null>(null);

  useEffect(() => {
    const fetchGroup = async () => {
      if (!groupId) return;
      const ref = doc(db, "groups", groupId);
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
        <h2 style={{ marginTop: 0 }}>Player: {group.group_name}</h2>
        <p>
          ID: <code>{String(group.group_id).padStart(6, "0")}</code>
        </p>
        <p>作成者: {group.creator}</p>

        <div style={{ marginTop: 16 }}>
          <Link
            to="/player"
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
            }}
          >
            Player ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
