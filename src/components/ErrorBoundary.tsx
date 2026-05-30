import { Component, type ReactNode } from 'react'
import { QueryError } from './QueryError'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <QueryError
          title="Something went wrong"
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
        />
      )
    }
    return this.props.children
  }
}
