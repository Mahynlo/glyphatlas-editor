# Tauri AI PDF Editor

Editor de PDF avanzado con capacidades de OCR (Reconocimiento Óptico de Caracteres) ejecutándose 100% en el navegador (Local Privacy First).

## Finalidad del Proyecto
Proporcionar una herramienta robusta para visualizar, buscar y censurar (redactar) información sensible en documentos PDF escaneados o nativos, sin enviar datos a servidores externos.

## Stack Tecnológico
- **Frontend**: React 18, TypeScript, Vite.
- **Renderizado PDF**: `pdfjs-dist`.
- **IA / OCR**: 
  - `onnxruntime-web` (Inferencia de Modelos).
  - `opencv.js` (Procesamiento de Imágenes).
  - Modelos PaddleOCR v4 (Detección y Reconocimiento).
- **Arquitectura**: Web Workers para procesamiento en segundo plano.

## Requerimientos Previos
- **Node.js**: v18 o superior.
- **NPM**: v9 o superior.
- **Navegador Moderno**: Chrome, Edge, o Firefox (Soporte para WebAssembly/WebGPU recomendado).

## Instalación y Configuración

Sigue estos pasos detallados para configurar el entorno de desarrollo:

1.  **Clonar el Repositorio**
    ```bash
    git clone <url-del-repo>
    cd pdf_editor
    ```

2.  **Instalar Dependencias**
    ```bash
    npm install
    ```
    *Nota: Esto instalará automáticamente `onnxruntime-web`, `pdfjs-dist`, y las dependencias de React.*

3.  **Configurar Modelos ONNX**
    Asegúrate de que los archivos del modelo estén en la carpeta `public/`:
    - `public/ch_PP-OCRv4_det_infer.onnx`
    - `public/ch_PP-OCRv4_rec_infer.onnx`
    - `public/ppocr_keys_v1.txt` (Diccionario de caracteres)
    
    *Si no están presentes, descárgalos de las releases oficiales de PaddleOCR y conviértelos, o solicita los archivos optimizados.*

4.  **Ejecutar en Desarrollo**
    ```bash
    npm run dev
    ```
    La aplicación estará disponible en `http://localhost:1420`.

## Uso Básico
1. **Abrir PDF**: Arrastra un archivo o usa el botón "Open PDF".
2. **OCR**: Haz clic en el botón flotante (rayo) para iniciar el reconocimiento.
3. **Resultados**: Abre el panel lateral para ver el texto extraído.
4. **Censura**:
   - Busca un término en el panel lateral.
   - Haz clic en "Redact" para censurar todas las ocurrencias.
   - Haz clic en una caja negra para eliminar la censura.
5. **Configuración**:
   - Usa el toggle "High Accuracy" para documentos con letra pequeña (más lento).
   - Usa "Show Overlay" para ver/ocultar las cajas de detección.

## Documentación Técnica
Para más detalles sobre la implementación interna, consulta la carpeta `docs/`:
- [Arquitectura General](docs/general_architecture.md)
- [Procesamiento de Imágenes](docs/image_processing.md)
- [Modelos de IA](docs/models.md)
