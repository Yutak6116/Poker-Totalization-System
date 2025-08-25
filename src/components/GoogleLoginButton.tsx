import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

export default function GoogleLoginButton() {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    try {
      setBusy(true);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // 成功したら成功ページへ
      navigate("/success");
    } catch (e) {
      console.error(e);
      alert("ログインに失敗しました。コンソールを確認してください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleGoogleLogin}
      disabled={busy}
      style={{
        padding: "12px 16px",
        borderRadius: 12,
        border: "1px solid #ddd",
        fontSize: 16,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
      }}
      aria-label="Googleでログイン"
    >
      <span style={{ width: 18, height: 18, display: "inline-block" }}>🔑</span>
      {busy ? "ログイン中..." : "Googleでログイン"}
    </button>
  );
}
