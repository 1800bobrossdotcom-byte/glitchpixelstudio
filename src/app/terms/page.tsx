export default function TermsPage() {
  return (
    <main style={{
      minHeight: "100dvh",
      background: "linear-gradient(180deg, #090316 0%, #030510 100%)",
      color: "#F4F6FF",
      fontFamily: "var(--font-nunito,'Nunito',sans-serif)",
      padding: "20px min(6vw, 36px)",
      lineHeight: 1.7,
    }}>
      <h1 style={{
        margin: "0 0 12px",
        fontSize: "clamp(24px, 5vw, 34px)",
        letterSpacing: "1.2px",
      }}>
        Terms of Service
      </h1>
      <p style={{ marginTop: 0, opacity: 0.9 }}>
        By using Glitch Pixel Studio, you agree to these terms.
      </p>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>License</h2>
        <p style={{ marginTop: 0 }}>
          You are granted a personal, non-exclusive, non-transferable license to use the app for lawful creative work.
        </p>
      </section>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Acceptable Use</h2>
        <ul style={{ marginTop: 0, paddingLeft: 18 }}>
          <li>Do not use the app to violate law or third-party rights.</li>
          <li>Do not attempt to reverse engineer paid features or bypass licensing systems.</li>
          <li>You are responsible for content you capture, export, and share.</li>
        </ul>
      </section>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Availability</h2>
        <p style={{ marginTop: 0 }}>
          Features may change over time as the app is updated. We may add, modify, or remove capabilities without prior notice.
        </p>
      </section>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Disclaimer</h2>
        <p style={{ marginTop: 0 }}>
          The service is provided "as is" without warranties of any kind. To the maximum extent permitted by law, liability is limited to the amount paid for the app.
        </p>
      </section>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Contact</h2>
        <p style={{ marginTop: 0 }}>
          Support: 1800bobrossdotcom@gmail.com
        </p>
      </section>
      <p style={{ marginTop: 22, opacity: 0.72, fontSize: 13 }}>
        Last updated: 2026-05-23
      </p>
    </main>
  );
}
