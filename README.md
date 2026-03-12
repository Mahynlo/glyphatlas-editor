# GlyphAtlas Editor — AI PDF Editor

**GlyphAtlas Editor** es un editor de PDF avanzado diseñado para la privacidad y la potencia local. Utiliza un motor de **PaddleOCR (MNN)** integrado directamente en el backend de **Rust (Tauri)** para proporcionar un reconocimiento óptico de caracteres (OCR) de alta precisión sin que tus datos salgan nunca de tu computadora.

## ✨ Características Principales
- **OCR de Alta Fidelidad**: Integración con PaddleOCR v5 (MNN) para una precisión del 97%+.
- **Privacidad Total**: Procesamiento 100% local. Sin nube, sin suscripciones, sin envío de datos.
- **Detección Dinámica**: Visualiza las cajas de texto reconocidas en tiempo real.
- **Censura de Datos (Redaction)**: Busca y oculta información sensible de forma permanente.
- **Búsqueda Avanzada**: Indexación de texto en PDFs escaneados (imágenes).
- **Modos de Precisión**: Selección entre procesamiento estándar (400 DPI) y alta precisión (800 DPI).

## 🛠️ Stack Tecnológico
- **Core**: [Rust](https://www.rust-lang.org/) + [Tauri v2](https://tauri.app/).
- **OCR Engine**: [ocr-rs](https://github.com/n67/ocr-rs) (PaddleOCR en C++ MNN).
- **Frontend**: React 18, TypeScript, Vite.
- **Renderizado PDF**: [Pdfium](https://pdfium.googlesource.com/pdfium/) (vía `pdfium-render` en Rust) y `pdfjs-dist` en el cliente.
- **CI/CD**: GitHub Actions con compilación nativa en Windows y soporte para LLVM/Clang.

## 🚀 Instalación y Desarrollo

### Requerimientos Previos
Para compilar el proyecto desde el código fuente necesitas:
- **Node.js**: v20+
- **Rust**: v1.75+ (Stable)
- **LLVM/Clang**: Necesario para compilar el backend de MNN (`bindgen`).
  - En Windows: `choco install llvm` o descarga desde el sitio oficial de LLVM.
  - Asegúrate de tener la variable de entorno `LIBCLANG_PATH` apuntando a `C:\Program Files\LLVM\bin`.

### Pasos de Configuración

1. **Clonar el Repositorio**
   ```bash
   git clone https://github.com/Mahynlo/glyphatlas-editor.git
   cd glyphatlas-editor
   ```

2. **Instalar Dependencias**
   ```bash
   npm install
   ```

3. **Verificar Modelos**
   Asegúrate de que los archivos `.mnn` estén en `public/models/paddle/`:
   - `PP-OCRv5_mobile_det.mnn`
   - `latin_PP-OCRv5_mobile_rec_infer.mnn`
   - `ppocr_keys_latin.txt`

4. **Ejecutar en Desarrollo**
   ```bash
   npm run tauri dev
   ```

5. **Compilar Instalador (Release)**
   ```bash
   npm run tauri build
   ```

## 📂 Estructura del Proyecto
- `src-tauri/`: Backend en Rust, comandos de OCR y gestión de archivos.
- `src/`: Frontend en React, visor de PDF y lógica de interfaz.
- `src/ocr-engine/`: Puentes de comunicación entre el worker de JS y el backend de Rust.
- `public/models/`: Modelos de IA pre-entrenados para PaddleOCR.

## ⚖️ Licencia
Este proyecto utiliza componentes bajo licencia **Apache 2.0** (PaddleOCR/MNN) y **MIT**. Es totalmente compatible con uso comercial y privado siguiendo los términos de dichas licencias.

---
*Desarrollado con ❤️ para la privacidad de tus documentos.*
