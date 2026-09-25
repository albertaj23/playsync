// Switches for the optional scroll/chrome effects (phase-nav-ux.md section 7). Flip one to false to disable it.
export const FEATURES = {
  scrollAwareChrome: true,   // I5: phone tab bar + action bar slide away on scroll-down
  headerMorph: true,         // I10: the top-bar title pops in when the page heading scrolls out of view
  ambientLayer: true,        // I7: faint drifting shapes that lean with scroll velocity
  focusDuringRun: true,      // I12: rail the sidebar while a simulation run is live
  viewTransitions: true,     // I4: Home -> My devices morphs the geometric illustration (View Transitions API; falls back to a normal navigation)
  softSnap: false,           // I8: scroll-snap between chapters. Evaluated and ruled out (fights tall chapters).
} as const;
