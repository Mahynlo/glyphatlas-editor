// =============================================================================
// NATIVE OCR BRIDGE — Main Thread only (Tauri IPC requires window context)
// =============================================================================
// This module calls the Rust `perform_native_ocr` or `perform_paddle_ocr`
// Tauri command and normalizes its output to the SAME format that
// ocr.worker.js produces for PaddleOCR:
//
//   result.results[i] = {
//     text: string,
//     confidence: number,
//     box: [[tl_x,tl_y],[tr_x,tr_y],[br_x,br_y],[bl_x,bl_y]],  // 0..1 normalized
//     rect: [x, y, w, h]                                          // 0..1 normalized
//   }
//
// IMPORTANT: This file MUST be imported from the Main Thread (React component),
// NOT from inside a Web Worker. Tauri's invoke() uses window.__TAURI_IPC__
// which is not available in Worker threads.

import { invoke } from '@tauri-apps/api/core';

/**
 * Run OCR on a single PDF page via the Rust Tauri backend.
 *
 * @param {string} pdfFilePath   Absolute path to the PDF file on disk.
 * @param {number} pageIndex     Zero-based page index.
 * @param {number} [dpi=200]     Render resolution.
 * @param {'native'|'paddle'} [engine='native']  OCR engine to use.
 *        - 'native' = oneocr-rs (Windows only, proprietary)
 *        - 'paddle' = ocr-rs / PaddleOCR (cross-platform, open-source)
 *
 * @returns {Promise<{
 *   results: Array<{text: string, confidence: number, box: number[][], rect: number[]}>,
 *   stats:   {totalTime: number, mode: string, engine: string},
 *   scanDimensions: {width: number, height: number, dpi: number}
 * }>}
 */
export async function nativeOcrPage(pdfFilePath, pageIndex, dpi = 300) {
    const t0 = performance.now();

    const commandName = 'perform_paddle_ocr';
    const engineLabel = 'ocr-rs (PaddleOCR)';
    const modeLabel = 'paddle_ocr';

    /** @type {import('../../../types.d.ts').NativeOcrPageResult} */
    const nativeResult = await invoke(commandName, {
        pdfPath: pdfFilePath,
        pageIndex,
        dpi,
    });

    const totalTime = performance.now() - t0;

    // Map the flat word list to the format already consumed by the frontend.
    const results = nativeResult.words.map(w => ({
        text: w.text,
        confidence: w.confidence,
        box: w.rect,
        box_quad: w.box_quad,
    }));

    const avgConfidence = results.length > 0
        ? results.reduce((sum, w) => sum + w.confidence, 0) / results.length
        : 0;

    return {
        results,
        stats: {
            totalTime,
            mode: modeLabel,
            engine: engineLabel,
            averageConfidence: avgConfidence,
            wordsFound: results.length,
        },
        scanDimensions: {
            width: nativeResult.image_width,
            height: nativeResult.image_height,
            dpi: nativeResult.dpi,
        },
        _raw: nativeResult,
    };
}
