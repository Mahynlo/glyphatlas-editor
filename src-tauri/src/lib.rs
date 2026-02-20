// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

// Shared serializable types (always compiled — referenced by both platforms)
mod ocr_types;

// Native Windows OCR — only compiled on Windows
#[cfg(target_os = "windows")]
mod ocr_native;

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
fn perform_native_ocr(
    pdf_path: String,
    page_index: u32,
    dpi: Option<u32>,
) -> Result<ocr_types::NativeOcrPageResult, String> {
    ocr_native::ocr_pdf_page(&pdf_path, page_index, dpi.unwrap_or(200))
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

    // Register the native OCR command only on Windows
    #[cfg(target_os = "windows")]
    let builder = builder.invoke_handler(
        tauri::generate_handler![greet, read_file_bytes, perform_native_ocr]
    );

    #[cfg(not(target_os = "windows"))]
    let builder = builder.invoke_handler(
        tauri::generate_handler![greet, read_file_bytes]
    );

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
