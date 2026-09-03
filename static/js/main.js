let totalCount = 0;
let samples = [];
let classes = [];
let currentIndex = 0;
let currentBoxes = [];
let loadedImage = new Image();

const imageMemoryCache = new Map();

let selectedClassForDrawing = null;
let selectedBox = null;
let hoveredBox = null;

let isDrawing = false;
let isDraggingBox = false;
let dragOffset = { x: 0, y: 0 };
let drawStart = { x: 0, y: 0 };
let activeHandle = null;
const HANDLE_SIZE = 8;

const DEFAULT_PALETTE = {
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

const customColors = JSON.parse(localStorage.getItem('custom_class_colors') || '{}');

const container = document.getElementById('canvasContainer');
const canvas = document.getElementById('viewport');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('actionTooltip');
const tooltipLabel = document.getElementById('tooltipClassName');
const tooltipConf = document.getElementById('tooltipConf');
const classListEl = document.getElementById('classList');
const btnCursorMode = document.getElementById('btnCursorMode');

const totalPhotosCount = document.getElementById('totalPhotosCount');
const inputRangeStart = document.getElementById('inputRangeStart');
const inputRangeEnd = document.getElementById('inputRangeEnd');

const modal = document.getElementById('configModal');
const inputSource = document.getElementById('inputSourceDir');
const inputTarget = document.getElementById('inputTargetDir');

// Alternância de Tema Claro / Escuro
const btnThemeToggle = document.getElementById('btnThemeToggle');
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

btnThemeToggle.onclick = () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
};

function rgbToHex([r, g, b]) {
    return "#" + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    }).join('');
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ] : [148, 163, 184];
}

function getClassColor(classId) {
    if (customColors[classId]) return customColors[classId];
    return DEFAULT_PALETTE[classId] || [148, 163, 184];
}

async function init() {
    initTheme();
    const resCls = await fetch('/api/classes');
    classes = await resCls.json();
    renderClassesList();

    const resCfg = await fetch('/api/config');
    const cfg = await resCfg.json();
    inputSource.value = cfg.source_dir;
    inputTarget.value = cfg.target_dir;

    await fetchTotalCount();
}

async function fetchTotalCount() {
    const res = await fetch('/api/samples/count');
    const data = await res.json();
    totalCount = data.total || 0;
    totalPhotosCount.innerText = totalCount;

    if (totalCount > 0) {
        if (!inputRangeStart.value) inputRangeStart.value = 1;
        if (!inputRangeEnd.value) inputRangeEnd.value = Math.min(totalCount, 100);
        document.getElementById('counter').innerText = `Aguardando seleção do lote (1 a ${totalCount})`;
    } else {
        document.getElementById('counter').innerText = "Nenhuma foto encontrada no diretório";
    }
}

async function loadBatch() {
    if (totalCount === 0) {
        alert("Não há fotos disponíveis na pasta configurada.");
        return;
    }

    let start = parseInt(inputRangeStart.value);
    let end = parseInt(inputRangeEnd.value);

    if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
        alert("Por favor, preencha um intervalo válido (ex: De 1 até 100).");
        return;
    }

    if (start > totalCount) {
        alert(`O índice inicial (${start}) não pode ser maior que o total de fotos (${totalCount}).`);
        return;
    }

    end = Math.min(end, totalCount);
    inputRangeEnd.value = end;

    document.getElementById('counter').innerText = `Carregando amostras ${start} até ${end}...`;

    const res = await fetch(`/api/samples?start=${start}&end=${end}`);
    samples = await res.json();

    imageMemoryCache.clear();

    if (samples.length === 0) {
        document.getElementById('counter').innerText = "Nenhuma foto carregada para este intervalo.";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('detectionsList').innerHTML = '';
        document.getElementById('detCount').innerText = '0 objetos';
        return;
    }

    loadSample(0);
}

document.getElementById('btnApplyRange').onclick = loadBatch;

// Modal de Pastas
document.getElementById('btnOpenConfig').onclick = () => modal.classList.remove('hidden');
document.getElementById('btnCloseConfig').onclick = () => modal.classList.add('hidden');
document.getElementById('btnCancelConfig').onclick = () => modal.classList.add('hidden');

