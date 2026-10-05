export default function PrivacyPage() {
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
        Privacy Policy
      </h1>
      <p style={{ marginTop: 0, opacity: 0.9 }}>
        Glitch Pixel Studio processes camera and media data locally on your device to render effects in real time.
      </p>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>What We Collect</h2>
        <ul style={{ marginTop: 0, paddingLeft: 18 }}>
          <li>In-app settings and presets stored locally on your device.</li>
          <li>Optional bug report email content you choose to send manually.</li>
        </ul>
      </section>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>What We Do Not Collect</h2>
        <ul style={{ marginTop: 0, paddingLeft: 18 }}>
          <li>No account registration.</li>
          <li>No always-on cloud upload of your camera feed.</li>
          <li>No sale of personal data.</li>
        </ul>
      </section>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Permissions</h2>
        <ul style={{ marginTop: 0, paddingLeft: 18 }}>
          <li>Camera: required to capture and process live visuals.</li>
          <li>Media/Storage: required to save screenshots and recordings.</li>
          <li>Microphone (optional): used only for audio-reactive features if enabled.</li>
        </ul>
      </section>
      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Contact</h2>
        <p style={{ marginTop: 0 }}>
          Questions or requests: 1800bobrossdotcom@gmail.com
        </p>
      </section>
      <p style={{ marginTop: 22, opacity: 0.72, fontSize: 13 }}>
        Last updated: 2026-05-23
      </p>
    </main>
  );
}
