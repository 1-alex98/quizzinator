import Box from "@mui/material/Box";
import Grow from "@mui/material/Grow";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import { AppIcon } from "./AppIcon.js";
import type { PublicPlayer } from "../lib/protocol.js";

// The standings as seen from a sofa: shown on the TV between questions and at
// the end of the quiz, so rank/name/score hierarchy matters more than density.

// Large rooms (~20 players) would otherwise overflow the single-screen,
// no-scroll layout - show only the top rows plus a "+N more" summary.
export const MAX_VISIBLE_PLAYERS = 10;

// Medal colours for the podium. Deliberately not palette entries: they mean
// "1st/2nd/3rd", not "primary/secondary", and shouldn't move with the theme.
const MEDALS = ["#ffd75e", "#dfe4ec", "#e0955c"];

export function Leaderboard({
  players,
  deltas,
  highlightPlayerId,
}: {
  players: PublicPlayer[];
  /** Points gained this round, keyed by player id. Only passed during the reveal phase. */
  deltas?: Map<string, number>;
  /** Renders this row with an accent outline, e.g. "this phone's player". */
  highlightPlayerId?: string;
}) {
  const visible = players.slice(0, MAX_VISIBLE_PLAYERS);
  const hiddenCount = players.length - visible.length;
  // The leader sets the bar scale; everyone on 0 must not divide by zero.
  const topScore = visible.reduce((max, p) => Math.max(max, p.score), 0);

  return (
    <Box
      component="ol"
      className="leaderboard"
      sx={{ listStyle: "none", m: 0, p: 0, width: "100%", maxWidth: 900 }}
    >
      {visible.map((player, index) => {
        const rank = index + 1;
        const delta = deltas?.get(player.id);
        const gained = delta !== undefined && delta > 0;
        const medal = MEDALS[index];
        const barPct = topScore > 0 ? (player.score / topScore) * 100 : 0;

        return (
          <Grow
            key={player.id}
            in
            appear
            timeout={420}
            // Staggered so the board assembles top-down instead of snapping in.
            style={{ transitionDelay: `${index * 60}ms` }}
          >
            <Stack
              component="li"
              direction="row"
              alignItems="center"
              gap={{ xs: 1.5, sm: 2 }}
              sx={{
                position: "relative",
                overflow: "hidden",
                mb: 1,
                px: { xs: 1.5, sm: 2.5 },
                py: { xs: 0.75, sm: 1.25 },
                borderRadius: 3,
                bgcolor: (t: Theme) => alpha(t.palette.background.paper, medal ? 0.95 : 0.6),
                outline: (t: Theme) =>
                  player.id === highlightPlayerId ? `2px solid ${t.palette.primary.main}` : "none",
                opacity: player.connected ? 1 : 0.45,
                transition: "opacity 200ms",
              }}
            >
              {/* Score bar behind the row: gives the standings a shape you can
                  read at a glance before the numbers resolve. */}
              <Box
                aria-hidden
                sx={{
                  position: "absolute",
                  inset: 0,
                  right: "auto",
                  width: `${barPct}%`,
                  background: (t: Theme) =>
                    `linear-gradient(90deg, ${alpha(t.palette.primary.main, 0.28)}, ${alpha(
                      t.palette.primary.main,
                      0.06,
                    )})`,
                  transition: "width 600ms ease-out",
                }}
              />

              <Box
                sx={{
                  position: "relative",
                  flex: "0 0 auto",
                  display: "grid",
                  placeItems: "center",
                  // Rank 1 reads a size up from the rest of the podium.
                  width: rank === 1 ? "clamp(2.4rem, 4vw, 3.4rem)" : "clamp(2rem, 3.2vw, 2.8rem)",
                  height: rank === 1 ? "clamp(2.4rem, 4vw, 3.4rem)" : "clamp(2rem, 3.2vw, 2.8rem)",
                  borderRadius: "50%",
                  bgcolor: medal ?? "transparent",
                  color: medal ? "#1b1b26" : "text.secondary",
                  fontWeight: 800,
                  fontSize: rank === 1 ? "clamp(1.1rem, 2vw, 1.7rem)" : "clamp(0.95rem, 1.5vw, 1.3rem)",
                  boxShadow: medal ? `0 0 ${rank === 1 ? 20 : 10}px ${alpha(medal, 0.45)}` : "none",
                }}
              >
                {rank}
              </Box>

              <Typography
                noWrap
                sx={{
                  position: "relative",
                  flex: 1,
                  minWidth: 0,
                  textAlign: "left",
                  fontWeight: rank <= 3 ? 700 : 500,
                  fontSize: "clamp(1rem, 2.1vw, 1.9rem)",
                }}
              >
                {player.name}
              </Typography>

              {!player.connected && (
                <AppIcon
                  name="wifi_off"
                  sx={{ position: "relative", color: "text.secondary", fontSize: "clamp(1rem, 1.6vw, 1.4rem)" }}
                />
              )}

              {delta !== undefined && (
                <Typography
                  component="span"
                  sx={{
                    position: "relative",
                    flex: "0 0 auto",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "clamp(0.85rem, 1.5vw, 1.35rem)",
                    // A zero round is information, not a celebration.
                    color: gained ? "secondary.main" : "text.secondary",
                  }}
                >
                  +{delta}
                </Typography>
              )}

              <Typography
                sx={{
                  position: "relative",
                  flex: "0 0 auto",
                  textAlign: "right",
                  fontWeight: 800,
                  // Keeps digits from shifting sideways as scores change between rounds.
                  fontVariantNumeric: "tabular-nums",
                  fontSize: "clamp(1.1rem, 2.3vw, 2.1rem)",
                }}
              >
                {player.score}
              </Typography>
            </Stack>
          </Grow>
        );
      })}

      {hiddenCount > 0 && (
        <Typography
          component="li"
          className="list-more"
          sx={{
            color: "text.secondary",
            textAlign: "center",
            mt: 0.5,
            fontSize: "clamp(0.85rem, 1.4vw, 1.15rem)",
          }}
        >
          +{hiddenCount} more player{hiddenCount === 1 ? "" : "s"}
        </Typography>
      )}
    </Box>
  );
}