document.getElementById('btnSaveConfig').onclick = async () => {
    const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source_dir: inputSource.value,
            target_dir: inputTarget.value
        })
    });

    const data = await res.json();
    if (res.ok) {
        modal.classList.add('hidden');
        samples = [];
        imageMemoryCache.clear();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('detectionsList').innerHTML = '';
        document.getElementById('detCount').innerText = '0 objetos';
        await fetchTotalCount();
    } else {
        alert(data.error || "Erro ao salvar diretórios");
    }
};

function renderClassesList() {
    classListEl.innerHTML = '';
    classes.forEach(cls => {
        const colorRgb = getClassColor(cls.id);
        const isSelected = selectedClassForDrawing && selectedClassForDrawing.id === cls.id;
        
        const row = document.createElement('div');
        row.className = `w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-medium transition ${
            isSelected 
            ? 'bg-amber-500/10 border-amber-500 text-amber-600 dark:text-amber-400' 
            : 'bg-neutral-50 dark:bg-neutral-800/60 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-300'
        }`;

        const selectArea = document.createElement('div');
        selectArea.className = "flex-1 flex items-center gap-2 cursor-pointer";
        selectArea.innerHTML = `
            <span id="bullet-${cls.id}" class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: rgb(${colorRgb[0]}, ${colorRgb[1]}, ${colorRgb[2]})"></span>
            <span class="truncate">${cls.name}</span>
        `;
        selectArea.onclick = () => {
            selectedClassForDrawing = cls;
            unselectBox();
            btnCursorMode.className = "w-full py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-between transition bg-neutral-100 dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 text-neutral-500 mb-2";
            renderClassesList();
            canvas.style.cursor = 'crosshair';
        };

        const colorPicker = document.createElement('input');
        colorPicker.type = 'color';
        colorPicker.value = rgbToHex(colorRgb);
        colorPicker.className = 'w-5 h-5 cursor-pointer bg-transparent border-none rounded-full ml-2';
        colorPicker.title = 'Alterar cor desta classe';
        
        // Evita que o seletor feche ou dispare cliques pais
        colorPicker.onclick = (e) => e.stopPropagation();
        colorPicker.onchange = (e) => e.stopPropagation();

        colorPicker.oninput = (e) => {
            e.stopPropagation();
            const newRgb = hexToRgb(e.target.value);
            customColors[cls.id] = newRgb;
            localStorage.setItem('custom_class_colors', JSON.stringify(customColors));
            
            // Atualiza a bolinha indicadora sem reconstruir a árvore DOM
            const bullet = document.getElementById(`bullet-${cls.id}`);
            if (bullet) {
                bullet.style.backgroundColor = `rgb(${newRgb[0]}, ${newRgb[1]}, ${newRgb[2]})`;
            }
            renderCanvas();
            renderSidebar();
        };

        row.appendChild(selectArea);
        row.appendChild(colorPicker);
        classListEl.appendChild(row);
    });
}

btnCursorMode.onclick = () => {
    selectedClassForDrawing = null;
    btnCursorMode.className = "w-full py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-between transition bg-neutral-200 dark:bg-neutral-800 border-neutral-400 dark:border-neutral-600 text-neutral-900 dark:text-white mb-2";
    renderClassesList();
    canvas.style.cursor = 'default';
};

function fetchCachedImage(filename) {
    return new Promise((resolve, reject) => {
        if (imageMemoryCache.has(filename)) {
            resolve(imageMemoryCache.get(filename));
            return;
        }
        const img = new Image();
        img.src = `/api/image/${filename}`;
        img.onload = () => {
            imageMemoryCache.set(filename, img);
            resolve(img);
        };
        img.onerror = reject;
    });
}

function preloadNext(index) {
    if (index + 1 < samples.length) {
        const nextFile = samples[index + 1].image_file;
        if (!imageMemoryCache.has(nextFile)) {
            const preloadImg = new Image();
            preloadImg.src = `/api/image/${nextFile}`;
            preloadImg.onload = () => imageMemoryCache.set(nextFile, preloadImg);
        }
    }
}

async function loadSample(index) {
    if (index < 0 || index >= samples.length) return;
    currentIndex = index;
    unselectBox();
    
    document.getElementById('counter').innerText = `Foto ${currentIndex + 1} de ${samples.length} carregadas (${samples[currentIndex].image_file})`;

    const resBoxes = await fetch(`/api/labels/${samples[currentIndex].label_file}`);
    currentBoxes = await resBoxes.json();

    try {
        loadedImage = await fetchCachedImage(samples[currentIndex].image_file);
        canvas.width = loadedImage.width;
        canvas.height = loadedImage.height;
        renderCanvas();
        renderSidebar();
        preloadNext(currentIndex);
    } catch (err) {
        console.error("Erro ao renderizar imagem:", err);
    }
}

