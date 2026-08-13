import { useNavigate } from "react-router-dom";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { AppIcon } from "../components/AppIcon.js";
import { Screen } from "../components/Screen.js";

// Transform/opacity only so the loop stays on the compositor - this screen is
// often left up on a TV for minutes while people file into the room.
const float = keyframes`
  0%, 100% { transform: translateY(0); opacity: 0.9; }
  50% { transform: translateY(-10px); opacity: 1; }
`;

export function HomeView() {
  const navigate = useNavigate();

  return (
    <Screen phaseKey="home" gap={4}>
      <Box
        sx={{
          display: "grid",
          placeItems: "center",
          // A soft glow behind the glyph so the title card has a focal point
          // in a dim room without adding an image asset.
          "&::before": {
            content: '""',
            gridArea: "1 / 1",
            width: { xs: 180, sm: 240 },
            height: { xs: 180, sm: 240 },
            borderRadius: "50%",
            background: (theme) => `radial-gradient(circle, ${theme.palette.primary.dark}55 0%, transparent 70%)`,
          },
        }}
      >
        <AppIcon
          name="quiz"
          color="primary"
          sx={{
            gridArea: "1 / 1",
            fontSize: "clamp(4rem, 12vw, 8rem)",
            animation: `${float} 4.5s ease-in-out infinite`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        />
      </Box>

      <Box>
        <Typography variant="h1" component="h1" sx={{ color: "text.primary" }}>
          Quizzinator
        </Typography>
        <Typography variant="h4" component="p" sx={{ color: "text.secondary", fontWeight: 400, mt: 1 }}>
          One screen, everyone&rsquo;s phones, no accounts.
        </Typography>
      </Box>

      <Button size="large" startIcon={<AppIcon name="upload_file" />} onClick={() => navigate("/admin")}>
        Host a quiz
      </Button>
    </Screen>
  );
}
