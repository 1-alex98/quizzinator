import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";

const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
`;

/** Seconds left at which the ring turns red and starts pulsing. */
const URGENT_SEC = 5;

// The server owns the countdown (see CLAUDE.md - clients only render what the
// server tells them), so this takes the remaining seconds as a prop and never
// runs a clock of its own. Shown on both the TV and the phones so the two can
// never disagree about how long is left.
export function CountdownRing({
  remainingSec,
  totalSec,
  size = 96,
}: {
  remainingSec: number;
  totalSec: number;
  size?: number;
}) {
  const clamped = Math.max(0, remainingSec);
  const fraction = totalSec > 0 ? Math.min(1, clamped / totalSec) : 0;
  const urgent = clamped <= URGENT_SEC;

  return (
    <Box
      sx={{
        position: "relative",
        display: "inline-flex",
        animation: urgent ? `${pulse} 1s ease-in-out infinite` : "none",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={4}
        sx={{ color: "rgba(255, 255, 255, 0.1)" }}
      />
      <CircularProgress
        variant="determinate"
        value={fraction * 100}
        size={size}
        thickness={4}
        // Sits exactly on top of the track ring above.
        sx={{
          position: "absolute",
          left: 0,
          color: urgent ? "error.main" : "secondary.main",
          transition: "color 240ms linear",
          circle: { transition: "stroke-dashoffset 900ms linear" },
        }}
      />
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Typography
          sx={{
            fontSize: size * 0.36,
            fontWeight: 700,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            color: urgent ? "error.main" : "text.primary",
          }}
        >
          {clamped}
        </Typography>
      </Box>
    </Box>
  );
}