function getBoxCoords(b) {
    const w = b.width * canvas.width;
    const h = b.height * canvas.height;
    const x = (b.x_center * canvas.width) - (w / 2);
    const y = (b.y_center * canvas.height) - (h / 2);
    return { x, y, w, h };
}

function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(loadedImage, 0, 0);

    currentBoxes.forEach(b => {
        if (!b.valid) return;

        const { x, y, w, h } = getBoxCoords(b);
        const isSelected = selectedBox && selectedBox.box_id === b.box_id;
        const isHovered = hoveredBox && hoveredBox.box_id === b.box_id;

        const [r, g, bColor] = getClassColor(b.class_id);

        let fillAlpha = isSelected ? 0.35 : (isHovered ? 0.25 : 0.15);
        ctx.fillStyle = `rgba(${r}, ${g}, ${bColor}, ${fillAlpha})`;
        ctx.fillRect(x, y, w, h);

        ctx.lineWidth = isSelected ? 3 : (isHovered ? 2.5 : 1.5);
        ctx.strokeStyle = isSelected ? '#f59e0b' : `rgb(${r}, ${g}, ${bColor})`;
        ctx.strokeRect(x, y, w, h);

        const boxIndex = currentBoxes.indexOf(b) + 1;
        const labelText = `#${boxIndex}`;
        ctx.font = 'bold 11px sans-serif';
        const badgeWidth = ctx.measureText(labelText).width + 8;
        const badgeHeight = 18;
        const badgeY = Math.max(0, y - badgeHeight);

        ctx.fillStyle = isSelected ? '#f59e0b' : `rgb(${r}, ${g}, ${bColor})`;
        ctx.fillRect(x, badgeY, badgeWidth, badgeHeight);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, x + 4, badgeY + 13);

        if (isSelected) {
            drawHandle(x, y);
            drawHandle(x + w, y);
            drawHandle(x, y + h);
            drawHandle(x + w, y + h);
        }
    });
}

