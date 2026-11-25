import { Component, type ErrorInfo, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { captureClientException } from '../../lib/monitoring';

interface Props {
  children: ReactNode;
  onGoHome: () => void;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'An unexpected rendering issue occurred.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureClientException(error, { componentStack: info.componentStack || '' });
    api.reportClientError(error.message, `${error.stack || ''}\n${info.componentStack || ''}`, window.location.pathname);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-xl px-6 py-24 text-center">
          <p className="font-mono text-xs text-rose-400">Runtime Interrupt</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-slate-100">
            Something drifted off-course
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">{this.state.message}</p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                this.props.onGoHome();
              }}
              className="rounded-lg bg-[#22D3EE] px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
            >
              Return Home
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-slate-700 bg-[#0E1525] px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-500"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
