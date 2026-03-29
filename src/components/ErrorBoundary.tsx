import { Component, type ReactNode } from 'react'

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
        <div className="flex items-center justify-center h-full">
          <div className="text-center max-w-md px-6">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 6v5M10 14h.01" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="10" cy="10" r="8.5" stroke="#f87171" strokeWidth="1.3"/>
              </svg>
            </div>
            <p className="text-[14px] font-semibold text-[#e0e2f0] mb-2">Something went wrong</p>
            <p className="text-[12px] text-[#787e98] font-mono break-all">{this.state.error.message}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-5 px-4 py-1.5 rounded-lg border border-[#252836] hover:bg-[#1c2235] transition-colors text-[12px] text-[#9096b0]"
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
