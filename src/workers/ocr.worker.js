import * as ort from 'onnxruntime-web';
import { DEFAULT_CONFIG } from '../ocr-engine/src/config.js';

// -----------------------------------------------------------------------------
// CRITICAL: Configure WASM Paths BEFORE loading libraries
// -----------------------------------------------------------------------------

// 1. Configure ONNX Runtime
ort.env.wasm.wasmPaths = '/';

// 2. Configure MuPDF
// MuPDF WASM module looks for this global to override file location behavior.
// We force it to look at the root '/' because our worker is in 'assets/' but
// we copied 'mupdf-wasm.wasm' to 'public/' (served at root).
globalThis.$libmupdf_wasm_Module = {
    locateFile: (path) => {
        if (path.endsWith('.wasm')) {
            return '/' + path;
        }
        return path;
    }
};

// -----------------------------------------------------------------------------
// Worker State
// -----------------------------------------------------------------------------
let PdfConverterClass = null;
let OcrClass = null;
let pdfConverter = null;
let ocr = null;

// -----------------------------------------------------------------------------
// Message Queue for Sequential Processing (Crucial for WebGPU)
// -----------------------------------------------------------------------------
const messageQueue = [];
let isProcessing = false;

self.onmessage = (e) => {
    messageQueue.push(e.data);
    processQueue();
};

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;

    isProcessing = true;
    const { type, payload } = messageQueue.shift();

    try {
        switch (type) {
            case 'INIT':
                await handleInit(payload);
                break;
            case 'PROCESS_PAGE':
                // Ensure resources are not busy
                await handleProcessPage(payload);
                break;
            case 'CLEANUP':
                await handleCleanup();
                break;
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            payload: error.message || String(error)
        });
    } finally {
        isProcessing = false;
        // Process next item
        setTimeout(processQueue, 0);
    }
}

import cv from '@techstark/opencv-js';

// ... (previous imports)

async function handleInit(config) {
    try {
        self.postMessage({ type: 'STATUS', payload: 'Loading Libraries...' });

        // 1. Load OpenCV (Heavy)
        // Ensure this is loaded before others that might depend on it
        self.postMessage({ type: 'STATUS', payload: 'Initializing OpenCV...' });

        // Handle both default export as function or module with default
        // Initialize based on README pattern
        // The import might be a factory function, a promise, or the module instance itself.

        let cvInstance;
        if (cv instanceof Promise) {
            cvInstance = await cv;
            console.log("OpenCV loaded via Promise");
        } else if (typeof cv === 'function') {
            cvInstance = await cv();
            console.log("OpenCV loaded via Factory Function");
        } else {
            // It's the module instance (Emscripten / WASM already instantiated or pending)
            if (!cv.onRuntimeInitialized && cv.Mat) {
                // Already ready?
                cvInstance = cv;
                console.log("OpenCV already ready");
            } else {
                console.log("OpenCV loaded via onRuntimeInitialized");
                await new Promise((resolve) => {
                    // Check if already fired (no standard flag, but check Mat)
                    if (cv.Mat) return resolve();
                    cv.onRuntimeInitialized = () => {
                        console.log("OpenCV Runtime Initialized");
                        resolve();
                    };
                });
                cvInstance = cv;
            }
        }

        // Dynamically import libraries to ensure config is applied first
        if (!PdfConverterClass) {
            const pdfMod = await import('../ocr-engine/src/web/pdf-converter.js');
            PdfConverterClass = pdfMod.PdfConverter;
            // Also inject CV if PdfConverter needed it (it doesn't, but Utils does)
            const utilsMod = await import('../ocr-engine/src/web/utils.js');
            utilsMod.ImageProcessor.initOpenCV(cv);
        }

        if (!OcrClass) {
            const ocrMod = await import('../ocr-engine/src/web/ocr.js');
            OcrClass = ocrMod.Ocr;
        }

        self.postMessage({ type: 'STATUS', payload: 'Initializing MuPDF...' });
        pdfConverter = new PdfConverterClass();

        self.postMessage({ type: 'STATUS', payload: 'Loading OCR Models...' });
        // Initialize OCR engine
        // Pass 'cv' instance specifically to create
        ocr = await OcrClass.create(config || DEFAULT_CONFIG, cv); // Updated signature

        self.postMessage({ type: 'READY' });

    } catch (error) {
        console.error("Worker Init Failed:", error);
        throw new Error(`Initialization failed: ${error.message}`);
    }
}

async function handleProcessPage({ pdfData, pageIndex }) {
    if (!pdfConverter || !ocr) {
        throw new Error('Worker not initialized');
    }

    try {
        self.postMessage({ type: 'STATUS', payload: `Processing Page ${pageIndex + 1}...` });

        // 1. Load PDF Document (if needed)
        // Optimization: Keep doc open if possible, but for safety reload
        await pdfConverter.loadDocument(pdfData);

        // 2. Render Page to Image (220 DPI)
        // Reference implementation uses 200 DPI. 
        // 300 DPI is too heavy, 200 is okay. 220 matches 1440px width better for A4.
        const imageData = pdfConverter.getPageImage(pageIndex, 220);

        // 3. Run OCR Pipeline (Det -> Sort -> Rec)
        // Returns { results, stats }
        const { results, stats } = await ocr.execute(imageData);

        // 4. Clean up PDF resources for this page
        pdfConverter.destroy();

        // 5. Normalize Coordinates (Pixels -> 0..1)
        // CRITICAL: OCRTextLayer expects 'box' to be [x, y, w, h] normalized
        // Without this, the text overlay will be positioned wildly incorrectly.
        const normalizedResults = results.map(item => {
            // item.rect is [x, y, w, h] in pixels
            // box in result from detection is quad [[x,y]...], 
            // but after recognition/grouping it might be { box: [[x,y]..], rect: [x,y,w,h] }
            let x, y, w, h;
            if (item.rect) {
                [x, y, w, h] = item.rect;
            } else if (item.box) {
                const xs = item.box.map(p => p[0]);
                const ys = item.box.map(p => p[1]);
                x = Math.min(...xs);
                y = Math.min(...ys);
                w = Math.max(...xs) - x;
                h = Math.max(...ys) - y;
            }

            return {
                ...item,
                box: [
                    x / imageData.width,
                    y / imageData.height,
                    w / imageData.width,
                    h / imageData.height
                ]
            };
        });

        // 5. Send Results
        self.postMessage({
            type: 'RESULT',
            payload: {
                pageIndex,
                scanDimensions: {
                    width: imageData.width,
                    height: imageData.height,
                    dpi: 220 // explicit
                },
                stats, // Timing and confidence stats
                results: normalizedResults
            }
        });

    } catch (error) {
        console.error("Page Process Failed:", error);
        throw error;
    }
}

async function handleCleanup() {
    if (pdfConverter) {
        pdfConverter.destroy();
    }
    // Ocr cleanup if needed (session release)
}
