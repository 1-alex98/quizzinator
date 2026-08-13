import { useCallback, useEffect, useState } from "react";
import Button, { type ButtonProps } from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import { AppIcon } from "./AppIcon.js";
import {
  compactPrompt,
  copyText,
  fetchQuestionSetSchema,
  fullPrompt,
  geminiUrl,
  type QuestionSetSchema,
} from "../lib/questionSetFormat.js";

// The "hand the format to an LLM" actions, shared by the host lobby (grab the
// schema mid-party without leaving the TV screen) and the admin screen (write
// a set before starting one).

/** Loads the published schema on mount. Kept as a hook so several buttons on one screen share the single fetch. */
export function useQuestionSetSchema(): { schema: QuestionSetSchema | null; error: string | null } {
  const [schema, setSchema] = useState<QuestionSetSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchQuestionSetSchema()
      .then((loaded) => active && setSchema(loaded))
      .catch((err: Error) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, []);

  return { schema, error };
}

/**
 * A button that puts text on the clipboard and says so. The label swap is the
 * whole confirmation: a copy that silently succeeded is indistinguishable from
 * one that silently failed, and this is often pressed on a TV nobody is
 * standing next to.
 */
export function CopyButton({
  label,
  copiedLabel = "Copied",
  icon,
  build,
  ...buttonProps
}: {
  label: string;
  copiedLabel?: string;
  icon: string;
  /** Deferred so the schema is only fetched when someone actually asks for it. */
  build: () => Promise<string>;
} & Omit<ButtonProps, "onClick" | "children">) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timeout);
  }, [copied]);

  const onClick = useCallback(async () => {
    try {
      await copyText(await build());
      setCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy to the clipboard.");
    }
  }, [build]);

  return (
    <>
      <Button
        variant="outlined"
        color={copied ? "success" : "primary"}
        startIcon={<AppIcon name={copied ? "check" : icon} />}
        onClick={onClick}
        {...buttonProps}
      >
        {copied ? copiedLabel : label}
      </Button>
      <Snackbar
        open={error !== null}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" variant="filled" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}

/** Copies the JSON Schema itself - the thing to paste into an LLM alongside your own instructions. */
export function CopySchemaButton(props: Omit<ButtonProps, "onClick" | "children">) {
  const build = useCallback(async () => JSON.stringify(await fetchQuestionSetSchema(), null, 2), []);
  return <CopyButton label="Copy JSON schema" copiedLabel="Schema copied" icon="data_object" build={build} {...props} />;
}

/** Copies a ready-to-send prompt: the schema plus the instructions that make an LLM answer with just the JSON. */
export function CopyPromptButton({
  topic,
  ...props
}: { topic?: string } & Omit<ButtonProps, "onClick" | "children">) {
  const build = useCallback(async () => fullPrompt(await fetchQuestionSetSchema(), topic), [topic]);
  return <CopyButton label="Copy LLM prompt" copiedLabel="Prompt copied" icon="content_copy" build={build} {...props} />;
}

/**
 * Opens Gemini with the prompt already in its composer. The compact spec is
 * used rather than the full schema because this has to survive being a URL -
 * and pointing Gemini at a schema URL instead wouldn't work either, since this
 * app is typically reached at a LAN address Google can't fetch.
 */
export function GeminiPromptButton({
  schema,
  topic,
  ...props
}: { schema: QuestionSetSchema | null; topic?: string } & Omit<ButtonProps, "href" | "children">) {
  return (
    <Button
      variant="outlined"
      color="secondary"
      component="a"
      href={schema ? geminiUrl(compactPrompt(schema, topic)) : undefined}
      target="_blank"
      rel="noopener noreferrer"
      disabled={!schema}
      startIcon={<AppIcon name="auto_awesome" />}
      {...props}
    >
      Draft one with Gemini
    </Button>
  );
}
