export default function DevBanner() {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        background: "#b91c1c",
        color: "#ffffff",
        textAlign: "center",
        padding: "6px 12px",
        fontSize: "13px",
        fontWeight: 600,
        zIndex: 99999,
        letterSpacing: "0.5px",
      }}
    >
      ⚠️ DEV MODE — TEST ENVIRONMENT — NOT LIVE DATA
    </div>
  );
}
