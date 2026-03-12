// =============================================================================
// OCR PADDLE — PaddleOCR (ocr-rs) based OCR for PDF pages
// =============================================================================
// Alternative to ocr_native.rs (oneocr-rs / Microsoft).
// Uses PP-OCRv5 models via the MNN inference framework.
// 100% open-source, Apache 2.0 licensed — safe for redistribution.
//
// Flow:
//   1. Load PDF page using pdfium-render.
//   2. Render full page to image at the requested DPI.
//   3. Run PaddleOCR detection + recognition via ocr_rs::OcrEngine.
//   4. Map results to NativeOcrPageResult (same format as ocr_native.rs).

use crate::ocr_types::{NativeOcrPageResult, OcrLineResult, OcrWordResult};
use ocr_rs::{OcrEngine, OcrEngineConfig};
use pdfium_render::prelude::*;
use std::cell::RefCell;

// Thread-local storage for Pdfium to avoid re-loading the DLL (stateless).
// Note: ENGINE is no longer cached here because reusing it between runs 
// was causing a drop in OCR precision (likely due to internal buffer reuse in MNN).
thread_local! {
    static PDFIUM: RefCell<Option<Pdfium>> = RefCell::new(None);
}

/// Locate model files relative to the running executable.
/// In dev mode they're at `./public/models/paddle/`,
/// in production (installed) Tauri places resources next to the .exe.
fn resolve_model_path(filename: &str) -> Result<String, String> {
    // 1. Try next to the executable (production / installed)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Tauri bundles resources into the same dir or a subdir
            let prod_path = dir.join("models").join("paddle").join(filename);
            if prod_path.exists() {
                return prod_path.to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "Path not UTF-8".to_string());
            }
            // Try flat resource layout
            let flat_path = dir.join(filename);
            if flat_path.exists() {
                return flat_path.to_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "Path not UTF-8".to_string());
            }
        }
    }

    // 2. Try relative to CWD (dev mode: `cargo tauri dev` runs from src-tauri/)
    let dev_path = std::path::Path::new("../public/models/paddle").join(filename);
    if dev_path.exists() {
        return dev_path.to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Path not UTF-8".to_string());
    }

    // 3. Try CWD directly
    let cwd_path = std::path::Path::new("public/models/paddle").join(filename);
    if cwd_path.exists() {
        return cwd_path.to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Path not UTF-8".to_string());
    }

    Err(format!("Model file '{}' not found in any expected location", filename))
}

/// Run PaddleOCR on a single page of a PDF.
pub fn ocr_pdf_page_paddle(
    pdf_path: &str,
    page_index: u32,
    dpi: u32,
) -> Result<NativeOcrPageResult, String> {
    
    // 1 & 2. Init PaddleOCR Engine (Fresh instance per call for max precision)
    // ------------------------------------------------------------------
    let det_path = resolve_model_path("PP-OCRv5_mobile_det.mnn")?;
    let rec_path = resolve_model_path("latin_PP-OCRv5_mobile_rec_infer.mnn")?;
    let keys_path = resolve_model_path("ppocr_keys_latin.txt")?;

    let config = OcrEngineConfig::new();
    let engine = OcrEngine::new(&det_path, &rec_path, &keys_path, Some(config))
        .map_err(|e| format!("PaddleOCR engine init failed: {e}"))?;

    // ------------------------------------------------------------------
    // 3. Init Pdfium & Load Page (Lazily cached Pdfium instance)
    // ------------------------------------------------------------------
    // Try to load Pdfium, ensuring we only bind to the library once per thread
    PDFIUM.with(|pdfium_cell| {
        let mut pdfium_opt = pdfium_cell.borrow_mut();
        if pdfium_opt.is_none() {
            let pdfium = Pdfium::new(
                Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name())
                    .map_err(|e| format!("pdfium.dll missing or init failed: {e}"))?,
            );
            *pdfium_opt = Some(pdfium);
        }
        // Since Pdfium isn't Clone, we can't easily escape the with() closure with it.
        // But we need it for `load_pdf_from_file`. 
        // We will do the processing inside PDFIUM.with or refactor to clone if possible.
        // Unfortunately Pdfium instances hold raw ptrs. But wait, `Pdfium` itself is just a thin wrapper.
        Ok::<(), String>(())
    })?;

    // We need to execute the OCR while holding references if we don't clone.
    let mut render_w = 0;
    let mut render_h = 0;
    let mut final_lines = Vec::new();
    let mut final_words = Vec::new();

    PDFIUM.with(|pdfium_cell| {
        let pdfium_opt = pdfium_cell.borrow();
        let pdfium = pdfium_opt.as_ref().unwrap();

        let doc = pdfium
            .load_pdf_from_file(pdf_path, None)
            .map_err(|e| format!("Failed to load PDF '{}': {}", pdf_path, e))?;

        let page = doc
            .pages()
            .get(page_index as u16)
            .map_err(|e| format!("Page {} out of range: {}", page_index, e))?;

        // ------------------------------------------------------------------
        // 4. Render Page to Image
        // ------------------------------------------------------------------
        let scale_factor = dpi as f32 / 72.0;
        let page_width_pts = page.width().value;
        let page_height_pts = page.height().value;
        render_w = (page_width_pts * scale_factor).round() as u32;
        render_h = (page_height_pts * scale_factor).round() as u32;

        let render_config = PdfRenderConfig::new()
            .set_target_width(render_w as i32)
            .set_maximum_height(render_h as i32)
            .set_clear_color(PdfColor::new(255, 255, 255, 255)); // Explicit white background

        let bitmap = page
            .render_with_config(&render_config)
            .map_err(|e| format!("Page render failed: {e}"))?;

        let dyn_image = bitmap.as_image();

        // ------------------------------------------------------------------
        // 5. Run PaddleOCR (Fresh engine)
        // ------------------------------------------------------------------
        let results = engine.recognize(&dyn_image)
            .map_err(|e| format!("PaddleOCR recognize failed: {e}"))?;

        // ------------------------------------------------------------------
        // 6. Map Results to NativeOcrPageResult
        // ------------------------------------------------------------------
        let img_w = dyn_image.width() as f32;
        let img_h = dyn_image.height() as f32;

        for result in &results {
            let text = result.text.trim().to_string();
            if text.is_empty() { continue; }

            let rect = &result.bbox.rect;
            let px_left = rect.left() as f32;
            let px_top = rect.top() as f32;
            let px_w = rect.width() as f32;
            let px_h = rect.height() as f32;

            let norm_x = px_left / img_w;
            let norm_y = px_top / img_h;
            let norm_w = px_w / img_w;
            let norm_h = px_h / img_h;

            let box_quad: [[f32; 2]; 4] = [
                [norm_x, norm_y],                        
                [norm_x + norm_w, norm_y],               
                [norm_x + norm_w, norm_y + norm_h],      
                [norm_x, norm_y + norm_h],               
            ];

            let word = OcrWordResult {
                text: text.clone(),
                confidence: result.confidence,
                box_quad,
                rect: [norm_x, norm_y, norm_w, norm_h],
            };

            final_words.push(word.clone());
            final_lines.push(OcrLineResult {
                text,
                box_quad,
                words: vec![word],
            });
        }
        Ok::<(), String>(())
    })?;

    Ok(NativeOcrPageResult {
        page_index,
        image_width: render_w,
        image_height: render_h,
        dpi,
        lines: final_lines,
        words: final_words,
    })
}
