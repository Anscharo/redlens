// The chatbot's "export what you found" tool. UNLIKE every other chat tool this
// is NOT in the shared ATLAS_TOOLS registry (tool-registry.ts) — it is chat-only
// (appended to CHAT_TOOLS in llm-tools.ts), so it never reaches the MCP server,
// which has no browser to download a file to.
//
// It is also handled specially in the loop (chat-loop.ts): a normal tool handler
// returns JSON to the MODEL and can't push bytes to the browser, so the loop
// intercepts this call, builds the artifact here, yields an `export` SSE event
// carrying the file to the client, and feeds the model only a small ack.
import { z } from "zod";
import { toCSV, type CsvCell } from "../../../lib/csv.ts";

export const EXPORT_TOOL_NAME = "export_findings";

// Guardrail: an export travels inline over SSE and is produced by the model's own
// output budget, so it's naturally bounded — but cap defensively so a runaway
// generation can't ship a multi-megabyte frame. ~2MB of text.
const MAX_CONTENT_CHARS = 2_000_000;

export const EXPORT_TOOL_SHAPE = {
  format: z.enum(["markdown", "csv"]).describe("markdown for prose/write-ups, csv for tabular data (rows sharing columns)"),
  filename: z.string().optional().describe("Base file name without extension; the correct extension is added automatically."),
  title: z.string().optional().describe("A heading for the document; used as the markdown H1 and as the default file name."),
  markdown: z.string().optional().describe("The full markdown document body. Required when format is markdown."),
  columns: z.array(z.string()).optional().describe("Column headers, left-to-right. Required when format is csv."),
  rows: z
    .array(z.array(z.union([z.string(), z.number(), z.null()])))
    .optional()
    .describe("Table rows; each row is an array of cells aligned to columns. Required when format is csv."),
} satisfies z.ZodRawShape;

export const EXPORT_TOOL_DESCRIPTION =
  "Deliver what you have found to the user as a downloadable file. The file is saved to the user's computer.\n\n" +
  "When to use: ONLY when the user explicitly asks to export, save, or download the findings. Do not call it otherwise. " +
  "Choose format=markdown for prose (explanations, summaries, write-ups) and format=csv for structured/tabular data " +
  "(a list of items that share the same columns). For csv, pass `columns` and `rows` — do NOT hand-write CSV text. " +
  "For markdown, pass `markdown` (and optionally a `title`). After calling it, tell the user their file is downloading; " +
  "keep any citations you would normally include inside the exported content.";

export type ExportArtifact = {
  format: "markdown" | "csv";
  filename: string;
  mime: string;
  content: string;
  bytes: number;
};

type ExportArgs = z.infer<z.ZodObject<typeof EXPORT_TOOL_SHAPE>>;

// Derive a filesystem-safe base name (no extension) from the model's filename /
// title, falling back to a stable default. Strips path separators and control
// characters so the download can't traverse or carry a weird name.
function safeBaseName(filename: string | undefined, title: string | undefined): string {
  const raw = (filename ?? title ?? "atlas-export").toString();
  const cleaned = raw
    .replace(/\.(md|markdown|csv|txt)$/i, "") // drop an extension the model may have added
    .replace(/[/\\]+/g, "-") // no path separators
    .replace(/[^\w.\- ]+/g, "-") // anything exotic (incl. control chars) → dash
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || "atlas-export";
}

function capContent(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) return content;
  return content.slice(0, MAX_CONTENT_CHARS) + "\n\n[export truncated — content exceeded the size limit]";
}

// Build the downloadable artifact from the model's tool args. Throws a clear,
// model-readable message on invalid input; the loop turns that into an {error}
// tool result so the model can correct and retry.
export function buildExportArtifact(args: ExportArgs): ExportArtifact {
  if (args.format !== "markdown" && args.format !== "csv") {
    throw new Error("`format` must be 'markdown' or 'csv'.");
  }
  const base = safeBaseName(args.filename, args.title);

  if (args.format === "markdown") {
    const body = args.markdown;
    if (typeof body !== "string" || body.trim() === "") {
      throw new Error("format 'markdown' requires a non-empty `markdown` string.");
    }
    const heading = args.title ? `# ${args.title.trim()}\n\n` : "";
    const content = capContent(heading + body);
    return { format: "markdown", filename: `${base}.md`, mime: "text/markdown;charset=utf-8", content, bytes: content.length };
  }

  // csv
  const { columns, rows } = args;
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("format 'csv' requires a non-empty `columns` array.");
  }
  if (!Array.isArray(rows)) {
    throw new Error("format 'csv' requires a `rows` array (each row an array of cells aligned to columns).");
  }
  const content = capContent(toCSV(columns, rows as CsvCell[][]));
  return { format: "csv", filename: `${base}.csv`, mime: "text/csv;charset=utf-8", content, bytes: content.length };
}
