import { Component, type ErrorInfo, type ReactNode } from "react";
import { BotLogo } from "./BotLogo";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/effect errors so a single failure shows a recoverable message
 * instead of a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Botifyr UI error:", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="center">
          <div className="card">
            <div className="auth-brand">
              <BotLogo size={40} />
              <div>
                <div className="brand-name">Botifyr</div>
                <div className="brand-sub">something went wrong</div>
              </div>
            </div>
            <h1>The app hit an error</h1>
            <div className="error">{this.state.error.message}</div>
            <button className="btn primary" type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
