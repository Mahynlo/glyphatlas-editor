use pdfium_render::prelude::*;
use crate::ocr_types::NativeOcrPageResult;
use std::collections::HashMap;

/// A simplified OCR word for JS→Rust inter-op (no pdfium dependency on the JS side).
#[derive(serde::Deserialize, Clone)]
pub struct OcrWordSer {
    pub text: String,
    /// [x, y, w, h] normalized 0..1, top-left origin (same as OCR engine output).
    pub rect: [f32; 4],
}

// ─────────────────────────────────────────────────────────────────────────────
//  Primary API — used by the new embed_ocr_and_save Tauri command
// ─────────────────────────────────────────────────────────────────────────────

/// Loads a PDF from `source_path`, injects an invisible searchable text layer
/// (PDF render mode 3 / Tr3 — the OCR industry standard), then saves to `output_path`.
///
/// # Arguments
/// * `source_path` — Path to the current PDF (already has redactions burned in via
///   EmbedPDF's `saveAsCopy` + `write_temp_pdf`).
/// * `output_path` — Destination chosen by the user via the native save dialog.
/// * `ocr_data`    — Map of page_index → [`OcrWordSer`] list.
pub fn embed_text_and_save(
    source_path: &str,
    output_path: &str,
    ocr_data: HashMap<u32, Vec<OcrWordSer>>,
) -> Result<(), String> {
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            .or_else(|_| Pdfium::bind_to_system_library())
            .map_err(|e| format!("Failed to bind to Pdfium: {}", e))?,
    );

    let mut document = pdfium
        .load_pdf_from_file(source_path, None)
        .map_err(|e| format!("Failed to load PDF '{}': {}", source_path, e))?;

    let helvetica_token: PdfFontToken = document.fonts_mut().helvetica();
    let page_count = document.pages().len();

    for page_idx in 0..page_count {
        let words = match ocr_data.get(&(page_idx as u32)) {
            Some(w) if !w.is_empty() => w,
            _ => continue,
        };

        let mut page = document
            .pages_mut()
            .get(page_idx)
            .map_err(|e| format!("Failed to get page {}: {}", page_idx, e))?;

        let width_pts  = page.width().value;
        let height_pts = page.height().value;

        for word in words {
            let text = word.text.trim();
            if text.is_empty() { continue; }

            let [norm_x, norm_y, _norm_w, norm_h] = word.rect;
            let font_size  = (norm_h * height_pts).max(1.0);
            let pdf_x      = norm_x * width_pts;
            let pdf_y_base = height_pts - (norm_y + norm_h) * height_pts;

            // Append trailing space → word boundary when text is extracted
            let text_with_space = format!("{} ", text);

            let mut text_obj = PdfPageTextObject::new(
                &document,
                &text_with_space,
                helvetica_token,
                PdfPoints::new(font_size),
            )
            .map_err(|e| format!("Text obj creation failed (page {}): {}", page_idx, e))?;

            // Render mode 3 = Invisible: present for search/copy but not drawn.
            // This is exactly what Adobe Acrobat, ABBYY FineReader etc. use.
            text_obj
                .set_render_mode(PdfPageTextRenderMode::Invisible)
                .map_err(|e| format!("set_render_mode failed (page {}): {}", page_idx, e))?;

            text_obj
                .translate(PdfPoints::new(pdf_x), PdfPoints::new(pdf_y_base))
                .map_err(|e| format!("Text translate failed (page {}): {}", page_idx, e))?;

            page.objects_mut()
                .add_text_object(text_obj)
                .map_err(|e| format!("add_text_object failed (page {}): {}", page_idx, e))?;
        }
    }

    document
        .save_to_file(output_path)
        .map_err(|e| format!("Failed to save PDF to '{}': {}", output_path, e))?;

    Ok(())
}

/// Returns `true` if the PDF at `path` already has extractable text on any of
/// its first few pages.  Used by the frontend to skip re-OCR on files that
/// already contain a native or previously-embedded text layer.
pub fn check_has_text(path: &str) -> Result<bool, String> {
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            .or_else(|_| Pdfium::bind_to_system_library())
            .map_err(|e| format!("Pdfium bind failed: {}", e))?,
    );

    let document = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|e| format!("Failed to load '{}': {}", path, e))?;

    // Check up to the first 3 pages — one with text suffices
    let pages_to_check = document.pages().len().min(3);
    for page_idx in 0..pages_to_check {
        let page = document
            .pages()
            .get(page_idx)
            .map_err(|e| format!("Page {} access failed: {}", page_idx, e))?;

        let text = page
            .text()
            .map_err(|e| format!("Text extract failed (page {}): {}", page_idx, e))?;

        // Ignore pure-whitespace content; >5 non-whitespace chars = real text
        let content: String = text.all().chars().filter(|c| !c.is_whitespace()).collect();
        if content.len() > 5 {
            return Ok(true);
        }
    }
    Ok(false)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Legacy API — kept for backward compat with the save_pdf_with_ocr command
