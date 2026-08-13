import { createTheme, type ThemeOptions } from "@mui/material/styles";

// One dark theme shared by the TV screen and the phones. Both surfaces are
// viewed in a dim room with the lights down, so the palette is a deep indigo
// "night" ground with a single warm amber accent used for anything the eye
// should land on first (scores, timers, the live answer value).
//
// Sizes are deliberately not per-view: the TV scales type up through the
// `display*` variants below, phones use the regular body/h* scale, so both
// share one set of tokens instead of two divergent stylesheets.

const palette: ThemeOptions["palette"] = {
  mode: "dark",
  primary: { main: "#8c9eff", dark: "#5c6bc0", light: "#c5cae9", contrastText: "#0b0c1c" },
  secondary: { main: "#ffc043", dark: "#ffab00", light: "#ffe082", contrastText: "#231a00" },
  success: { main: "#69f0ae", contrastText: "#00291a" },
  error: { main: "#ff6e6e", contrastText: "#2b0000" },
  background: { default: "#0b0c1c", paper: "#181a33" },
  text: { primary: "#f2f2f7", secondary: "rgba(242, 242, 247, 0.66)" },
  divider: "rgba(255, 255, 255, 0.1)",
};

export const theme = createTheme({
  palette,
  shape: { borderRadius: 20 },
  typography: {
    fontFamily: '"Roboto", system-ui, sans-serif',
    // Fluid display sizes: the same components are read from a sofa (TV) and
    // from a hand (phone), so the big text scales with the viewport instead
    // of shipping two hardcoded scales.
    h1: { fontSize: "clamp(2rem, 5vw, 4rem)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em" },
    h2: { fontSize: "clamp(1.6rem, 3.6vw, 2.75rem)", fontWeight: 700, lineHeight: 1.15 },
    h3: { fontSize: "clamp(1.35rem, 2.6vw, 2rem)", fontWeight: 600, lineHeight: 1.2 },
    h4: { fontSize: "clamp(1.15rem, 2vw, 1.5rem)", fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Mobile & TV views are single-screen: no per-question scrolling, and
        // 100dvh so a mobile Safari toolbar sliding in never clips the layout.
        "html, body, #root": {
          height: "100dvh",
          margin: 0,
          overflow: "hidden",
          overscrollBehavior: "none",
        },
        body: {
          WebkitTapHighlightColor: "transparent",
          background: "radial-gradient(120% 90% at 50% -10%, #24265a 0%, #0b0c1c 62%)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        // MUI's dark mode lightens Paper with an overlay gradient per
        // elevation; the palette above already encodes the surface colour, so
        // the overlay only muddies it.
        root: { backgroundImage: "none" },
      },
    },
    MuiButton: {
      defaultProps: { variant: "contained", disableElevation: false },
      styleOverrides: {
        root: {
          borderRadius: 999,
          paddingInline: 28,
          paddingBlock: 12,
          fontSize: "1.05rem",
          minHeight: 52,
        },
        sizeLarge: { fontSize: "1.2rem", minHeight: 64, paddingInline: 40 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: "0.95rem", height: 34 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 10, borderRadius: 999 },
      },
    },
  },
});
