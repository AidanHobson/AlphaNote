import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

// Route-level error boundary: if one page throws during render (a bad API shape,
// a null deref, a failed lazy chunk), we show a contained fallback instead of a
// blank white app. The Shell keys this by pathname, so navigating away clears it.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Diagnostics hook — a real deploy would forward this to an error reporter.
    console.error('Route error boundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty" role="alert" style={{ marginTop: 24, textAlign: 'left' }}>
          <strong>This page hit a snag.</strong>
          Something went wrong while rendering this view. The rest of the app is unaffected —
          retry below, or pick another page from the sidebar.
          <div style={{ marginTop: 14 }}>
            <button className="btn primary sm" onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 12, fontFamily: 'ui-monospace, monospace' }}>
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
