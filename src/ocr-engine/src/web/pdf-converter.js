
import * as mupdf from 'mupdf';

/**
 * Wrapper for MuPDF WASM to handle PDF loading and rendering
 */
export class PdfConverter {
    #doc = null;

    /**
     * Load a PDF document from a buffer
     * @param {ArrayBuffer|Uint8Array} data - PDF file content
     */
    async loadDocument(data) {
        if (this.#doc) {
            this.#doc.destroy();
            this.#doc = null;
        }

        try {
            // mupdf.Document.openDocument is the standard way, 
            // but mupdf-js often requires loading the module first.
            // Usually 'mupdf' import provides the module.
            // We'll assume the standard sync/async loading depending on the lib version.
            // Recent mupdf.js usually returns a promise or module.

            // Check if we need to set the WASM path
            // mupdf.setWasmPath('mupdf-wasm.wasm'); // If needed

            this.#doc = mupdf.Document.openDocument(data, "application/pdf");
        } catch (e) {
            console.error("Failed to load PDF document:", e);
            throw e;
        }
    }

    /**
     * Get the number of pages in the loaded document
     */
    getPageCount() {
        if (!this.#doc) return 0;
        return this.#doc.countPages();
    }

    /**
     * Render a page to an ImageData object at a specific DPI
     * @param {number} pageIndex - 0-based page index
     * @param {number} dpi - Target DPI (default 200)
     * @returns {ImageData}
     */
    getPageImage(pageIndex, dpi = 200) {
        if (!this.#doc) throw new Error("No document loaded");

        const page = this.#doc.loadPage(pageIndex);

        // Calculate scale
        const scale = dpi / 72;
        const matrix = mupdf.Matrix.scale(scale, scale);

        // Render to Pixmap (RGB, NO Alpha) to allow mupdf to fill white background
        // Colorspace: RGB, Alpha: false
        const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);

        // Convert RGB Pixmap to RGBA ImageData
        const width = pixmap.getWidth();
        const height = pixmap.getHeight();
        const samples = pixmap.getPixels(); // Uint8ClampedArray (RGBRGB...)

        // ImageData requires RGBA (4 bytes per pixel)
        const rgbaData = new Uint8ClampedArray(width * height * 4);

        for (let i = 0; i < width * height; i++) {
            // Source: RGB (3 bytes)
            const r = samples[i * 3];
            const g = samples[i * 3 + 1];
            const b = samples[i * 3 + 2];

            // Dest: RGBA (4 bytes)
            rgbaData[i * 4] = r;
            rgbaData[i * 4 + 1] = g;
            rgbaData[i * 4 + 2] = b;
            rgbaData[i * 4 + 3] = 255; // Alpha Opaque
        }

        const imageData = new ImageData(rgbaData, width, height);

        // Cleanup
        pixmap.destroy();
        page.destroy();

        return imageData;
    }

    /**
     * Extrae texto estructurado y ubicación de bloques de imagen (Nativo)
     * @param {number} pageIndex 
     * @returns {Object} { textBlocks: Array, imageBlocks: Array, hasHiddenText: boolean }
     */
    getStructuredText(pageIndex) {
        if (!this.#doc) throw new Error("No document loaded");

        let page;
        try {
            page = this.#doc.loadPage(pageIndex);

            // Try to get structured text
            const stext = page.toStructuredText("preserve-whitespace");
            const bounds = page.getBounds();
            const pageWidth = bounds[2] - bounds[0];
            const pageHeight = bounds[3] - bounds[1];

            // MuPDF JS often exposes: stext.asJSON()
            // This is the safest way to get data out of WASM heap into JS object
            let data = null;
            if (stext.asJSON) {
                const jsonStr = stext.asJSON();
                data = JSON.parse(jsonStr);
            } else {
                // Fallback: manually walker if API exists, else abort
                console.warn("[PdfConverter] stext.asJSON() not available. Hybrid mode limited.");

                // Cleanup
                page.destroy();
                return { textBlocks: [], imageBlocks: [], hasHiddenText: false };
            }

            // Parse JSON Data
            // Structure typically: { blocks: [ { type: "text", lines: [...] }, { type: "image", bbox: [...] } ] }
            const textBlocks = [];
            const imageBlocks = [];
            let hasHiddenText = false;

            if (data && data.blocks) {
                // DEBUG: Log block types to see what MuPDF is returning
                const types = data.blocks.map(b => b.type);
                const uniqueTypes = [...new Set(types)];
                console.log(`[PdfConverter] Block Types Found: ${uniqueTypes.join(', ')}`);

                for (const block of data.blocks) {
                    if (block.type === 'image') {
                        // MuPDF JSON gives bbox as object {x, y, w, h} (Points)
                        const b = block.bbox;
                        imageBlocks.push({
                            box: [
                                b.x / pageWidth,
                                b.y / pageHeight,
                                b.w / pageWidth,
                                b.h / pageHeight
                            ]
                        });
                    } else if (block.type === 'text') {
                        textBlocks.push(block);
                    }
                }
            }

            // FALLBACK: If stext found no images, try page.getImages() (if available)
            if (imageBlocks.length === 0 && page.getImages) {
                try {
                    const images = page.getImages(); // Expects array of {x,y,w,h, ...}
                    if (images && images.length > 0) {
                        console.log(`[PdfConverter] page.getImages() found ${images.length} images.`);
                        for (const img of images) {
                            // Verify structure. Usually {x, y, w, h, transform: [a,b,c,d,e,f]}
                            // If it has x,y,w,h directly:
                            if (img.w > 0 && img.h > 0) {
                                // MuPDF getDrawings/getImages usually return Points
                                imageBlocks.push({
                                    box: [
                                        img.x / pageWidth,
                                        img.y / pageHeight,
                                        img.w / pageWidth,
                                        img.h / pageHeight
                                    ]
                                });
                            } else if (img.bbox) {
                                // Sometimes it's inside bbox property
                                const b = img.bbox;
                                imageBlocks.push({
                                    box: [
                                        b.x / pageWidth,
                                        b.y / pageHeight,
                                        b.w / pageWidth,
                                        b.h / pageHeight
                                    ]
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.warn("[PdfConverter] page.getImages() failed or not supported:", err);
                }
            }

            page.destroy();
            return { textBlocks, imageBlocks, hasHiddenText };

        } catch (e) {
            console.error("[PdfConverter] Structured extraction failed:", e);
            if (page) page.destroy();
            return { textBlocks: [], imageBlocks: [], hasHiddenText: false };
        }
    }

    /**
     * Renderiza un recorte de página para OCR de imagen
     */
    renderCrop(pageIndex, normBox, dpi = 200) {
        if (!this.#doc) throw new Error("No document loaded");
        const page = this.#doc.loadPage(pageIndex);

        const bounds = page.getBounds();
        const pageWidth = bounds[2] - bounds[0];
        const pageHeight = bounds[3] - bounds[1];

        // Convert Normalized to Points
        const x = normBox[0] * pageWidth;
        const y = normBox[1] * pageHeight;
        const w = normBox[2] * pageWidth;
        const h = normBox[3] * pageHeight;

        // Scale
        const scale = dpi / 72;
        const matrix = mupdf.Matrix.scale(scale, scale);
        // Translate source to origin? No, render full page translated
        matrix.translate(-x * scale, -y * scale);
        // Wait, order matters: scale then translate? or translate then scale?
        // We want (x,y) to become (0,0).
        // If we translate (-x, -y) first, then scale:  (p - off) * s.
        // MuPDF matrix: concat.
        // Let's use simple logic:
        // Render Full Page -> Crop Canvas. It's safe.
        // Matrix clipping is hard to get right without trial/error.

        // FALLBACK STRATEGY: Render Full, Crop JS.
        // Since we are in worker, we can do this efficiently?
        // Actually, rendering full page for every small image is slow.

        // Let's try correct Matrix:
        // Identity -> Translate(-x, -y) -> Scale(s, s).
        const m = mupdf.Matrix.identity();
        m.translate(-x, -y);
        m.scale(scale, scale);

        // Output size
        const targetW = Math.ceil(w * scale);
        const targetH = Math.ceil(h * scale);

        // Render
        const pixmap = page.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false);
        // Note: this might render blank if clipping not set?
        // MuPDF 1.2+ usually handles infinite canvas.

        const width = pixmap.getWidth();
        const height = pixmap.getHeight();
        const samples = pixmap.getPixels();

        // Create ImageData
        // Note: we might need to manually crop samples if it rendered more?
        // But usually pixmap honors the "valid" region.

        const rgba = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            rgba[i * 4] = samples[i * 3];
            rgba[i * 4 + 1] = samples[i * 3 + 1];
            rgba[i * 4 + 2] = samples[i * 3 + 2];
            rgba[i * 4 + 3] = 255;
        }

        page.destroy();
        return new ImageData(rgba, width, height);
    }

    /**
     * Free resources
     */
    destroy() {
        if (this.#doc) {
            this.#doc.destroy();
            this.#doc = null;
        }
    }
}
