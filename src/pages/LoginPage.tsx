import GoogleLoginButton from "../components/GoogleLoginButton";

export default function LoginPage() {
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
          width: 420,
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

        <div style={{ display: "grid", gap: 12 }}>
          <GoogleLoginButton
            label="Player として Google ログイン"
            redirectTo="/player"
          />
          <GoogleLoginButton
            label="Admin として Google ログイン"
            redirectTo="/admin"
          />
        </div>

        <div
          style={{ marginTop: 16, fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}
        >
          ※ 現状は認可制御なし：誰でも Admin
          ダッシュボードに入れます（要件どおり）
        </div>
      </div>
    </div>
  );
}
