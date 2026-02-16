// =============================================================================
// TEXT GROUPING FUNCTIONS
// =============================================================================
// Algoritmos para agrupar elementos de texto en párrafos basados en proximidad espacial

import { DEFAULT_CONFIG } from './config.js';

/**
 * Calcula la distancia entre dos cajas de texto
 */
export function calculateDistance(box1, box2) {
    const center1 = {
        x: box1.left + box1.width / 2,
        y: box1.top + box1.height / 2
    };
    const center2 = {
        x: box2.left + box2.width / 2,
        y: box2.top + box2.height / 2
    };
    
    return {
        horizontal: Math.abs(center1.x - center2.x),
        vertical: Math.abs(center1.y - center2.y),
        euclidean: Math.sqrt(Math.pow(center1.x - center2.x, 2) + Math.pow(center1.y - center2.y, 2))
    };
}

/**
 * Determina si dos cajas se superponen verticalmente
 */
function boxesOverlapVertically(box1, box2) {
    const top1 = box1.top;
    const bottom1 = box1.top + box1.height;
    const top2 = box2.top;
    const bottom2 = box2.top + box2.height;
    
    const overlapTop = Math.max(top1, top2);
    const overlapBottom = Math.min(bottom1, bottom2);
    const overlap = Math.max(0, overlapBottom - overlapTop);
    
    const minHeight = Math.min(box1.height, box2.height);
    return overlap / minHeight;
}

/**
 * Verifica si dos cajas están en la misma línea de texto
 */
function areOnSameLine(box1, box2, config) {
    const overlapRatio = boxesOverlapVertically(box1, box2);
    const verticalOffset = Math.abs((box1.top + box1.height / 2) - (box2.top + box2.height / 2));
    const avgHeight = (box1.height + box2.height) / 2;
    
    return overlapRatio >= config.MIN_OVERLAP_RATIO || 
           verticalOffset < avgHeight * config.MAX_VERTICAL_OFFSET_RATIO;
}

/**
 * Determina si dos cajas de texto deberían agruparse
 */
function shouldGroup(box1, box2, avgHeight, config) {
    const distance = calculateDistance(box1, box2);
    
    if (areOnSameLine(box1, box2, config)) {
        const maxHorizontalGap = avgHeight * config.HORIZONTAL_THRESHOLD_RATIO;
        const isRightOf = box2.left > box1.left;
        return isRightOf && distance.horizontal < maxHorizontalGap;
    } else {
        const maxVerticalGap = avgHeight * config.VERTICAL_THRESHOLD_RATIO;
        const horizontalOverlap = Math.min(box1.left + box1.width, box2.left + box2.width) - 
                                 Math.max(box1.left, box2.left);
        const isBelow = box2.top > box1.top;
        const hasHorizontalOverlap = horizontalOverlap > 0;
        return isBelow && distance.vertical < maxVerticalGap && hasHorizontalOverlap;
    }
}

/**
 * Agrupa elementos de texto en párrafos basándose en proximidad espacial
 */
export function groupTextElements(elements, config = DEFAULT_CONFIG.GROUPING) {
    if (elements.length === 0) return [];
    
    const avgHeight = elements.reduce((sum, el) => sum + el.frame.height, 0) / elements.length;
    
    const sorted = [...elements].sort((a, b) => {
        const verticalDiff = a.frame.top - b.frame.top;
        if (Math.abs(verticalDiff) < avgHeight * 0.5) {
            return a.frame.left - b.frame.left;
        }
        return verticalDiff;
    });
    
    const groups = [];
    const used = new Set();
    
    for (let i = 0; i < sorted.length; i++) {
        if (used.has(i)) continue;
        
        const group = [i];
        used.add(i);
        
        let changed = true;
        while (changed) {
            changed = false;
            
            for (let j = 0; j < sorted.length; j++) {
                if (used.has(j)) continue;
                
                for (const groupIdx of group) {
                    if (shouldGroup(sorted[groupIdx].frame, sorted[j].frame, avgHeight, config)) {
                        group.push(j);
                        used.add(j);
                        changed = true;
                        break;
                    }
                }
                
                if (changed) break;
            }
        }
        
        group.sort((a, b) => {
            const elemA = sorted[a].frame;
            const elemB = sorted[b].frame;
            const verticalDiff = elemA.top - elemB.top;
            
            if (Math.abs(verticalDiff) < avgHeight * 0.5) {
                return elemA.left - elemB.left;
            }
            return verticalDiff;
        });
        
        groups.push(group.map(idx => sorted[idx]));
    }
    
    return groups;
}

/**
 * Crea un párrafo a partir de un grupo de elementos de texto
 */
export function createParagraph(group) {
    const texts = group.map(el => el.text);
    const avgConfidence = group.reduce((sum, el) => sum + el.confidence, 0) / group.length;
    
    const allX = group.flatMap(el => [el.frame.left, el.frame.left + el.frame.width]);
    const allY = group.flatMap(el => [el.frame.top, el.frame.top + el.frame.height]);
    
    const boundingBox = {
        left: Math.min(...allX),
        top: Math.min(...allY),
        width: Math.max(...allX) - Math.min(...allX),
        height: Math.max(...allY) - Math.min(...allY)
    };
    
    return {
        text: texts.join(' '),
        confidence: avgConfidence,
        boundingBox,
        elements: group.map(el => ({
            text: el.text,
            confidence: el.confidence,
            frame: el.frame
        }))
    };
}