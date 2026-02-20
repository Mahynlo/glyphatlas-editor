// =============================================================================
// OCR TYPES — Shared serializable types for Rust ↔ JS (Tauri IPC)
// =============================================================================
// These types are Windows-only at runtime but the structs themselves are always
// compiled so that the Tauri command signatures can reference them on all
// platforms if needed.

use serde::{Deserialize, Serialize};

/// A single recognized word with normalized coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrWordResult {
    pub text: String,
    pub confidence: f32,

    /// Quad normalized to [0..1]:
    /// [[top_left_x, top_left_y], [top_right_x, top_right_y],
    ///  [bottom_right_x, bottom_right_y], [bottom_left_x, bottom_left_y]]
    /// Same layout as PaddleOCR's `box` field in the JS worker.
    pub box_quad: [[f32; 2]; 4],

    /// Axis-aligned bounding rect normalized to [0..1]: [x, y, width, height]
    /// Same layout as PaddleOCR's `rect` field in the JS worker.
    pub rect: [f32; 4],
}

/// A recognized line containing zero or more words.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrLineResult {
    pub text: String,
    pub box_quad: [[f32; 2]; 4],
    pub words: Vec<OcrWordResult>,
}

/// Full OCR result for a single PDF page.
/// `words` is a flat list of all words across all lines, mirroring the
/// structure expected by the existing frontend consumer.
#[derive(Debug, Serialize, Deserialize)]
pub struct NativeOcrPageResult {
    pub page_index: u32,
    pub image_width: u32,
    pub image_height: u32,
    pub dpi: u32,

    /// Structured result (lines → words) for advanced consumers.
    pub lines: Vec<OcrLineResult>,

    /// Flat word list — same shape as what `ocr.worker.js` returns for
    /// PaddleOCR so the frontend mapping code is identical.
    pub words: Vec<OcrWordResult>,
}
