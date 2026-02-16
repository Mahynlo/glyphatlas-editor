// =============================================================================
// OPENCV HELPER FUNCTIONS
// =============================================================================
// Funciones auxiliares para procesamiento de imágenes y operaciones geométricas con OpenCV

import cv from '@techstark/opencv-js';
// @ts-ignore - js-climport cv from '@techstark/opencv-js';
import jsClipper from 'js-clipper';
import { ImageRaw } from './node/utils.js';

/**
 * Convierte ImageRaw a Mat de OpenCV
 * @param {any} image - Imagen
 */
export function cvImread(image) {
    const mat = new cv.Mat(image.height, image.width, cv.CV_8UC4);
    mat.data.set(image.data);
    return mat;
}

/**
 * Convierte Mat de OpenCV a ImageRaw
 * @param {any} mat - Matriz OpenCV
 */
export function cvImshow(mat) {
    return new ImageRaw({
        data: Buffer.from(mat.data),
        width: mat.cols,
        height: mat.rows
    });
}

/**
 * Obtiene la caja mínima y el lado más pequeño de un contorno
 * @param {any} contour - Contorno
 */
export function getMiniBoxes(contour) {
    const boundingBox = cv.minAreaRect(contour);
    const points = Array.from(boxPoints(boundingBox)).sort((a, b) => a[0] - b[0]);

    let index_1 = 0, index_4 = 1;
    if (points[1][1] > points[0][1]) {
        index_1 = 0; index_4 = 1;
    } else {
        index_1 = 1; index_4 = 0;
    }

    let index_2 = 2, index_3 = 3;
    if (points[3][1] > points[2][1]) {
        index_2 = 2; index_3 = 3;
    } else {
        index_2 = 3; index_3 = 2;
    }

    const box = [points[index_1], points[index_2], points[index_3], points[index_4]];
    return { points: box, sside: Math.min(boundingBox.size.height, boundingBox.size.width) };
}

/**
 * Obtiene los puntos de esquina de un rectángulo rotado
 * @param {any} rotatedRect - Rectángulo rotado
 */
export function boxPoints(rotatedRect) {
    const points = [];
    const angle = rotatedRect.angle * Math.PI / 180.0;
    const b = Math.cos(angle) * 0.5;
    const a = Math.sin(angle) * 0.5;
    const center = rotatedRect.center;
    const size = rotatedRect.size;

    points[0] = [center.x - a * size.height - b * size.width, center.y + b * size.height - a * size.width];
    points[1] = [center.x + a * size.height - b * size.width, center.y - b * size.height - a * size.width];
    points[2] = [center.x + a * size.height + b * size.width, center.y - b * size.height + a * size.width];
    points[3] = [center.x - a * size.height + b * size.width, center.y + b * size.height + a * size.width];

    return points;
}

/**
 * Calcula el área de un polígono
 * @param {any[]} polygon - Polígono
 */
export function polygonPolygonArea(polygon) {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        area += polygon[i][0] * polygon[j][1] - polygon[j][0] * polygon[i][1];
    }
    return Math.abs(area) / 2.0;
}

/**
 * Calcula el perímetro de un polígono
 * @param {any[]} polygon - Polígono
 */
export function polygonPolygonLength(polygon) {
    let length = 0;
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;
        length += Math.sqrt(Math.pow(polygon[j][0] - polygon[i][0], 2) + Math.pow(polygon[j][1] - polygon[i][1], 2));
    }
    return length;
}

/**
 * Ordena puntos en sentido horario
 * @param {any[]} pts - Puntos
 */
export function orderPointsClockwise(pts) {
    const s = pts.map(pt => pt[0] + pt[1]);
    const rect = [
        pts[s.indexOf(Math.min(...s))],
        null,
        pts[s.indexOf(Math.max(...s))],
        null
    ];

    const tmp = pts.filter(pt => pt !== rect[0] && pt !== rect[2]);
    const diff = [tmp[0][1] - tmp[1][1], tmp[0][0] - tmp[1][0]];
    rect[1] = diff[1] > 0 ? tmp[0] : tmp[1];
    rect[3] = diff[1] > 0 ? tmp[1] : tmp[0];

    return rect;
}

/**
 * Calcula la distancia euclidiana entre dos puntos
 * @param {number[]} p0 - Punto 0
 * @param {number[]} p1 - Punto 1
 */
export function linalgNorm(p0, p1) {
    return Math.sqrt(Math.pow(p0[0] - p1[0], 2) + Math.pow(p0[1] - p1[1], 2));
}

/**
 * Extrae y corrige perspectiva de una región de imagen
 * @param {any} imageRaw - Imagen original
 * @param {number[][]} points - Puntos de la región
 */
export function getRotateCropImage(imageRaw, points) {
    const img_crop_width = Math.floor(Math.max(linalgNorm(points[0], points[1]), linalgNorm(points[2], points[3])));
    const img_crop_height = Math.floor(Math.max(linalgNorm(points[0], points[3]), linalgNorm(points[1], points[2])));

    const pts_std = [[0, 0], [img_crop_width, 0], [img_crop_width, img_crop_height], [0, img_crop_height]];

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, points.flat());
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, pts_std.flat());
    const M = cv.getPerspectiveTransform(srcTri, dstTri);

    const src = cvImread(imageRaw);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(img_crop_width, img_crop_height),
        cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());

    let dst_rot = dst;
    if (dst.rows / dst.cols >= 1.5) {
        dst_rot = new cv.Mat();
        const M_rot = cv.getRotationMatrix2D(new cv.Point(dst.cols / 2, dst.cols / 2), 90, 1);
        cv.warpAffine(dst, dst_rot, M_rot, new cv.Size(dst.rows, dst.cols),
            cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
        dst.delete();
    }

    src.delete();
    srcTri.delete();
    dstTri.delete();

    return cvImshow(dst_rot);
}

/**
 * Expande un polígono (unclip) usando clipper
 * @param {number[][]} box - Caja
 * @param {number} unclip_ratio - Ratio de expansión
 */
export function unclip(box, unclip_ratio = 1.5) {
    const area = Math.abs(polygonPolygonArea(box));
    const length = polygonPolygonLength(box);
    const distance = (area * unclip_ratio) / length;
    const tmpArr = box.map(item => ({ X: item[0], Y: item[1] }));
    const offset = new jsClipper.ClipperOffset();
    offset.AddPath(tmpArr, jsClipper.JoinType.jtRound, jsClipper.EndType.etClosedPolygon);
    /** @type {any[]} */
    const expanded = [];
    offset.Execute(expanded, distance);
    return expanded[0] ? expanded[0].map((/** @type {any} */ item) => [item.X, item.Y]).flat() : [];
}