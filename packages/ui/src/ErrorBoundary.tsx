import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown instead of the children when they crash. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Contains a crash in a subtree so it can't take down the whole app. Used around
 * the 3D office, where WebGL / @react-three render issues (e.g. a DOM reconcile
 * error on unmount) would otherwise unmount the entire interface.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Surface it in the console but keep the app alive.
    console.error("Subtree crashed:", error);
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
