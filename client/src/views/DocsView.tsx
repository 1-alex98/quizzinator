import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { AppIcon } from "../components/AppIcon.js";
import {
  CopyButton,
  CopySchemaButton,
  GeminiPromptButton,
  useQuestionSetSchema,
} from "../components/QuestionFormatActions.js";
import {
  SHARED_FIELDS,
  fetchQuestionSetSchema,
  fullPrompt,
  questionVariants,
  schemaExample,
  variantType,
  type QuestionSetSchema,
} from "../lib/questionSetFormat.js";

// The question set format, written out for whoever is authoring one.
//
// Every field table on this page is rendered from the JSON Schema the server
// publishes, which is itself generated from the zod schema uploads are
// validated against. So this page cannot document a field the app doesn't
// have, or miss one it does - the usual fate of hand-written format docs.

const TYPE_HEADINGS: Record<string, { icon: string; title: string }> = {
  "multiple-choice": { icon: "list", title: "multiple-choice" },
  number: { icon: "tune", title: "number" },
  geo: { icon: "public", title: "geo" },
  "fuzzy-text": { icon: "edit", title: "fuzzy-text" },
};

export function DocsView() {
  const { schema, error } = useQuestionSetSchema();
  const example = schema ? schemaExample(schema) : null;

  return (
    // The game screens deliberately never scroll; a reference page has to.
    <Box sx={{ height: "100%", overflowY: "auto", px: { xs: 2, sm: 4 }, py: { xs: 3, sm: 5 } }}>
      <Stack gap={4} sx={{ maxWidth: 900, mx: "auto", textAlign: "left" }}>
        <Stack gap={1.5}>
          <Button
            component={RouterLink}
            to="/admin"
            variant="text"
            color="inherit"
            startIcon={<AppIcon name="arrow_back" />}
            sx={{ alignSelf: "flex-start", px: 1 }}
          >
            Host a quiz
          </Button>
          <Typography variant="h1" component="h1">
            Question set format
          </Typography>
          <Typography variant="h4" component="p" sx={{ color: "text.secondary", fontWeight: 400 }}>
            A quiz is one JSON object. Upload it as a <code>.json</code> file, paste it on the host screen, or ship it
            in a <code>.zip</code> with its images.
          </Typography>
        </Stack>

        <Paper elevation={0} sx={{ p: 2.5, border: 1, borderColor: "divider" }}>
          <Stack gap={1.5}>
            <Typography variant="h4" component="h2">
              Writing one with an LLM
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Hand the schema to any model and paste the JSON it returns into the host screen. The copy button gives you
              the schema on its own; the prompt button wraps it in instructions that keep the reply to just the JSON.
            </Typography>
            <Stack direction="row" gap={1.5} flexWrap="wrap">
              <CopySchemaButton />
              <CopyButton
                label="Copy LLM prompt"
                copiedLabel="Prompt copied"
                icon="content_copy"
                build={async () => fullPrompt(await fetchQuestionSetSchema())}
              />
              <GeminiPromptButton schema={schema} />
              <Button
                component="a"
                href="/api/question-set-schema"
                target="_blank"
                rel="noopener noreferrer"
                variant="text"
                color="inherit"
                startIcon={<AppIcon name="open_in_new" />}
              >
                Raw schema
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {error && (
          <Typography color="error">Could not load the schema: {error}</Typography>
        )}
        {!schema && !error && (
          <Stack direction="row" gap={1.5} alignItems="center" sx={{ color: "text.secondary" }}>
            <CircularProgress size={20} />
            <Typography>Loading the schema…</Typography>
          </Stack>
        )}

        {schema && (
          <>
            <Section title="Every question">
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
                These fields are shared by all question types. Everything else depends on <code>type</code>.
              </Typography>
              {/* Required-ness comes from the schema as well, so a field that
                  gains or loses a default doesn't need a doc edit. */}
              <FieldTable
                fields={sharedFields(schema)}
                required={new Set(questionVariants(schema)[0]?.required ?? [])}
              />
            </Section>

            {questionVariants(schema).map((variant) => {
              const type = variantType(variant);
              const heading = TYPE_HEADINGS[type] ?? { icon: "help", title: type };
              const required = new Set(variant.required ?? []);
              const fields = Object.entries(variant.properties ?? {})
                .filter(([name]) => name !== "type" && !SHARED_FIELDS.includes(name))
                .map(([name, def]) => ({ name, type: def.type ?? "any", description: def.description ?? "" }));
              return (
                <Section key={type} title={heading.title} icon={heading.icon} subtitle={variant.description}>
                  <FieldTable fields={fields} required={required} />
                </Section>
              );
            })}

            <Section title="Images">
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                <code>media.imageUrl</code> takes a public <code>https://</code> URL in a plain <code>.json</code>{" "}
                upload. To use your own image files, upload a <code>.zip</code> containing exactly one JSON file at its
                root plus the images, and reference them by their path inside the archive (e.g.{" "}
                <code>images/skyline.jpg</code>).
              </Typography>
            </Section>

            {example !== null && (
              <Section title="A complete example">
                <Stack gap={1.5} alignItems="flex-start">
                  <CopyButton
                    label="Copy example"
                    copiedLabel="Example copied"
                    icon="content_copy"
                    size="small"
                    build={async () => JSON.stringify(example, null, 2)}
                  />
                  <Box
                    component="pre"
                    sx={{
                      width: "100%",
                      m: 0,
                      p: 2,
                      borderRadius: 3,
                      bgcolor: "background.default",
                      border: 1,
                      borderColor: "divider",
                      overflowX: "auto",
                      fontSize: "0.85rem",
                      lineHeight: 1.5,
                    }}
                  >
                    {JSON.stringify(example, null, 2)}
                  </Box>
                </Stack>
              </Section>
            )}
          </>
        )}

        <Divider />
        <Typography variant="body2" sx={{ color: "text.secondary", pb: 4 }}>
          Ready to run it? <Link component={RouterLink} to="/admin">Host a quiz</Link>.
        </Typography>
      </Stack>
    </Box>
  );
}

