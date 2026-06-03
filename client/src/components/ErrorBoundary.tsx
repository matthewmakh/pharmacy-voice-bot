import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere below it so one broken tab/component doesn't
 * blank the whole app. Shows a recoverable fallback instead of a white screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-muted flex items-center justify-center p-6">
          <div className="card max-w-md w-full text-center p-8">
            <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mt-2">
              An unexpected error occurred while rendering this page. Your data is safe.
            </p>
            <div className="flex items-center justify-center gap-3 mt-6">
              <button onClick={() => this.setState({ error: null })} className="btn-secondary">Try again</button>
              <button onClick={() => { window.location.href = '/'; }} className="btn-primary">Back to dashboard</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
