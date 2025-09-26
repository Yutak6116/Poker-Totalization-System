// src/pages/LoginPage.tsx
import { useState } from "react";
import GoogleLoginButton from "../components/GoogleLoginButton";
import Modal from "../components/Modal";
import { auth, db } from "../lib/firebase";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const [openRegister, setOpenRegister] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const navigate = useNavigate();

  // Google ログイン成功後：/users/{uid} の有無で分岐
  const handleLoginSuccess = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const uid = user.uid;
    const email = user.email ?? "";

    const uref = doc(db, "users", uid);
    const usnap = await getDoc(uref);

    if (usnap.exists()) {
      // 既に登録済み → Player ダッシュボードへ
      navigate("/player");
    } else {
      // 初回ログイン → その場でユーザー登録（表示名を決める）
      setPendingUid(uid);
      setPendingEmail(email);
      setDisplayName("");
      setOpenRegister(true);
    }
  };

  const submitRegister = async () => {
    const name = displayName.trim();
    if (!name) {
      alert("表示名を入力してください");
      return;
    }
    if (!pendingUid) return;

    try {
      setRegistering(true);
      await setDoc(doc(db, "users", pendingUid), {
        uid: pendingUid,
        email: pendingEmail ?? "",
        display_name: name,
        created_at: serverTimestamp(),
      });
      setOpenRegister(false);
      navigate("/player");
    } catch (e) {
      console.error(e);
      alert("ユーザー登録に失敗しました。コンソールを確認してください。");
    } finally {
      setRegistering(false);
    }
  };

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
          width: 500,
          maxWidth: "92vw",
          padding: 24,
          borderRadius: 16,
          boxShadow: "0 10px 28px rgba(0,0,0,.08)",
          background: "#fff",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: "0 0 8px" }}>Poker-Totalization-System</h1>
        <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>
          環境: <code>{import.meta.env.MODE}</code>
        </p>

        <div style={{ height: 24 }} />

        {/* ログインボタンは1つだけ */}
        <GoogleLoginButton
          label="Google ログイン"
          // 成功後の遷移は onSuccess 内で実施（初回登録/既存で分岐）
          onSuccess={handleLoginSuccess}
        />
      </div>

      {/* 初回ユーザー登録モーダル */}
      <Modal
        open={openRegister}
        onClose={() => {
          if (!registering) setOpenRegister(false);
        }}
      >
        <h3 style={{ marginTop: 0 }}>初回ユーザー登録</h3>
        <p style={{ fontSize: 14, opacity: 0.8 }}>
          表示名を設定してください。
          <br />
          <strong>※この表示名は後から変更できません。</strong>
        </p>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="例: Yuta"
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={submitRegister}
            disabled={registering}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff",
            }}
          >
            {registering ? "登録中..." : "登録して続行"}
          </button>
          <button
            onClick={() => {
              if (!registering) setOpenRegister(false);
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
      </Modal>
    </div>
  );
}
