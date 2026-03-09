use pdfium_render::prelude::*;
use crate::ocr_types::NativeOcrPageResult;
use std::collections::HashMap;

/// Exports a PDF with "burned-in" redactions and an invisible selectable text layer.
///
/// # Arguments
/// * `source_path` - Path to the original PDF.
/// * `output_path` - Path where the new PDF will be saved.
/// * `redactions`  - Map of page_index → list of [x, y, w, h] (0..1 normalized, top-left origin).
/// * `ocr_data`    - Map of page_index → NativeOcrPageResult with words and bounding boxes.
pub fn export_pdf(
    source_path: &str,
    output_path: &str,
    redactions: HashMap<u32, Vec<[f32; 4]>>,
    ocr_data: HashMap<u32, NativeOcrPageResult>,
) -> Result<(), String> {
    // Initialize Pdfium (bind to bundled or system library)
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            .or_else(|_| Pdfium::bind_to_system_library())
            .map_err(|e| format!("Failed to bind to Pdfium: {}", e))?,
    );

    // Load document
    let mut document = pdfium
        .load_pdf_from_file(source_path, None)
        .map_err(|e| format!("Failed to load PDF '{}': {}", source_path, e))?;

    // Retrieve a Helvetica font token before entering the page loop.
    // PdfFontToken is Copy so storing it here avoids borrow conflicts inside the loop.
    let helvetica_token: PdfFontToken = document.fonts_mut().helvetica();

    let page_count = document.pages().len();

    for page_idx in 0..page_count {
        // Get the page (borrows `document` mutably only for this scope)
        let mut page = document
            .pages_mut()
            .get(page_idx)
            .map_err(|e| format!("Failed to get page {}: {}", page_idx, e))?;

        let width_pts  = page.width().value;
        let height_pts = page.height().value;

        // ------------------------------------------------------------------
        // 1. Redactions — draw filled black rectangles over redacted regions.
        // ------------------------------------------------------------------
        if let Some(rects) = redactions.get(&(page_idx as u32)) {
            for r in rects {
                // r is [x, y, w, h] normalized (0..1), top-left origin.
                let pdf_left   = r[0] * width_pts;
                let pdf_bottom = height_pts - (r[1] + r[3]) * height_pts;
                let pdf_right  = pdf_left + r[2] * width_pts;
                let pdf_top    = pdf_bottom + r[3] * height_pts;

                // PdfRect::new(bottom, left, top, right)
                let pdf_rect = PdfRect::new(
                    PdfPoints::new(pdf_bottom),
                    PdfPoints::new(pdf_left),
                    PdfPoints::new(pdf_top),
                    PdfPoints::new(pdf_right),
                );

                // new_rect(doc, rect, stroke_color, stroke_width, fill_color)
                let path_obj = PdfPagePathObject::new_rect(
                    &document,
                    pdf_rect,
                    Some(PdfColor::new(0, 0, 0, 255)), // Black stroke
                    Some(PdfPoints::new(0.5)),
                    Some(PdfColor::new(0, 0, 0, 255)), // Black fill
                )
                .map_err(|e| format!("Redaction rect creation failed (page {}): {}", page_idx, e))?;

                page.objects_mut()
                    .add_path_object(path_obj)
                    .map_err(|e| format!("Failed to add redaction (page {}): {}", page_idx, e))?;
            }
        }

        // ------------------------------------------------------------------
        // 2. Invisible text layer — inject OCR words as invisible text objects
        //    so the PDF becomes searchable/selectable.
        // ------------------------------------------------------------------
        if let Some(ocr_result) = ocr_data.get(&(page_idx as u32)) {
            for line in &ocr_result.lines {
                for word in &line.words {
                    let text = word.text.trim();
                    if text.is_empty() {
                        continue;
                    }

                    // word.rect is [x, y, w, h] normalized, top-left origin.
                    let norm_x = word.rect[0];
                    let norm_y = word.rect[1];
                    let _norm_w = word.rect[2];
                    let norm_h = word.rect[3];

                    let font_size  = (norm_h * height_pts).max(1.0);
                    let pdf_x      = norm_x * width_pts;
                    let pdf_y_base = height_pts - (norm_y + norm_h) * height_pts;

                    // Append a trailing space so that when a PDF reader extracts
                    // text it inserts a word boundary between adjacent objects.
                    // Without this, "Hello" and "World" become "HelloWorld".
                    let text_with_space = format!("{} ", text);

                    // Build text object using the pre-fetched Helvetica token.
                    // PdfPageTextObject::new accepts impl ToPdfFontToken, and PdfFontToken is one.
                    let mut text_obj = PdfPageTextObject::new(
                        &document,
                        &text_with_space,
                        helvetica_token, // PdfFontToken implements ToPdfFontToken
                        PdfPoints::new(font_size),
                    )
                    .map_err(|e| format!("Text obj creation failed (page {}): {}", page_idx, e))?;

                    // Invisible render mode = "Tr 3" in PDF spec; text occupies space
                    // but is not visually rendered — perfect for a searchable overlay.
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

    // Save the modified PDF.
    document
        .save_to_file(output_path)
        .map_err(|e| format!("Failed to save PDF to '{}': {}", output_path, e))?;

    Ok(())
}
