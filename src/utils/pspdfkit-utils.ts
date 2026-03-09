
/**
 * Utility for mapping between our OCR detection format and @embedpdf Model.
 */

export interface OCRResultItem {
    text: string;
    confidence: number;
    box: number[]; // [x, y, w, h] normalized 0..1
}

export interface PageInfo {
    width: number;
    height: number;
}

/**
 * Per-page OCR data used by engine overrides to serve text extraction / search.
 */
export interface OcrPageData {
    /** Flat character array indexed by charStart position. */
    chars: string[];
    /** PdfPageGeometry-compatible runs injected into the SelectionPlugin. */
    geo: { runs: PdfRun[] };
}

/** PdfGlyphSlim-compatible glyph (matches @embedpdf/models shape). */
export interface PdfGlyphSlim {
    x: number;
    y: number;
    width: number;
    height: number;
    flags: number;
}

/** PdfRun-compatible run (matches @embedpdf/models shape). */
export interface PdfRun {
    /** Run bounding box in page coords — origin/size format as EmbedPDF expects */
    rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
    charStart: number;
    glyphs: PdfGlyphSlim[];
    fontSize?: number;
}

/**
 * Converts OCR results to @embedpdf annotations for a specific page.
 * Returns an array of PdfAnnotationObject-compatible objects.
 */
export const mapOcrToAnnotations = (results: OCRResultItem[], pageIndex: number, pageInfo: PageInfo) => {
    if (!results || results.length === 0) return [];

    return results.map((item, index) => {
        // Conversion: Normalized (0..1) -> PDF Points
        const x = item.box[0] * pageInfo.width;
        const y = item.box[1] * pageInfo.height;
        const width = item.box[2] * pageInfo.width;
        const height = item.box[3] * pageInfo.height;

        return {
            id: `ocr-${pageIndex}-${index}`,
            type: 5, // PdfAnnotationSubtype.SQUARE
            pageIndex: pageIndex,
            rect: {
                origin: { x, y },
                size: { width, height }
            },
            strokeColor: "#3182ce",
            strokeWidth: 1,
            opacity: 0.3,
            contents: item.text,
            flags: ["readOnly", "locked"] as any[],
            custom: {
                type: "ocr-detection",
                text: item.text,
                confidence: item.confidence
            }
        };
    });
};

/**
 * Maps @embedpdf annotations (redactions) back to normalized [x,y,w,h] for our Rust exporter.
 */
export const mapAnnotationsToRedactions = (annotations: any[], pageInfo: PageInfo) => {
    return annotations
        .filter(ann => ann.type === 28) // PdfAnnotationSubtype.REDACT or our black squares
        .map(ann => {
            const { origin, size } = ann.rect;
            return [
                origin.x / pageInfo.width,
                origin.y / pageInfo.height,
                size.width / pageInfo.width,
                size.height / pageInfo.height
            ];
        });
};

// ─────────────────────────────────────────────────────────────────────────────
// Geometry — for SelectionPlugin hit-testing + engine text/search overrides
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts OCR results into a valid PdfPageGeometry object AND a flat char
 * array for text extraction.
 *
 * Character layout (one word per run, +1 virtual space between runs):
 *   Run 0 "Hello" → chars[0..4], chars[5]=' ', charStart=0
 *   Run 1 "World" → chars[6..10], chars[11]=' ', charStart=6
 *
 * The `chars` array is kept aligned with the SelectionPlugin's charStart
 * indices so `getTextSlices` can slice it directly.
 */
export const mapOcrToGeometryAndChars = (
    results: OCRResultItem[],
    pageInfo: PageInfo
): OcrPageData => {
    let charOffset = 0;
    const chars: string[] = [];

    const runs: PdfRun[] = results.map(item => {
        const x = item.box[0] * pageInfo.width;
        const y = item.box[1] * pageInfo.height;
        const width = item.box[2] * pageInfo.width;
        const height = item.box[3] * pageInfo.height;

        const textChars = item.text.split('');
        const charWidth = width / Math.max(1, textChars.length);
        const charStart = charOffset;

        const glyphs: PdfGlyphSlim[] = textChars.map((ch, i) => {
            chars.push(ch);
            return { x: x + i * charWidth, y, width: charWidth, height, flags: 0 };
        });

        // Append virtual space between words
        chars.push(' ');
        charOffset += textChars.length + 1;

        return {
            rect: {
                origin: { x, y },
                size: { width, height }
            },
            charStart,
            glyphs,
            fontSize: height * 0.8
        };
    });

    return { geo: { runs }, chars };
};

/**
 * Backward-compat shim — returns only the geometry portion.
 * Prefer `mapOcrToGeometryAndChars` when you also need the char array.
 */
export const mapOcrToGeometry = (results: OCRResultItem[], pageInfo: PageInfo) =>
    mapOcrToGeometryAndChars(results, pageInfo).geo;

/**
 * Returns EmbedPDF `Rect[]` (origin/size format) covering the glyphs in the
 * given character range.  Used to build highlight rects for SearchResult entries.
 */
export const getRectsForCharRange = (
    geo: { runs: PdfRun[] },
    charStart: number,
    charCount: number
): Array<{ origin: { x: number; y: number }; size: { width: number; height: number } }> => {
    if (!geo?.runs) return [];
    const charEnd = charStart + charCount;
    const rects: Array<{ origin: { x: number; y: number }; size: { width: number; height: number } }> = [];

    for (const run of geo.runs) {
        const runEnd = run.charStart + run.glyphs.length;
        if (runEnd <= charStart || run.charStart >= charEnd) continue;

        const sliceStart = Math.max(0, charStart - run.charStart);
        const sliceEnd = Math.min(run.glyphs.length, charEnd - run.charStart);
        const slice = run.glyphs.slice(sliceStart, sliceEnd);
        if (slice.length === 0) continue;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const g of slice) {
            minX = Math.min(minX, g.x);
            minY = Math.min(minY, g.y);
            maxX = Math.max(maxX, g.x + g.width);
            maxY = Math.max(maxY, g.y + g.height);
        }

        rects.push({
            origin: { x: minX, y: minY },
            size: { width: maxX - minX, height: maxY - minY }
        });
    }

    return rects;
};
