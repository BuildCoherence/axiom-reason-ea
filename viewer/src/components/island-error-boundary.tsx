"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  /** Console prefix naming the island that failed, e.g. "profile-graph". */
  logLabel: string;
}

interface State {
  hasError: boolean;
}

// Per-island error boundary: a client island that throws on render must NOT
// propagate to the route-level error.tsx and blank the whole page. Wrap the
// island so it degrades to `fallback` while the rest of the page keeps
// working. (Generalised from the feed's per-card boundary — same contract,
// parameterised log label.)
export class IslandErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Surfaced to the console for debugging; the page keeps working.
    console.error(`${this.props.logLabel}: render failed`, error);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
