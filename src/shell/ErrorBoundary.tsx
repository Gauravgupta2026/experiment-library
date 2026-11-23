import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

/** Catches render errors below it and shows a recoverable message instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error): void { console.error(error); }
  componentDidUpdate(prev: { resetKey: string }): void {
    // A new address clears the error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="feed"><div className="intro" role="alert">
        <h1>Something went wrong</h1>
        <p>This view stopped with an error. The other pages still work.</p>
        <a className="btn" style={{ display: 'inline-flex', alignItems: 'center', marginTop: 12 }} href="/">Back to the feed</a>
      </div></main>
    );
  }
}
