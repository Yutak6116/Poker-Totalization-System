import { useAuth } from "../providers/AuthProvider";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

export default function SuccessPage() {
  const { user } = useAuth();

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
          width: 520,
          maxWidth: "92vw",
          padding: 24,
          borderRadius: 16,
          boxShadow: "0 10px 28px rgba(0,0,0,.08)",
          background: "#fff",
        }}
      >
        <h2 style={{ marginTop: 0 }}>ログイン成功 🎉</h2>
        {user ? (
          <div>
            <p style={{ margin: "8px 0" }}>
              こんにちは、<strong>{user.displayName ?? "No Name"}</strong>{" "}
              さん！
            </p>
            <p style={{ margin: "8px 0" }}>メール: {user.email ?? "-"}</p>
            <p style={{ margin: "8px 0", opacity: 0.7, fontSize: 14 }}>
              UID: <code>{user.uid}</code>
            </p>
          </div>
        ) : (
          <p>ユーザー情報を取得できませんでした。</p>
        )}

        <div style={{ height: 16 }} />
        <button
          onClick={() => signOut(auth)}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            cursor: "pointer",
            background: "#fff",
          }}
        >
          ログアウト
        </button>
      </div>
    </div>
  );
}
