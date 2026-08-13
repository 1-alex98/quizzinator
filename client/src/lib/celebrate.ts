// Confetti for the "you got it right" moment on a phone and correct-answer
// reveals on the TV. Purely decorative, so every failure path is a silent
// no-op: a missing canvas or a blocked import must never break a live quiz.

const COLORS = ["#ffc043", "#8c9eff", "#69f0ae", "#ffffff"];

// MUI modals sit at 1300; confetti belongs over everything.
const Z_INDEX = 2000;

export function celebrate(intensity: "big" | "small" = "big"): void {
  if (typeof window === "undefined") return;

  // jsdom has no matchMedia, which conveniently also covers the test suite.
  if (typeof window.matchMedia !== "function") return;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    return;
  }

  if (!hasCanvas()) return;

  // Dynamic import keeps ~7kB off the initial bundle a phone on venue wifi
  // has to download before it can join.
  void (async () => {
    try {
      const { default: confetti } = await import("canvas-confetti");
      const shared = {
        colors: COLORS,
        zIndex: Z_INDEX,
        disableForReducedMotion: true,
      };

      if (intensity === "small") {
        confetti({ ...shared, particleCount: 35, spread: 60, startVelocity: 32, origin: { x: 0.5, y: 0.6 } });
        return;
      }

      // Two cannons angled inward from the lower corners.
      confetti({ ...shared, particleCount: 90, spread: 70, angle: 60, origin: { x: 0, y: 0.75 } });
      confetti({ ...shared, particleCount: 90, spread: 70, angle: 120, origin: { x: 1, y: 0.75 } });
    } catch {
      // Decorative only.
    }
  })();
}

function hasCanvas(): boolean {
  try {
    return typeof document !== "undefined" && !!document.createElement("canvas").getContext("2d");
  } catch {
    return false;
  }
}