function drawHandle(hx, hy) {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.fillRect(hx - HANDLE_SIZE/2, hy - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(hx - HANDLE_SIZE/2, hy - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE);
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function getHandleUnderMouse(pos, b) {
    const { x, y, w, h } = getBoxCoords(b);
    const handles = {
        tl: { x, y },
        tr: { x: x + w, y },
        bl: { x, y: y + h },
        br: { x: x + w, y: y + h }
    };

    for (const [key, pt] of Object.entries(handles)) {
        if (Math.abs(pos.x - pt.x) <= HANDLE_SIZE && Math.abs(pos.y - pt.y) <= HANDLE_SIZE) {
            return key;
        }
    }
    return null;
}

canvas.addEventListener('mousedown', (e) => {
    const pos = getMousePos(e);

    if (selectedBox) {
        const handle = getHandleUnderMouse(pos, selectedBox);
        if (handle) {
            activeHandle = handle;
            hideTooltip();
            return;
        }
    }

    if (selectedClassForDrawing) {
        isDrawing = true;
        drawStart = pos;
        return;
    }

    const hit = getBoxAt(pos);
    if (hit) {
        selectBox(hit);
        const rect = container.getBoundingClientRect();
        showTooltip(e.clientX - rect.left, e.clientY - rect.top, hit);

        // Configura movimentação da caixa
        isDraggingBox = true;
        const coords = getBoxCoords(hit);
        dragOffset = {
            x: pos.x - coords.x,
            y: pos.y - coords.y
        };
    } else {
        unselectBox();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const pos = getMousePos(e);

    if (activeHandle && selectedBox) {
        resizeBox(selectedBox, activeHandle, pos);
        renderCanvas();
        return;
    }

    if (isDraggingBox && selectedBox) {
        hideTooltip();
        moveBox(selectedBox, pos);
        renderCanvas();
        return;
    }

    if (isDrawing) {
        renderCanvas();
        const curW = pos.x - drawStart.x;
        const curH = pos.y - drawStart.y;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(drawStart.x, drawStart.y, curW, curH);
        ctx.setLineDash([]);
        return;
    }

    if (selectedBox) {
        const handle = getHandleUnderMouse(pos, selectedBox);
        if (handle) {
            canvas.style.cursor = (handle === 'tl' || handle === 'br') ? 'nwse-resize' : 'nesw-resize';
            return;
        }
    }

    if (!selectedClassForDrawing) {
        const hit = getBoxAt(pos);
        if (hit) {
            canvas.style.cursor = selectedBox && selectedBox.box_id === hit.box_id ? 'move' : 'pointer';
        } else {
            canvas.style.cursor = 'default';
        }

        if (!selectedBox && hit !== hoveredBox) {
            hoveredBox = hit;
            renderCanvas();
        }
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (activeHandle) {
        activeHandle = null;
        renderSidebar();
        return;
    }

    if (isDraggingBox) {
        isDraggingBox = false;
        if (selectedBox) {
            const rect = container.getBoundingClientRect();
            const { x, y } = getBoxCoords(selectedBox);
            showTooltip((x / canvas.width) * rect.width, (y / canvas.height) * rect.height, selectedBox);
        }
        renderSidebar();
        return;
    }

    if (isDrawing) {
        isDrawing = false;
        const pos = getMousePos(e);
        const minX = Math.min(drawStart.x, pos.x);
        const maxX = Math.max(drawStart.x, pos.x);
        const minY = Math.min(drawStart.y, pos.y);
        const maxY = Math.max(drawStart.y, pos.y);
        const w = maxX - minX;
        const h = maxY - minY;

        if (w > 10 && h > 10) {
            const newBox = {
                box_id: Date.now(),
                class_id: selectedClassForDrawing.id,
                class_name: selectedClassForDrawing.name,
                x_center: (minX + w / 2) / canvas.width,
                y_center: (minY + h / 2) / canvas.height,
                width: w / canvas.width,
                height: h / canvas.height,
                confidence: 1.0,
                valid: true
            };
            currentBoxes.push(newBox);
            selectBox(newBox);
        }
        renderCanvas();
        renderSidebar();
    }
});

function moveBox(box, pos) {
    const w = box.width * canvas.width;
    const h = box.height * canvas.height;

    let newX = pos.x - dragOffset.x;
    let newY = pos.y - dragOffset.y;

    // Mantém a caixa nos limites da imagem
    newX = Math.max(0, Math.min(canvas.width - w, newX));
    newY = Math.max(0, Math.min(canvas.height - h, newY));

    box.x_center = (newX + w / 2) / canvas.width;
    box.y_center = (newY + h / 2) / canvas.height;
}

function resizeBox(box, handle, pos) {
    let { x, y, w, h } = getBoxCoords(box);
    let x2 = x + w;
    let y2 = y + h;

    if (handle === 'tl') { x = Math.min(pos.x, x2 - 10); y = Math.min(pos.y, y2 - 10); }
    if (handle === 'tr') { x2 = Math.max(pos.x, x + 10); y = Math.min(pos.y, y2 - 10); }
    if (handle === 'bl') { x = Math.min(pos.x, x2 - 10); y2 = Math.max(pos.y, y + 10); }
    if (handle === 'br') { x2 = Math.max(pos.x, x + 10); y2 = Math.max(pos.y, y + 10); }

    const newW = x2 - x;
    const newH = y2 - y;

    box.x_center = (x + newW / 2) / canvas.width;
    box.y_center = (y + newH / 2) / canvas.height;
    box.width = newW / canvas.width;
    box.height = newH / canvas.height;
}

function getBoxAt(pos) {
    for (let i = currentBoxes.length - 1; i >= 0; i--) {
        const b = currentBoxes[i];
        if (!b.valid) continue;
        const { x, y, w, h } = getBoxCoords(b);
        if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h) {
            return b;
        }
    }
    return null;
}

function selectBox(box) {
    selectedBox = box;
    hoveredBox = null;
    renderCanvas();
    renderSidebar();
}

function unselectBox() {
    selectedBox = null;
    hoveredBox = null;
    isDraggingBox = false;
    hideTooltip();
    renderCanvas();
    renderSidebar();
}

function showTooltip(x, y, box) {
    tooltipLabel.innerText = box.class_name.toUpperCase();
    if (box.confidence !== null && box.confidence !== undefined) {
        tooltipConf.innerText = `${Math.round(box.confidence * 100)}% conf`;
        tooltipConf.classList.remove('hidden');
    } else {
        tooltipConf.classList.add('hidden');
    }
    tooltip.style.left = `${x + 10}px`;
    tooltip.style.top = `${y + 10}px`;
    tooltip.style.display = 'flex';
}

function hideTooltip() {
    tooltip.style.display = 'none';
}

document.getElementById('btnCorreto').onclick = (e) => {
    e.stopPropagation();
    unselectBox();
};

document.getElementById('btnIncorreto').onclick = (e) => {
    e.stopPropagation();
    if (selectedBox) {
        const target = currentBoxes.find(b => b.box_id === selectedBox.box_id);
        if (target) target.valid = false;
    }
    unselectBox();
};

function renderSidebar() {
    const list = document.getElementById('detectionsList');
    list.innerHTML = '';
    const activeBoxes = currentBoxes.filter(b => b.valid);
    document.getElementById('detCount').innerText = `${activeBoxes.length} objetos`;

    currentBoxes.forEach((b, idx) => {
        const item = document.createElement('div');
        const isSelected = selectedBox && selectedBox.box_id === b.box_id;
        const [r, g, bColor] = getClassColor(b.class_id);

        const confBadge = (b.confidence !== null && b.confidence !== undefined)
            ? `<span class="text-[10px] bg-neutral-200 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 rounded text-neutral-800 dark:text-neutral-200 font-mono font-bold">${Math.round(b.confidence * 100)}%</span>`
            : '';

        item.className = `p-2.5 rounded-lg border text-xs transition cursor-pointer flex justify-between items-center ${
            !b.valid 
            ? 'bg-neutral-100 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-400 line-through' 
            : isSelected 
            ? 'bg-amber-500/10 border-amber-500 text-amber-600 dark:text-amber-300' 
            : 'bg-neutral-50 dark:bg-neutral-800/60 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
        }`;

        item.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full" style="background-color: rgb(${r}, ${g}, ${bColor})"></span>
                <span class="font-mono text-neutral-400 font-bold">#${idx + 1}</span>
                <span class="font-semibold">${b.class_name}</span>
            </div>
            <div class="flex items-center gap-2">
                ${confBadge}
                <span class="text-[10px] ${b.valid ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500'}">
                    ${b.valid ? '✓ Válido' : '✕ Removido'}
                </span>
            </div>
        `;

        item.onclick = () => {
            if (!b.valid) return;
            selectBox(b);
            const rect = container.getBoundingClientRect();
            const { x, y } = getBoxCoords(b);
            showTooltip((x / canvas.width) * rect.width, (y / canvas.height) * rect.height, b);
        };

        list.appendChild(item);
    });
}

document.getElementById('btnSalvarAvancar').onclick = async () => {
    if (samples.length === 0) return;
    const sample = samples[currentIndex];

    await fetch('/api/save-and-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: sample.id,
            image_file: sample.image_file,
            label_file: sample.label_file,
            boxes: currentBoxes
        })
    });

    imageMemoryCache.delete(sample.image_file);

    samples.splice(currentIndex, 1);
    totalCount = Math.max(0, totalCount - 1);
    totalPhotosCount.innerText = totalCount;

    if (samples.length === 0) {
        document.getElementById('counter').innerText = "Lote concluído! Selecione um novo intervalo acima.";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('detectionsList').innerHTML = '';
        document.getElementById('detCount').innerText = '0 objetos';
    } else {
        loadSample(Math.min(currentIndex, samples.length - 1));
    }
};

document.getElementById('btnPrev').onclick = () => { if (currentIndex > 0) loadSample(currentIndex - 1); };
document.getElementById('btnNext').onclick = () => { if (currentIndex < samples.length - 1) loadSample(currentIndex + 1); };

document.getElementById('btnDescartarAmostra').onclick = async () => {
    if (confirm("Deseja apagar definitivamente esta imagem e labels da pasta de origem?")) {
        const sample = samples[currentIndex];
        await fetch(`/api/sample/${sample.id}`, { method: 'DELETE' });

        imageMemoryCache.delete(sample.image_file);

        samples.splice(currentIndex, 1);
        totalCount = Math.max(0, totalCount - 1);
        totalPhotosCount.innerText = totalCount;

        if (samples.length === 0) {
            document.getElementById('counter').innerText = "Lote concluído! Selecione um novo intervalo acima.";
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            document.getElementById('detectionsList').innerHTML = '';
            document.getElementById('detCount').innerText = '0 objetos';
        } else {
            loadSample(Math.min(currentIndex, samples.length - 1));
        }
    }
};

init();