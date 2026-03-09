// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

// Shared serializable types (always compiled — referenced by both platforms)
mod ocr_types;

// Native Windows OCR — only compiled on Windows
#[cfg(target_os = "windows")]
mod ocr_native;

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
// Native OCR command (Windows only)
// ---------------------------------------------------------------------------

/// Run Windows-native OCR (via oneocr-rs) on a single page of a PDF.
///
/// # Arguments
/// * `pdf_path`   — Absolute path to the PDF file on disk.
///                  Using a path avoids serializing the entire PDF over the
///                  Tauri IPC bridge.
/// * `page_index` — Zero-based page number.
/// * `dpi`        — Render DPI (200 = performance, 300 = high accuracy).
#[cfg(target_os = "windows")]
#[tauri::command]
async fn perform_native_ocr(
    pdf_path: String,
    page_index: u32,
    dpi: Option<u32>,
) -> Result<ocr_types::NativeOcrPageResult, String> {
    // Run the CPU-heavy PDF render + OCR on a Tokio blocking thread so the
    // WebView / UI thread stays responsive and doesn't show "not responding".
    tauri::async_runtime::spawn_blocking(move || -> Result<ocr_types::NativeOcrPageResult, String> {
        ocr_native::ocr_pdf_page(&pdf_path, page_index, dpi.unwrap_or(200))
    })
    .await
    .map_err(|e| format!("OCR thread panicked: {e}"))?
}

// ---------------------------------------------------------------------------
// PDF Export command (Windows only)
// ---------------------------------------------------------------------------

/// Export a PDF with burned-in redactions and an invisible searchable text layer.
///
/// # Arguments
/// * `source_path` — Absolute path to the original PDF.
/// * `output_path` — Absolute path for the exported PDF.
/// * `redactions`  — Map of page_index → list of [x, y, w, h] arrays (0..1 normalized).
/// * `ocr_data`    — Map of page_index → NativeOcrPageResult with OCR word data.
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
        tauri::generate_handler![greet, read_file_bytes, write_temp_pdf, perform_native_ocr, save_pdf_with_ocr]
    );

    #[cfg(not(target_os = "windows"))]
    let builder = builder.invoke_handler(
        tauri::generate_handler![greet, read_file_bytes, write_temp_pdf]
    );

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
