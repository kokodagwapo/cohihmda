/**
 * Document Parser Service
 * Handles parsing of various document formats (PDF, DOCX, TXT, HTML)
 */

export interface ParsedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    wordCount: number;
    language?: string;
    title?: string;
    author?: string;
  };
}

/**
 * Parse a document based on its file type
 */
export async function parseDocument(
  fileBuffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<ParsedDocument> {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  const detectedMimeType = mimeType || getMimeTypeFromExtension(extension);

  switch (detectedMimeType) {
    case "application/pdf":
      return parsePDF(fileBuffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/msword":
      return parseDOCX(fileBuffer);
    case "text/plain":
      return parseTXT(fileBuffer);
    case "text/html":
      return parseHTML(fileBuffer);
    case "text/csv":
      return parseCSV(fileBuffer);
    default:
      // Try to parse as text
      return parseTXT(fileBuffer);
  }
}

/**
 * Parse PDF document
 */
async function parsePDF(buffer: Buffer): Promise<ParsedDocument> {
  try {
    // pdf-parse v2.x uses PDFParse class with options object
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    // Get text from all pages
    const pages = result.pages || [];
    const text = pages.map((page: any) => page.text || "").join("\n\n");

    // Clean up
    await parser.destroy();

    return {
      text,
      metadata: {
        pageCount: result.total || pages.length,
        wordCount: text.split(/\s+/).filter((word: string) => word.length > 0)
          .length,
      },
    };
  } catch (error: any) {
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

/**
 * Parse DOCX document
 */
async function parseDOCX(buffer: Buffer): Promise<ParsedDocument> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });

    return {
      text: result.value,
      metadata: {
        wordCount: result.value.split(/\s+/).filter((word) => word.length > 0)
          .length,
      },
    };
  } catch (error: any) {
    throw new Error(`Failed to parse DOCX: ${error.message}`);
  }
}

/**
 * Parse plain text document
 */
function parseTXT(buffer: Buffer): ParsedDocument {
  const text = buffer.toString("utf-8");
  return {
    text,
    metadata: {
      wordCount: text.split(/\s+/).filter((word) => word.length > 0).length,
    },
  };
}

/**
 * Parse HTML document
 */
function parseHTML(buffer: Buffer): ParsedDocument {
  const html = buffer.toString("utf-8");
  // Simple HTML tag removal (in production, use a proper HTML parser)
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    text,
    metadata: {
      wordCount: text.split(/\s+/).filter((word) => word.length > 0).length,
    },
  };
}

/**
 * Parse CSV document
 */
function parseCSV(buffer: Buffer): ParsedDocument {
  const csv = buffer.toString("utf-8");
  // Convert CSV to readable text format
  const lines = csv.split("\n").slice(0, 100); // Limit to first 100 rows
  const text = lines.join("\n");

  return {
    text,
    metadata: {
      wordCount: text.split(/\s+/).filter((word) => word.length > 0).length,
    },
  };
}

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromExtension(extension: string): string {
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    txt: "text/plain",
    md: "text/plain",
    html: "text/html",
    htm: "text/html",
    csv: "text/csv",
  };

  return mimeTypes[extension] || "application/octet-stream";
}

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 characters)
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
