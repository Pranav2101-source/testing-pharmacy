import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional custom fallback UI. Receives the error and a reset callback. */
  fallback?: (error: Error | null, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error:    Error | null;
}

/**
 * React Error Boundary that catches uncaught exceptions in the component tree
 * below it and renders a recovery UI instead of crashing the whole page.
 *
 * Without this, a null-deref in any dashboard component unmounts the entire
 * React tree and leaves the user staring at a blank screen with no way to
 * recover except a full page reload.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log to the browser console so developers can see the stack in DevTools.
    // In production this would be the place to call Sentry / Datadog.
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return <DefaultFallback error={this.state.error} onReset={this.reset} />;
  }
}

function DefaultFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-5 px-8 py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center">
        <AlertTriangle className="w-8 h-8 text-red-500" strokeWidth={1.5} />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-slate-800">Something went wrong</h2>
        <p className="text-sm text-slate-500 max-w-sm">
          An unexpected error occurred on this page. Your data is safe — use the button
          below to try again or navigate to another section.
        </p>
      </div>

      {error?.message && (
        <code className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 max-w-md break-words">
          {error.message}
        </code>
      )}

      <button
        onClick={onReset}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold
                   bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm
                   transition-colors duration-150"
      >
        <RefreshCw className="w-4 h-4" strokeWidth={2} />
        Try again
      </button>
    </div>
  );
}
