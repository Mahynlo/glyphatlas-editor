// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::path::PathBuf;
use tauri::Manager;

// Shared serializable types (always compiled — referenced by both platforms)
mod ocr_types;


// PaddleOCR via ocr-rs — cross-platform, open-source alternative
mod ocr_paddle;

// PDF Export — only compiled on Windows (depends on pdfium-render Windows binaries)
#[cfg(target_os = "windows")]
mod export;

// ---------------------------------------------------------------------------
// Existing commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Read a file from the filesystem and return its raw bytes.
/// Used by the frontend to load a PDF into the viewer after the user selects
/// it via the native dialog (dialog gives path; this gives the actual content).
#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read '{}': {}", path, e))
}

/// Write raw PDF bytes to a temp file and return the absolute path.
/// Used by the native OCR engine which requires a file path (not in-memory bytes).
#[tauri::command]
fn write_temp_pdf(bytes: Vec<u8>) -> Result<String, String> {
    use std::io::Write;
    let mut tmp = std::env::temp_dir();
    tmp.push(format!("ocr_tmp_{}.pdf", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)));
    let mut file = std::fs::File::create(&tmp)
        .map_err(|e| format!("Cannot create temp file: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Cannot write temp file: {e}"))?;
    tmp.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Temp path is not valid UTF-8".to_string())
}

// ---------------------------------------------------------------------------

// PaddleOCR command (cross-platform, open-source)
// ---------------------------------------------------------------------------

/// Run PaddleOCR (via ocr-rs / MNN) on a single page of a PDF.
/// Uses PP-OCRv5 models with Latin character set.
/// This is the open-source alternative to perform_native_ocr.
#[tauri::command]
async fn perform_paddle_ocr(
    app: tauri::AppHandle,
    pdf_path: String,
    page_index: u32,
    dpi: Option<u32>,
) -> Result<ocr_types::NativeOcrPageResult, String> {
    let resource_dir: Option<PathBuf> = app.path().resource_dir().ok();

    tauri::async_runtime::spawn_blocking(move || -> Result<ocr_types::NativeOcrPageResult, String> {
        ocr_paddle::ocr_pdf_page_paddle(&pdf_path, page_index, dpi.unwrap_or(200), resource_dir)
    })
    .await
    .map_err(|e| format!("PaddleOCR thread panicked: {e}"))?
}

// ---------------------------------------------------------------------------
// PDF Export commands (Windows only)
// ---------------------------------------------------------------------------

/// Embeds an invisible OCR text layer into a PDF and saves it to disk.
///
/// This is the primary export path after OCR: the PDF bytes come from
/// EmbedPDF's `saveAsCopy()` (written to a temp file via `write_temp_pdf`),
/// and `ocr_data` comes from the OCR results stored in the viewer state.
///
/// The resulting file has text selectable/searchable in any PDF viewer.
#[cfg(target_os = "windows")]
#[tauri::command]
async fn embed_ocr_and_save(
    source_path: String,
    output_path: String,
    ocr_data: std::collections::HashMap<u32, Vec<export::OcrWordSer>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        export::embed_text_and_save(&source_path, &output_path, ocr_data)
    })
    .await
    .map_err(|e| format!("Export thread panicked: {e}"))?
}

/// Retrieves the first command-line argument that is a PDF file path.
/// This allows the app to open files passed by the OS (e.g., from 'Open with...').
#[cfg(target_os = "windows")]
#[tauri::command]
fn get_startup_file() -> Option<String> {
    std::env::args()
        .skip(1) // Skip the executable name
        .find(|arg| arg.to_lowercase().ends_with(".pdf"))
}

/// Checks whether a PDF at `path` already has an extractable text layer.
/// Returns `true` if the first few pages contain non-whitespace text.
/// Used by the frontend to skip auto-OCR on files that are already text-based.
#[cfg(target_os = "windows")]
#[tauri::command]
async fn check_pdf_has_text(path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        export::check_has_text(&path)
    })
    .await
    .map_err(|e| format!("check_pdf_has_text thread panicked: {e}"))?
}

/// Export a PDF with burned-in redactions and an invisible searchable text layer (legacy).
#[cfg(target_os = "windows")]
#[tauri::command]
async fn save_pdf_with_ocr(
    source_path: String,
    output_path: String,
    redactions: std::collections::HashMap<u32, Vec<[f32; 4]>>,
    ocr_data: std::collections::HashMap<u32, ocr_types::NativeOcrPageResult>,
) -> Result<(), String> {
    // Like OCR, PDF export (pdfium-render file I/O + object manipulation) is blocking.
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        export::export_pdf(&source_path, &output_path, redactions, ocr_data)
    })
    .await
    .map_err(|e| format!("Export thread panicked: {e}"))?
}

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // Register the native OCR and export commands only on Windows
    #[cfg(target_os = "windows")]
    let builder = builder.invoke_handler(
        tauri::generate_handler![greet, read_file_bytes, write_temp_pdf,
                                 perform_paddle_ocr,
                                 embed_ocr_and_save, check_pdf_has_text, save_pdf_with_ocr,
                                 get_startup_file]
    );

    #[cfg(not(target_os = "windows"))]
    let builder = builder.invoke_handler(
        tauri::generate_handler![greet, read_file_bytes, write_temp_pdf, perform_paddle_ocr]
    );

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