// ─────────────────────────────────────────────────────────────────────────────

/// Exports a PDF with burned-in redactions and an invisible selectable text layer.
pub fn export_pdf(
    source_path: &str,
    output_path: &str,
    redactions: HashMap<u32, Vec<[f32; 4]>>,
    ocr_data: HashMap<u32, NativeOcrPageResult>,
) -> Result<(), String> {
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            .or_else(|_| Pdfium::bind_to_system_library())
            .map_err(|e| format!("Failed to bind to Pdfium: {}", e))?,
    );

    let mut document = pdfium
        .load_pdf_from_file(source_path, None)
        .map_err(|e| format!("Failed to load PDF '{}': {}", source_path, e))?;

    let helvetica_token: PdfFontToken = document.fonts_mut().helvetica();
    let page_count = document.pages().len();

    for page_idx in 0..page_count {
        let mut page = document
            .pages_mut()
            .get(page_idx)
            .map_err(|e| format!("Failed to get page {}: {}", page_idx, e))?;

        let width_pts  = page.width().value;
        let height_pts = page.height().value;

        // 1. Redactions
        if let Some(rects) = redactions.get(&(page_idx as u32)) {
            for r in rects {
                let pdf_left   = r[0] * width_pts;
                let pdf_bottom = height_pts - (r[1] + r[3]) * height_pts;
                let pdf_right  = pdf_left + r[2] * width_pts;
                let pdf_top    = pdf_bottom + r[3] * height_pts;

                let pdf_rect = PdfRect::new(
                    PdfPoints::new(pdf_bottom),
                    PdfPoints::new(pdf_left),
                    PdfPoints::new(pdf_top),
                    PdfPoints::new(pdf_right),
                );

                let path_obj = PdfPagePathObject::new_rect(
                    &document,
                    pdf_rect,
                    Some(PdfColor::new(0, 0, 0, 255)),
                    Some(PdfPoints::new(0.5)),
                    Some(PdfColor::new(0, 0, 0, 255)),
                )
                .map_err(|e| format!("Redaction rect creation failed (page {}): {}", page_idx, e))?;

                page.objects_mut()
                    .add_path_object(path_obj)
                    .map_err(|e| format!("Failed to add redaction (page {}): {}", page_idx, e))?;
            }
        }

        // 2. Invisible text layer
        if let Some(ocr_result) = ocr_data.get(&(page_idx as u32)) {
            for line in &ocr_result.lines {
                for word in &line.words {
                    let text = word.text.trim();
                    if text.is_empty() { continue; }

                    let norm_x = word.rect[0];
                    let norm_y = word.rect[1];
                    let norm_h = word.rect[3];

                    let font_size  = (norm_h * height_pts).max(1.0);
                    let pdf_x      = norm_x * width_pts;
                    let pdf_y_base = height_pts - (norm_y + norm_h) * height_pts;

                    let text_with_space = format!("{} ", text);

                    let mut text_obj = PdfPageTextObject::new(
                        &document,
                        &text_with_space,
                        helvetica_token,
                        PdfPoints::new(font_size),
                    )
                    .map_err(|e| format!("Text obj creation failed (page {}): {}", page_idx, e))?;

                    text_obj
                        .set_render_mode(PdfPageTextRenderMode::Invisible)
                        .map_err(|e| format!("set_render_mode failed (page {}): {}", page_idx, e))?;

                    text_obj
                        .translate(PdfPoints::new(pdf_x), PdfPoints::new(pdf_y_base))
                        .map_err(|e| format!("Text translate failed (page {}): {}", page_idx, e))?;

                    page.objects_mut()
                        .add_text_object(text_obj)
                        .map_err(|e| format!("add_text_object failed (page {}): {}", page_idx, e))?;
                }
            }
        }
    }

    document
        .save_to_file(output_path)
        .map_err(|e| format!("Failed to save PDF to '{}': {}", output_path, e))?;

    Ok(())
}
