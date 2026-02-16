
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
     * Free resources
     */
    destroy() {
        if (this.#doc) {
            this.#doc.destroy();
            this.#doc = null;
        }
    }
}
