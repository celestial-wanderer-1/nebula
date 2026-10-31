import { Component as ReactComponent, type ReactNode } from "react";

/** R3F and vtk.js throw when WebGL is unavailable (for example in jsdom). */
export class WebGlBoundary extends ReactComponent<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <p className="viewport-fallback muted" role="note">
        3D view unavailable: this browser could not start WebGL.
      </p>
    ) : (
      this.props.children
    );
  }
}
