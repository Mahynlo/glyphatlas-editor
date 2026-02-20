// =============================================================================
// OCR NATIVE — Windows-only PDF render + oneocr-rs OCR
// =============================================================================
// Optimized flow:
//   1. Load PDF page using pdfium-render.
//   2. Check if page has native text (length > threshold).
//   3. IF text exists:
//      - Extract only images from the page.
//      - Run OCR on each image.
//      - Transform OCR results from "Image Space" to "Page Space" (normalized).
//   4. IF NO text exists (scanned doc):
//      - Render full page to image (slow).
//      - Run OCR on full page.
//   5. Return normalized results.

use crate::ocr_types::{NativeOcrPageResult, OcrLineResult, OcrWordResult};
use image::DynamicImage;
use oneocr_rs::{BoundingBox, ImageInput, OcrEngine, OcrOptions};
use pdfium_render::prelude::*;

/// Render one page of a PDF (from disk) and run Windows OCR on it.
pub fn ocr_pdf_page(
    pdf_path: &str,
    page_index: u32,
    dpi: u32,
) -> Result<NativeOcrPageResult, String> {
    // ------------------------------------------------------------------
    // 1. Init Pdfium & Load Page
    // ------------------------------------------------------------------
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name())
            .map_err(|e| format!("pdfium.dll missing or init failed: {e}"))?,
    );

    let doc = pdfium
        .load_pdf_from_file(pdf_path, None)
        .map_err(|e| format!("Failed to load PDF '{pdf_path}': {e}"))?;

    let page = doc
        .pages()
        .get(page_index as u16)
        .map_err(|e| format!("Page {page_index} out of range: {e}"))?;

    let mut final_lines = Vec::new();
    let mut final_words = Vec::new();

    // Initialize OCR Engine once
    let ocr_options = OcrOptions {
        include_word_level_details: true,
        ..Default::default()
    };
    let engine = OcrEngine::new_with_options(ocr_options)
        .map_err(|e| format!("OCR engine init failed: {e}"))?;
    
    // Safety check just in case
    let _ = engine.set_max_recognition_line_count(1000);

    // ------------------------------------------------------------------
    // 2. Determine Strategy: Full Page vs. Image Extraction
    // ------------------------------------------------------------------
    let text_content = page.text().map_err(|e| format!("Failed to get page text: {e}"))?;
    let char_count = text_content.len();
    let has_native_text = char_count > 50; // Threshold: if >50 chars, assume it's a "text" page

    // Calculate generic page dimensions (for normalization)
    // Scale used for "virtual" pixel size matching the frontend viewport
    let scale_factor = dpi as f32 / 72.0;
    let page_width_pts = page.width().value;
    let page_height_pts = page.height().value;
    
    // Reporting dimensions: even if we don't render full page, valid dims help the frontend.
    let report_w = (page_width_pts * scale_factor).round() as u32;
    let report_h = (page_height_pts * scale_factor).round() as u32;

    if !has_native_text {
        // [STRATEGY A] Full Page Render (Standard / Fallback)
        // Used for scanned documents with no text layer.
        
        let render_config = PdfRenderConfig::new()
            .set_target_width(report_w as i32)
            .set_maximum_height(report_h as i32);

        let bitmap = page
            .render_with_config(&render_config)
            .map_err(|e| format!("Page render failed: {e}"))?;
        
        let dyn_image = bitmap.as_image();
        
        // Run OCR on the whole page image
        let results = run_ocr_on_image(&engine, dyn_image, None)?; // None = no transform needed, already page-aligned
        
        // Normalize results to 0..1 based on the simplified full-page logic
        // For full page render, image_dims == page_dims, so we just normalize by report_w/h
        let (img_w, img_h) = (report_w, report_h);
        
        for (line_text, line_bb, mut l_words) in results {
            let line_quad = normalize_plain_quad(&line_bb, img_w, img_h);
            
            let mapped_words: Vec<OcrWordResult> = l_words.drain(..).map(|(w_text, w_conf, w_bb)| {
                let w_quad = normalize_plain_quad(&w_bb, img_w, img_h);
                OcrWordResult {
                    text: w_text,
                    confidence: w_conf,
                    box_quad: w_quad,
                    rect: quad_to_rect(&w_quad),
                }
            }).collect();

            final_words.extend(mapped_words.clone());
            final_lines.push(OcrLineResult {
                text: line_text,
                box_quad: line_quad,
                words: mapped_words,
            });
        }

    } else {
        // [STRATEGY B] Native Text Present -> Mixed Mode
        // 1. Extract Native Text
        // 2. OCR Images (if any)
        
        // --- 1. Native Text Extraction ---
        // We iterate over text segments to build lines/words. 
        // Note: PDF text extraction varies. Segments are often just chunks of text.
        // For a robust implementation, we might want to group by Y coordinate (lines).
        // Here we do a simplified pass: treat each segment as a "word/line".
        
        // We'll iterate characters to get precise bounding boxes if possible, 
        // but segments are usually performance-better.
        // Let's try iterating characters for maximum precision if segments aren't enough,
        // but text_content (PdfPageText) usually has a way to get rects.
        
        // --- 1. Native Text Extraction ---
        // Use segments() which typically corresponds to text runs / words
        let segments = text_content.segments();
        
        // Structure to hold working line
        struct WorkingLine {
            y: f32,
            // height: f32, // Unused
            text: String,
            words: Vec<OcrWordResult>,
            min_x: f32,
            max_x: f32,
            max_y: f32,
            min_y: f32,
        }
        
        let mut sections: Vec<WorkingLine> = Vec::new();
        
        for segment in segments.iter() {
             let txt = segment.text(); // Returns String
             if txt.trim().is_empty() { continue; }
             
             // pdfium-render segments return PdfRect directly (not Result)
             let rect = segment.bounds(); 
                 
             let x = rect.left().value;
             // ... rest of logic uses rect ...
             let y = rect.bottom().value; // PDF is bottom-up
             let w = rect.width().value;
             let h = rect.height().value;
             
             // Normalize to 0..1 (Top-Down for frontend)
             let norm_x = x / page_width_pts;
             let norm_y = 1.0 - ((y + h) / page_height_pts); // Top of box (y+h is top in PDF)
             let norm_w = w / page_width_pts;
             let norm_h = h / page_height_pts;
             
             let box_quad = [
                 [norm_x, norm_y], 
                 [norm_x + norm_w, norm_y], 
                 [norm_x + norm_w, norm_y + norm_h], 
                 [norm_x, norm_y + norm_h]
             ];
             
             let word = OcrWordResult {
                 text: txt.clone(),
                 confidence: 1.0, // Native text is 100% confident
                 box_quad,
                 rect: quad_to_rect(&box_quad),
             };
             
             // Append to "lines" based on Y proximity
             let line_threshold = 5.0 / page_height_pts; 
             
             let mut found = false;
             for line in sections.iter_mut() {
                 if (line.y - norm_y).abs() < line_threshold {
                     line.text.push_str(" "); // Add space between segments
                     line.text.push_str(&txt);
                     line.words.push(word.clone());
                     line.min_x = line.min_x.min(norm_x);
                     line.max_x = line.max_x.max(norm_x + norm_w);
                     line.min_y = line.min_y.min(norm_y);
                     line.max_y = line.max_y.max(norm_y + norm_h);
                     found = true;
                     break;
                 }
             }
             
             if !found {
                 sections.push(WorkingLine {
                     y: norm_y,
                     // height: norm_h,
                     text: txt,
                     words: vec![word],
                     min_x: norm_x,
                     max_x: norm_x + norm_w,
                     min_y: norm_y,
                     max_y: norm_y + norm_h,
                 });
             }
        }
        
        // Convert sections to Final Lines
        for sec in sections {
             let line_quad = [
                 [sec.min_x, sec.min_y],
                 [sec.max_x, sec.min_y],
                 [sec.max_x, sec.max_y],
                 [sec.min_x, sec.max_y]
             ];
             
             final_words.extend(sec.words.clone());
             final_lines.push(OcrLineResult {
                 text: sec.text,
                 box_quad: line_quad,
                 words: sec.words,
             });
        }

        // --- 2. Image OCR (Preserved) ---
        let objects = page.objects();
        for object in objects.iter() {
            if let Some(image_obj) = object.as_image_object() {
                // Attempt to get the underlying bitmap
                // Note: get_raw_bitmap() returns the raw image data wrapper
                if let Ok(bitmap) = image_obj.get_raw_bitmap() {
                     // Convert to DynamicImage
                     let dyn_img = bitmap.as_image(); 
                     
                     // Get Transformation Matrix (Object Space -> Page Space [Points])
                     let matrix = object.matrix().map_err(|e| format!("Matrix err: {e}"))?;

                     // Run OCR
                     if let Ok(results) = run_ocr_on_image(&engine, dyn_img.clone(), None) {
                         let img_w = dyn_img.width() as f32;
                         let img_h = dyn_img.height() as f32;

                         for (line_text, line_bb, mut l_words) in results {
                             // Transform Line
                             // OCR Box (Pixels) -> Normalized (0..1) -> Unit Square (Flip Y) -> Page Points (Matrix) -> Page Norm (0..1)
                             let line_quad = transform_ocr_box(&line_bb, img_w, img_h, &matrix, page_width_pts, page_height_pts);
                             
                             let mapped_words: Vec<OcrWordResult> = l_words.drain(..).map(|(w_text, w_conf, w_bb)| {
                                 let w_quad = transform_ocr_box(&w_bb, img_w, img_h, &matrix, page_width_pts, page_height_pts);
                                 OcrWordResult {
                                     text: w_text,
                                     confidence: w_conf,
                                     box_quad: w_quad,
                                     rect: quad_to_rect(&w_quad),
                                 }
                             }).collect();

                             final_words.extend(mapped_words.clone());
                             final_lines.push(OcrLineResult {
                                 text: line_text,
                                 box_quad: line_quad,
                                 words: mapped_words,
                             });
                         }
                     }
                }
            }
        }
    }

    Ok(NativeOcrPageResult {
        page_index,
        image_width: report_w,
        image_height: report_h,
        dpi,
        lines: final_lines,
        words: final_words,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Runs generic OCR on a DynamicImage and returns raw OneOCR lines/words.
fn run_ocr_on_image(
    engine: &OcrEngine,
    image: DynamicImage,
    _context: Option<&str>
) -> Result<Vec<(String, BoundingBox, Vec<(String, f32, BoundingBox)>)>, String> {
    let result = engine.run(ImageInput::Dynamic(image))
        .map_err(|e| format!("OCR run failed: {e}"))?;
    
    let mut lines_data = Vec::new();
    
    // Iterate by reference to avoid moving out of Drop type
    for line in &result.lines {
        let words = line.words.as_ref().map(|ws| {
            ws.iter().map(|w| {
                (w.text.clone(), w.confidence, w.bounding_box.clone())
            }).collect()
        }).unwrap_or_default();
        
        lines_data.push((line.text.clone(), line.bounding_box.clone(), words));
    }
    
    Ok(lines_data)
}

/// Normalizes a bounding box from image pixels to 0..1 (Simple scaling).
/// For use when the image IS the page.
fn normalize_plain_quad(bb: &BoundingBox, img_w: u32, img_h: u32) -> [[f32; 2]; 4] {
    let fw = img_w as f32;
    let fh = img_h as f32;
    [
        [bb.top_left.x / fw, bb.top_left.y / fh],
        [bb.top_right.x / fw, bb.top_right.y / fh],
        [bb.bottom_right.x / fw, bb.bottom_right.y / fh],
        [bb.bottom_left.x / fw, bb.bottom_left.y / fh],
    ]
}

/// Transforms an OCR bounding box (local image pixels) to Global Page Normalized Coords (0..1).
fn transform_ocr_box(
    bb: &BoundingBox, 
    img_w: f32, 
    img_h: f32, 
    matrix: &PdfMatrix, 
    page_w: f32, 
    page_h: f32
) -> [[f32; 2]; 4] {
    let points = [bb.top_left, bb.top_right, bb.bottom_right, bb.bottom_left];
    
    let mut out_quad = [[0.0; 2]; 4];

    for (i, p) in points.iter().enumerate() {
        // 1. Normalized Image Coords (0..1, Top-Down)
        let u = p.x / img_w;
        let v = p.y / img_h;
        
        // 2. Unit Square Coords (0..1, Bottom-Up)
        let unit_x = u;
        let unit_y = 1.0 - v; 

        // 3. Apply Matrix -> Page Points (Bottom-Up)
        let page_pt_x = matrix.a() * unit_x + matrix.c() * unit_y + matrix.e();
        let page_pt_y = matrix.b() * unit_x + matrix.d() * unit_y + matrix.f();
        
        // 4. Normalize to Frontend (0..1, Top-Down)
        let norm_x = page_pt_x / page_w;
        let norm_y = 1.0 - (page_pt_y / page_h); // PDF Y (up) to Screen Y (down)
        
        out_quad[i] = [norm_x, norm_y];
    }
    
    out_quad
}

fn quad_to_rect(quad: &[[f32; 2]; 4]) -> [f32; 4] {
    let min_x = quad.iter().map(|p| p[0]).fold(f32::INFINITY, f32::min);
    let min_y = quad.iter().map(|p| p[1]).fold(f32::INFINITY, f32::min);
    let max_x = quad.iter().map(|p| p[0]).fold(f32::NEG_INFINITY, f32::max);
    let max_y = quad.iter().map(|p| p[1]).fold(f32::NEG_INFINITY, f32::max);
    [min_x, min_y, max_x - min_x, max_y - min_y]
}
