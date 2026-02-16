
/**
 * Utility class for managing coordinate conversions between different spaces:
 * 1. Normalized Space (0.0 to 1.0) - Used by OCR Worker
 * 2. Viewport Space (Pixels) - Used by Viewer/Canvas
 * 3. CSS Percentage Space (%) - Used by Text Layout
 * 4. PDF Point Space - Used by native PDF
 */
export class CoordinateConverter {
    /**
     * Converts normalized coordinates [x, y, w, h] (0..1) to Viewport Pixels
     */
    static relativeToViewport(
        box: number[],
        containerWidth: number,
        containerHeight: number
    ) {
        const [x, y, w, h] = box;
        return {
            left: x * containerWidth,
            top: y * containerHeight,
            width: w * containerWidth,
            height: h * containerHeight
        };
    }

    /**
     * Converts normalized coordinates to CSS percentages
     */
    static relativeToCssPercentage(box: number[]) {
        const [x, y, w, h] = box;
        return {
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            width: `${w * 100}%`,
            height: `${h * 100}%`
        };
    }

    /**
     * Helper to scale generic points
     */
    static pointsToPixels(rect: number[], scale: number) {
        return rect.map((val: number) => val * scale);
    }
}
