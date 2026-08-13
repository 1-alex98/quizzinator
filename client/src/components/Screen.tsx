import type { ReactNode } from "react";
import Fade from "@mui/material/Fade";
import Stack from "@mui/material/Stack";
import type { SxProps, Theme } from "@mui/material/styles";

// The single-screen shell every phase renders into: fills the viewport,
// centres its children, never scrolls (see CLAUDE.md - "one phase fills the
// screen at a time"). `phaseKey` re-triggers the fade whenever the quiz moves
// to a new phase, so screens cross-fade instead of snapping.
export function Screen({
  children,
  phaseKey,
  gap = 3,
  sx,
}: {
  children: ReactNode;
  phaseKey?: string;
  /** Theme spacing units, or any CSS length - the answer screen scales its gap with the viewport. */
  gap?: number | string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Fade in key={phaseKey} timeout={{ enter: 320, exit: 0 }} appear>
      <Stack
        alignItems="center"
        justifyContent="center"
        gap={gap}
        sx={{
          height: "100%",
          width: "100%",
          px: 3,
          py: 4,
          textAlign: "center",
          // Belt-and-braces against a long question list or player list
          // pushing content off-screen on a short phone viewport.
          overflow: "hidden",
          ...sx,
        }}
      >
        {children}
      </Stack>
    </Fade>
  );
}
