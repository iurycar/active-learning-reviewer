export const state = {
    totalCount: 0,
    samples: [],
    classes: [],
    currentIndex: 0,
    currentBoxes: [],
    loadedImage: new Image(),
    
    // Zoom e Pan
    panX: 0,
    panY: 0,
    currentZoom: 1.0,
    minZoom: 0.1,
    maxZoom: 5.0,
    
    // Interações
    selectedClassForDrawing: null,
    selectedBox: null,
    hoveredBox: null,
    isDrawing: false,
    isDraggingBox: false,
    isPanMode: false,
    isPanning: false,
    dragOffset: { x: 0, y: 0 },
    drawStart: { x: 0, y: 0 },
    currentMouseImgPos: { x: 0, y: 0 },
    panStart: { x: 0, y: 0 },
    activeHandle: null,
    
    // Split
    manualSelectedSplit: 'train'
};

export const HANDLE_SIZE = 8;

export const DEFAULT_PALETTE = {
    0: [34, 197, 94],
    1: [239, 68, 68],
    2: [59, 130, 246],
    3: [249, 115, 22],
    4: [6, 182, 212],
    5: [234, 179, 8],
    6: [217, 70, 239],
    7: [16, 185, 129],
    8: [244, 63, 94],
    9: [168, 85, 247]
};

export const customColors = JSON.parse(localStorage.getItem('custom_class_colors') || '{}');

export function getClassColor(classId) {
    if (customColors[classId]) return customColors[classId];
    return DEFAULT_PALETTE[classId] || [148, 163, 184];
}