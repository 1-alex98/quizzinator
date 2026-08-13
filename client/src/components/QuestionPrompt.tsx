import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { PublicQuestion } from "../lib/protocol.js";
import { AppIcon } from "./AppIcon.js";

// Shared by the mobile answer screen and the host/TV question + reveal
// screens (see CLAUDE.md: a question is text-only or image+text, never
// image-only). Falls back to a clean text-only layout when there's no image.
export function QuestionPrompt({
  question,
  variant = "mobile",
}: {
  question: PublicQuestion;
  variant?: "host" | "mobile";
}) {
  const [imageOpen, setImageOpen] = useState(true);
  const isHost = variant === "host";
  const imageUrl = question.media?.imageUrl;

  // Decorative: the prompt below carries the meaning, so no alt text.
  const image = imageUrl ? (
    <Box
      component="img"
      src={imageUrl}
      alt=""
      sx={{
        display: "block",
        maxHeight: isHost ? "46vh" : "28vh",
        maxWidth: isHost ? "min(100%, 900px)" : "100%",
        objectFit: "contain",
        borderRadius: 1,
        boxShadow: isHost ? 12 : 6,
      }}
    />
  ) : null;

  return (
    <Stack alignItems="center" gap={isHost ? 3 : 1.5} sx={{ width: "100%", minWidth: 0 }}>
      {isHost
        ? image
        : image && (
            <>
              {/* On a phone the image competes with the slider/text input for
                  the one screenful we get, so it can be folded away. */}
              <Collapse in={imageOpen} sx={{ width: "100%" }}>
                <Stack alignItems="center" sx={{ width: "100%" }}>
                  {image}
                </Stack>
              </Collapse>
              <Button
                size="small"
                variant="text"
                onClick={() => setImageOpen((open) => !open)}
                startIcon={<AppIcon name={imageOpen ? "visibility_off" : "image"} fontSize="small" />}
                sx={{ minHeight: 34, py: 0.25, px: 1.5, fontSize: "0.85rem" }}
              >
                {imageOpen ? "Hide image" : "Show image"}
              </Button>
            </>
          )}
      <Typography variant={isHost ? "h2" : "h3"} sx={{ textWrap: "balance" }}>
        {question.prompt}
      </Typography>
    </Stack>
  );
}
