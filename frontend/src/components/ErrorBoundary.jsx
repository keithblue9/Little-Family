import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log so it shows up in the browser console for debugging.
    // eslint-disable-next-line no-console
    console.error("App crashed:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            fontFamily: "system-ui, sans-serif",
            background: "#FFF7ED",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              background: "white",
              border: "2px solid #FED7AA",
              borderRadius: 24,
              padding: 32,
              boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>😵</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: 0 }}>
              Something went wrong
            </h1>
            <p style={{ color: "#475569", marginTop: 8 }}>
              The app hit an unexpected error while loading. Try reloading the page.
            </p>
            <pre
              style={{
                marginTop: 16,
                background: "#F8FAFC",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                padding: 12,
                fontSize: 12,
                color: "#B91C1C",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {String(this.state.error?.message || this.state.error || "Unknown error")}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 16,
                background: "#FF9D23",
                color: "white",
                border: "none",
                borderRadius: 12,
                padding: "10px 20px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
