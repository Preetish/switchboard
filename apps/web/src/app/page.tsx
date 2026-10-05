const features = [
  {
    title: "Route in milliseconds",
    body: "Rules evaluate on submit — CRM-aware, versioned in git, no dashboard clicking.",
  },
  {
    title: "Book before they leave",
    body: "The matched rep's calendar renders inline on the form page. Zero redirects.",
  },
  {
    title: "Every decision on record",
    body: "Inputs, matched rule, outcome, and latency for each submission. Searchable, exportable.",
  },
];

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--sb-space-8)",
        gap: "var(--sb-space-6)",
        textAlign: "center",
      }}
    >
      <span
        style={{
          display: "inline-block",
          padding: "var(--sb-space-1) var(--sb-space-3)",
          borderRadius: "var(--sb-radius-full)",
          background: "var(--sb-accent-soft)",
          color: "var(--sb-accent-strong)",
          fontSize: "var(--sb-text-sm)",
          fontWeight: 600,
        }}
      >
        v0.1 · early scaffold
      </span>
      <h1
        style={{
          fontSize: "var(--sb-text-4xl)",
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          maxWidth: "40rem",
        }}
      >
        Inbound routing that ends in a booked meeting.
      </h1>
      <p
        style={{
          color: "var(--sb-text-muted)",
          fontSize: "var(--sb-text-lg)",
          maxWidth: "36rem",
        }}
      >
        Switchboard turns a form submission into a booked call in seconds:
        qualify the lead, route it to the right rep, and show that rep&apos;s
        calendar immediately. Self-hostable, no per-seat pricing.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "var(--sb-space-4)",
          width: "100%",
          maxWidth: "60rem",
          marginTop: "var(--sb-space-8)",
        }}
      >
        {features.map((feature) => (
          <div
            key={feature.title}
            style={{
              background: "var(--sb-surface)",
              border: "1px solid var(--sb-border)",
              borderRadius: "var(--sb-radius-lg)",
              padding: "var(--sb-space-6)",
              textAlign: "left",
            }}
          >
            <h2
              style={{
                fontSize: "var(--sb-text-lg)",
                fontWeight: 600,
                marginBottom: "var(--sb-space-2)",
              }}
            >
              {feature.title}
            </h2>
            <p style={{ color: "var(--sb-text-muted)" }}>{feature.body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
