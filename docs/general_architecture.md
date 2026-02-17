# Arquitectura General del Proyecto

Este documento describe la arquitectura de alto nivel de la aplicación **Tauri AI PDF Editor**. La aplicación está diseñada para ejecutarse completamente en el navegador (Client-Side) utilizando tecnologías web modernas y WebAssembly para el procesamiento de IA.

## Diagrama de Flujo Principal

```mermaid
graph TD
    User[Usuario] -->|Sube PDF| App[App (React)]
    App -->|Renderiza PDF| PDFViewer[PDF.js Viewer]
    App -->|Inicia OCR| Worker[OCR Worker (Web Worker)]
    
    subgraph "OCR Engine (Worker)"
        Worker -->|Decodifica Página| PdfDist[PDF.js (Dist)]
        Worker -->|Extrae Texto Nativo| Native[Texto Nativo]
        Worker -->|Renderiza Imagen| Canvas[OffscreenCanvas]
        
        Canvas -->|Preprocesamiento| OpenCV[OpenCV.js]
        OpenCV -->|Tensores| ONNX[ONNX Runtime Web]
        
        ONNX -->|Detección| PPOCR_Det[Modelo DBNet (Det)]
        ONNX -->|Reconocimiento| PPOCR_Rec[Modelo SVTR (Rec)]
        
        PPOCR_Det -->|Cajas| Merger[Lógica Híbrida]
        PPOCR_Rec -->|Texto| Merger
        Native -->|Texto| Merger
    end
    
    Merger -->|Resultados JSON| App
    App -->|Overlay| UI[Interfaz de Usuario]
    UI -->|Redacción/Búsqueda| User
```

## Componentes Clave

### 1. Frontend (React + Vite)
- **App.tsx**: Controlador principal. Gestiona el estado del archivo, resultados de OCR y redacciones.
- **PDFViewer**: Encapsula `pdfjs-dist` para renderizar el PDF y superponer capas (Texto, OCR, Redacción).
- **OCRTextLayer**: Componente visual que dibuja las cajas de detección y el texto reconocido sobre el PDF.

### 2. OCR Worker (Web Worker)
- **ocr.worker.js**: Hilo secundario para evitar bloquear la UI durante el procesamiento pesado.
- **Responsabilidades**:
    - Cargar modelos ONNX (solo una vez).
    - Orquestar el flujo: PDF -> Imagen -> Detección -> Reconocimiento.
    - Ejecutar lógica "Híbrida" (ignorar imágenes si hay texto nativo superpuesto).

### 3. OCR Engine (Lógica de Negocio)
- **ocr.js**: Clase principal que coordina los módulos.
- **detection.js**: Maneja el modelo de detección de texto (DBNet). Implementa preprocesamiento (Letterbox, Normalización) y postprocesamiento (Unclip, Box Threshold).
- **recognition.js**: Maneja el modelo de reconocimiento (CRNN/SVTR). Implementa decodificación CTC.
- **utils.js**: Utilidades de imagen compartidas para optimizar memoria (Shared Canvas).

## Flujo de Datos
1. **Input**: Archivo PDF (ArrayBuffer).
2. **Procesamiento**:
    - Se convierte la página a imagen (Canvas).
    - Se verifica si hay texto nativo (para modo Híbrido).
    - La imagen pasa por la red neuronal.
3. **Output**: Objeto JSON con coordenadas normalizadas (0..1), texto y confianza.
4. **Visualización**: Se mapean las coordenadas al tamaño del viewport del usuario.