/** The shared fields, read off the first variant so their descriptions come from the schema too. */
function sharedFields(schema: QuestionSetSchema) {
  const properties = questionVariants(schema)[0]?.properties ?? {};
  return SHARED_FIELDS.filter((name) => name === "type" || properties[name]).map((name) => {
    if (name === "type") {
      return {
        name: "type",
        type: "string",
        description: `One of ${questionVariants(schema)
          .map((v) => `"${variantType(v)}"`)
          .join(", ")}.`,
      };
    }
    const def = properties[name];
    return { name, type: def.type ?? "any", description: def.description ?? "" };
  });
}

function Section({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
}) {
  return (
    <Stack gap={1.5} component="section">
      <Stack direction="row" gap={1.5} alignItems="center">
        {icon && <AppIcon name={icon} color="primary" />}
        <Typography variant="h3" component="h2">
          {title}
        </Typography>
      </Stack>
      {subtitle && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {subtitle}
        </Typography>
      )}
      {children}
    </Stack>
  );
}

function FieldTable({
  fields,
  required,
}: {
  fields: { name: string; type: string; description: string }[];
  required: Set<string>;
}) {
  return (
    <Paper elevation={0} sx={{ border: 1, borderColor: "divider", overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>Field</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Notes</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {fields.map((field) => (
            <TableRow key={field.name}>
              <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                <Stack direction="row" gap={1} alignItems="center">
                  <code>{field.name}</code>
                  {!required.has(field.name) && (
                    <Chip size="small" variant="outlined" label="optional" sx={{ height: 22, fontSize: "0.7rem" }} />
                  )}
                </Stack>
              </TableCell>
              <TableCell sx={{ color: "text.secondary", verticalAlign: "top" }}>{field.type}</TableCell>
              <TableCell sx={{ color: "text.secondary" }}>{field.description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}
