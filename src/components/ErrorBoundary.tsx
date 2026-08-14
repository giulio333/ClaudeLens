import { Component, type ReactNode } from 'react';
import { QueryError } from './QueryError';
import { reportError } from '../lib/telemetry';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  // A render crash the user recovers from by clicking Retry is still a bug we
  // would otherwise never hear about — report it (opt-out gated, paths scrubbed
  // main-side).
  componentDidCatch(error: Error) {
    reportError(error, 'handled');
  }

  render() {
    if (this.state.error) {
      return (
        <QueryError
          title="Something went wrong"
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}
