import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import Fade from "@mui/material/Fade";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { PublicQuestion } from "../lib/protocol.js";
import { AppIcon } from "./AppIcon.js";

// Shared by the mobile answer screen and the host/TV question + reveal
// screens (see CLAUDE.md: a question is text-only or image+text, never
// image-only). Falls back to a clean text-only layout when there's no image.
//
// Image sizing on the two full screens is flex-driven, not a `vh` cap: the
// picture is what the room is squinting at, so it takes *all* the height the
// rest of the screen doesn't need. Everything around it (countdown, prompt,
// answer input, buttons) keeps its intrinsic size, and the image grows or
// shrinks into what's left - which means a busy screen and an empty one both
// end up with as large an image as they can carry, without ever scrolling.
//
// `panel` is the exception: the geo screen shows this inside a floating card
// over the map, where filling the space available would mean covering the map
// the player is trying to tap. There the card hugs the image instead.
export function QuestionPrompt({
  question,
  variant = "mobile",
}: {
  question: PublicQuestion;
  variant?: "host" | "mobile" | "panel";
}) {
  const [imageOpen, setImageOpen] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  // A URL that never loads (a 404, a host that blocks hotlinking, a phone
  // that is on the venue wifi but not on the internet) is common enough with
  // sets written by an LLM to deserve a real answer: say so, and give the
  // space back to the question instead of leaving a blank frame.
  // Keyed by URL rather than a bare boolean, so the next question's image
  // still gets its own chance to load.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const isHost = variant === "host";
  const isPanel = variant === "panel";
  const declaredUrl = question.media?.imageUrl;
  const imageUrl = declaredUrl && declaredUrl !== brokenUrl ? declaredUrl : undefined;
  // Whether the image is claiming leftover space rather than being sized by
  // its own content - true on the host and mobile answer screens.
  const fills = Boolean(imageUrl) && !isPanel;

  // Decorative: the prompt below carries the meaning, so no alt text.
  //
  // `flex: 1 1 0` on the frame claims the leftover space, and the image fills
  // that frame with `object-fit: contain` - which scales the picture up as well
  // as down, and keeps its aspect ratio either way.
  //
  // The shadow is then a `drop-shadow` filter rather than `box-shadow`: a
  // contained image only paints part of its box (a wide picture in a tall frame
  // is letterboxed top and bottom), and `box-shadow` would outline that whole
  // empty box - a lit rectangle floating around the photo. `drop-shadow`
  // follows what is actually painted. It costs the rounded corners, which
  // belong to the box for the same reason. The panel variant, whose box does
  // hug the picture, keeps both.
  const image = imageUrl ? (
    <Box
      sx={{
        flex: fills ? "1 1 0" : "0 0 auto",
        // "All the leftover space" is only generous while there *is* leftover
        // space. A phone showing six tap targets and a submit button has
        // almost none, and `1 1 0` with no floor happily settled at a 30px
        // sliver - or at literally zero on a small phone, which reads as a
        // broken image rather than as a tight layout. The floor is what the
        // rest of the screen has to fit around; the answer input compresses
        // (and, past the point where even that is not enough, scrolls) instead
        // of eating the picture.
        minHeight: fills ? "min(20vh, 200px)" : 0,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box
        component="img"
        src={imageUrl}
        alt=""
        onError={() => setBrokenUrl(imageUrl)}
        onClick={isHost ? undefined : () => setZoomed(true)}
        sx={{
          display: "block",
          objectFit: "contain",
          maxWidth: "100%",
          cursor: isHost ? "default" : "zoom-in",
          ...(fills
            ? {
                height: "100%",
                width: "100%",
                maxHeight: "100%",
                filter: isHost
                  ? "drop-shadow(0 14px 30px rgba(0, 0, 0, 0.55))"
                  : "drop-shadow(0 6px 16px rgba(0, 0, 0, 0.45))",
              }
            : { maxHeight: "38vh", borderRadius: 1, boxShadow: 6 }),
        }}
      />
    </Box>
  ) : null;

  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      gap={isHost ? 2 : "clamp(6px, 1.2vh, 12px)"}
      sx={{
        width: "100%",
        minWidth: 0,
        // Only a filling image claims the parent's leftover space; text-only
        // prompts and the geo panel stay intrinsically sized, so they still
        // centre inside the screen / let the card shrink to its contents.
        //
        // `1 1 auto` with an auto min-height, not `1 1 0` with a zero one: the
        // image now has a floor, so a shrink-to-nothing block would be one
        // whose contents no longer fit inside it - and an overflowing flex
        // item paints straight over its neighbours (the prompt landing on top
        // of the first answer option). The block keeps its content height; the
        // answer column below it is the part that gives.
        flex: fills ? "1 1 auto" : "0 0 auto",
        minHeight: fills ? "auto" : 0,
      }}
    >
      {isHost
        ? image
        : image && (
            <>
              {/* On a phone the image competes with the slider/options/text
                  input for the one screenful we get. Six tap targets leave it
                  very little, hence "Enlarge": the answer input keeps the room
                  it needs to stay tappable, and the picture is still one tap
                  from filling the whole phone. */}
              <Fade in={imageOpen} unmountOnExit appear={false}>
                {image}
              </Fade>
              <Stack direction="row" gap={0.5} sx={{ flex: "0 0 auto" }}>
                {imageOpen && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setZoomed(true)}
                    startIcon={<AppIcon name="zoom_out_map" fontSize="small" />}
                    sx={{ minHeight: 34, py: 0.25, px: 1.5, fontSize: "0.85rem" }}
                  >
                    Enlarge
                  </Button>
                )}
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={() => setImageOpen((open) => !open)}
                  startIcon={<AppIcon name={imageOpen ? "visibility_off" : "image"} fontSize="small" />}
                  sx={{ minHeight: 34, py: 0.25, px: 1.5, fontSize: "0.85rem" }}
                >
                  {imageOpen ? "Hide image" : "Show image"}
                </Button>
              </Stack>
            </>
          )}
      {declaredUrl && !imageUrl && (
        <Stack
          direction="row"
          alignItems="center"
          gap={0.75}
          sx={{ flex: "0 0 auto", color: "text.secondary" }}
        >
          <AppIcon name="broken_image" fontSize="small" />
          <Typography variant="body2">This question&rsquo;s image could not be loaded.</Typography>
        </Stack>
      )}

      <Typography variant={isHost ? "h2" : "h3"} sx={{ flex: "0 0 auto", textWrap: "balance" }}>
        {question.prompt}
      </Typography>

      {/* Full-screen viewer for the phone. Tapping anywhere closes it, and it
          unmounts with the answer screen when the question ends, so nobody can
          be left staring at a picture while the timer runs out. */}
      {imageUrl && !isHost && (
        <Dialog fullScreen open={zoomed} onClose={() => setZoomed(false)} slotProps={{ paper: { sx: { bgcolor: "rgba(0,0,0,0.94)" } } }}>
          <Box
            onClick={() => setZoomed(false)}
            sx={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1, cursor: "zoom-out" }}
          >
            <Box
              component="img"
              src={imageUrl}
              alt={question.prompt}
              sx={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", borderRadius: 1 }}
            />
            <Button
              onClick={() => setZoomed(false)}
              startIcon={<AppIcon name="close" />}
              sx={{ position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)" }}
            >
              Close
            </Button>
          </Box>
        </Dialog>
      )}
    </Stack>
  );
}
