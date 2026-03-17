import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_TEXT_CHARS = 200_000;

const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".doc", ".docx"]);

// MIME types that are legitimate for each extension.
// Some browsers report generic application/octet-stream for .txt/.md so we
// accept that too, but we always verify the extension first.
const EXTENSION_MIME_MAP: Record<string, Set<string>> = {
  ".txt": new Set(["text/plain", "application/octet-stream"]),
  ".md": new Set([
    "text/markdown",
    "text/plain",
    "application/octet-stream",
    "text/x-markdown",
  ]),
  ".pdf": new Set([
    "application/pdf",
    "application/x-pdf",
    "application/octet-stream",
  ]),
  ".doc": new Set(["application/msword", "application/octet-stream"]),
  ".docx": new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
  ]),
};

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

/** Strip null bytes, control characters (except newlines/tabs) that could be
 *  used for injection, and trim to MAX_TEXT_CHARS. */
function sanitizeText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return cleaned.length > MAX_TEXT_CHARS
    ? cleaned.slice(0, MAX_TEXT_CHARS)
    : cleaned;
}

export const POST: RequestHandler = async ({
  request,
}: {
  request: Request;
}) => {
  // Enforce content-type
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) {
    throw error(400, "Expected multipart/form-data");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw error(400, "Invalid form data");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw error(400, "No file provided");
  }

  // Validate size before reading
  if (file.size > MAX_BYTES) {
    throw error(413, "File too large (max 5 MB)");
  }

  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw error(415, `Unsupported file type: ${ext || "(none)"}`);
  }

  // Validate MIME type against extension
  const reportedMime = file.type || "application/octet-stream";
  const allowedMimes = EXTENSION_MIME_MAP[ext];
  if (!allowedMimes.has(reportedMime)) {
    throw error(415, "File MIME type does not match extension");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let extractedText: string;

  try {
    if (ext === ".txt" || ext === ".md") {
      extractedText = buffer.toString("utf-8");
    } else if (ext === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      extractedText = result.text;
    } else {
      // .doc / .docx
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value;
    }
  } catch (parseErr) {
    console.error("Document parse error:", parseErr);
    throw error(422, "Could not extract text from file");
  }

  return json({ text: sanitizeText(extractedText) });
};
