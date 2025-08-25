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
          width: 360,
          maxWidth: "90vw",
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
        <GoogleLoginButton />
      </div>
    </div>
  );
}
