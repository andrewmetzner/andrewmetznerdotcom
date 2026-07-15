'use strict';

const valueInput = document.getElementById('value');
const insertButton = document.getElementById('insertButton');
const removeButton = document.getElementById('removeButton');
const canvas = document.getElementById('canvas');
const container = document.getElementById('canvasContainer');
const ctx = canvas.getContext('2d');
const logList = document.getElementById('logList');
const statusEl = document.getElementById('status');
const nodeCountEl = document.getElementById('nodeCount');
const blackHeightEl = document.getElementById('blackHeight');

const redCatImage = new Image(); redCatImage.src = 'redcat.png';
const blackCatImage = new Image(); blackCatImage.src = 'blackcat.png';
redCatImage.onload = scheduleRender;
blackCatImage.onload = scheduleRender;

const TNULL = { name: '', left: null, right: null, parent: null, color: 'BLACK' };
TNULL.left = TNULL; TNULL.right = TNULL;

let root = TNULL;
let nodeCount = 0;

function log(msg) {
    const line = document.createElement('div');
    line.className = 'log-line';
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    line.innerHTML = `<span class="log-time">${time}</span> ${escapeHtml(msg)}`;
    logList.appendChild(line);
    logList.scrollTop = logList.scrollHeight;
    while (logList.children.length > 300) logList.removeChild(logList.firstChild);
}

function escapeHtml(s) {
    return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = 'status' + (kind ? ' status-' + kind : '');
}

function searchTree(node, k) {
    if (node === TNULL || k === node.name) return node;
    return k < node.name ? searchTree(node.left, k) : searchTree(node.right, k);
}

function leftRotateMutate(x) {
    const y = x.right;
    x.right = y.left;
    if (y.left !== TNULL) y.left.parent = x;
    y.parent = x.parent;
    if (x.parent === null) root = y;
    else if (x === x.parent.left) x.parent.left = y;
    else x.parent.right = y;
    y.left = x;
    x.parent = y;
}

function rightRotateMutate(x) {
    const y = x.left;
    x.left = y.right;
    if (y.right !== TNULL) y.right.parent = x;
    y.parent = x.parent;
    if (x.parent === null) root = y;
    else if (x === x.parent.right) x.parent.right = y;
    else x.parent.left = y;
    y.right = x;
    x.parent = y;
}

function* rotateLeftStep(x) {
    const before = layoutRoot();
    leftRotateMutate(x);
    const after = layoutRoot();
    log(`rotate-left(${x.name})`);
    yield { type: 'restructure', before, after };
}

function* rotateRightStep(x) {
    const before = layoutRoot();
    rightRotateMutate(x);
    const after = layoutRoot();
    log(`rotate-right(${x.name})`);
    yield { type: 'restructure', before, after };
}

function* recolorBatch(changes, label) {
    const withFrom = changes.map(c => ({ node: c.node, from: c.node.color, to: c.to }));
    const real = withFrom.filter(c => c.from !== c.to);
    if (real.length === 0) return;
    real.forEach(c => { c.node.color = c.to; });
    if (label) log(label);
    yield { type: 'recolor', changes: real };
}
 
function* insertGen(name) {
    if (searchTree(root, name) !== TNULL) {
        setStatus(`"${name}" is already in the tree.`, 'warn');
        log(`insert(${name}) — rejected, duplicate key`);
        return;
    }

    const node = { name, left: TNULL, right: TNULL, parent: null, color: 'RED' };
    let y = null;
    let x = root;
    while (x !== TNULL) {
        y = x;
        x = name < x.name ? x.left : x.right;
    }
    node.parent = y;
    if (y === null) root = node;
    else if (name < y.name) y.left = node;
    else y.right = node;

    nodeCount++;
    log(`insert(${name}) as RED leaf under ${y ? y.name : '(root)'}`);
    yield { type: 'insert-leaf', node };

    if (node.parent === null) {
        yield* recolorBatch([{ node, to: 'BLACK' }], `${name} is the root — recolored BLACK`);
        setStatus(`Inserted "${name}" as the root.`, 'ok');
        refreshStats();
        return;
    }
    if (node.parent.parent === null) {
        setStatus(`Inserted "${name}". Parent is the root — no fixup needed.`, 'ok');
        refreshStats();
        return;
    }

    yield* fixInsertGen(node);
    setStatus(`Inserted "${name}".`, 'ok');
    refreshStats();
}

function* fixInsertGen(k) {
    while (k.parent.color === 'RED') {
        if (k.parent === k.parent.parent.right) {
            const u = k.parent.parent.left;
            if (u.color === 'RED') {
                yield* recolorBatch(
                    [{ node: u, to: 'BLACK' }, { node: k.parent, to: 'BLACK' }, { node: k.parent.parent, to: 'RED' }],
                    `${k.name}'s parent ${k.parent.name} is RED (rule 4 violated) and uncle ${u.name} is also RED — recolor parent+uncle BLACK, grandparent ${k.parent.parent.name} RED, continue from ${k.parent.parent.name}`);
                k = k.parent.parent;
            } else {
                if (k === k.parent.left) {
                    k = k.parent;
                    yield* rotateRightStep(k);
                }
                yield* recolorBatch(
                    [{ node: k.parent, to: 'BLACK' }, { node: k.parent.parent, to: 'RED' }],
                    `${k.name}'s parent ${k.parent.name} is RED but uncle is BLACK — recolor parent BLACK, grandparent ${k.parent.parent.name} RED, then rotate`);
                yield* rotateLeftStep(k.parent.parent);
            }
        } else {
            const u = k.parent.parent.right;
            if (u.color === 'RED') {
                yield* recolorBatch(
                    [{ node: u, to: 'BLACK' }, { node: k.parent, to: 'BLACK' }, { node: k.parent.parent, to: 'RED' }],
                    `${k.name}'s parent ${k.parent.name} is RED (rule 4 violated) and uncle ${u.name} is also RED — recolor parent+uncle BLACK, grandparent ${k.parent.parent.name} RED, continue from ${k.parent.parent.name}`);
                k = k.parent.parent;
            } else {
                if (k === k.parent.right) {
                    k = k.parent;
                    yield* rotateLeftStep(k);
                }
                yield* recolorBatch(
                    [{ node: k.parent, to: 'BLACK' }, { node: k.parent.parent, to: 'RED' }],
                    `${k.name}'s parent ${k.parent.name} is RED but uncle is BLACK — recolor parent BLACK, grandparent ${k.parent.parent.name} RED, then rotate`);
                yield* rotateRightStep(k.parent.parent);
            }
        }
        if (k === root) break;
    }
    yield* recolorBatch([{ node: root, to: 'BLACK' }], 'root forced BLACK (rule 2)');
}

function transplantMutate(u, v) {
    if (u.parent === null) root = v;
    else if (u === u.parent.left) u.parent.left = v;
    else u.parent.right = v;
    v.parent = u.parent;
}

function minimum(node) {
    while (node.left !== TNULL) node = node.left;
    return node;
}

function* removeGen(name) {
    const z = searchTree(root, name);
    if (z === TNULL) {
        setStatus(`"${name}" was not found.`, 'warn');
        log(`remove(${name}) — not found`);
        return;
    }

    log(`remove(${name})`);
    yield { type: 'remove-node', node: z };

    let y = z;
    let yOriginalColor = y.color;
    let x;
    const before = layoutRoot();

    if (z.left === TNULL) {
        x = z.right;
        transplantMutate(z, z.right);
    } else if (z.right === TNULL) {
        x = z.left;
        transplantMutate(z, z.left);
    } else {
        y = minimum(z.right);
        yOriginalColor = y.color;
        x = y.right;
        if (y.parent === z) {
            x.parent = y;
        } else {
            transplantMutate(y, y.right);
            y.right = z.right;
            y.right.parent = y;
        }
        transplantMutate(z, y);
        y.left = z.left;
        y.left.parent = y;
        y.color = z.color;
    }

    const after = layoutRoot();
    yield { type: 'restructure', before, after };

    nodeCount--;
    if (yOriginalColor === 'BLACK') yield* deleteFixGen(x);

    setStatus(`Removed "${name}".`, 'ok');
    refreshStats();
}

function* deleteFixGen(x) {
    while (x !== root && x.color === 'BLACK') {
        if (x === x.parent.left) {
            let s = x.parent.right;
            if (s.color === 'RED') {
                yield* recolorBatch([{ node: s, to: 'BLACK' }, { node: x.parent, to: 'RED' }],
                    `${x.name || 'the double-black node'}'s sibling ${s.name} is RED — recolor sibling BLACK, parent ${x.parent.name} RED, then rotate`);
                yield* rotateLeftStep(x.parent);
                s = x.parent.right;
            }
            if (s.left.color === 'BLACK' && s.right.color === 'BLACK') {
                yield* recolorBatch([{ node: s, to: 'RED' }],
                    `sibling ${s.name} is BLACK with two BLACK children -- recolor sibling RED, continue from parent ${x.parent.name}`);
                x = x.parent;
            } else {
                if (s.right.color === 'BLACK') {
                    yield* recolorBatch([{ node: s.left, to: 'BLACK' }, { node: s, to: 'RED' }],
                        `sibling ${s.name}'s near child is RED, far child BLACK -- recolor near child BLACK, sibling RED, then rotate`);
                    yield* rotateRightStep(s);
                    s = x.parent.right;
                }
                yield* recolorBatch([{ node: s, to: x.parent.color }, { node: x.parent, to: 'BLACK' }, { node: s.right, to: 'BLACK' }],
                    `sibling ${s.name}'s far child is RED -- recolor sibling to parent ${x.parent.name}'s color, parent BLACK, far child BLACK, then rotate`);
                yield* rotateLeftStep(x.parent);
                x = root;
            }
        } else {
            let s = x.parent.left;
            if (s.color === 'RED') {
                yield* recolorBatch([{ node: s, to: 'BLACK' }, { node: x.parent, to: 'RED' }],
                    `${x.name || 'the double-black node'}'s sibling ${s.name} is RED -- recolor sibling BLACK, parent ${x.parent.name} RED, then rotate`);
                yield* rotateRightStep(x.parent);
                s = x.parent.left;
            }
            if (s.right.color === 'BLACK' && s.left.color === 'BLACK') {
                yield* recolorBatch([{ node: s, to: 'RED' }],
                    `sibling ${s.name} is BLACK with two BLACK children -- recolor sibling RED, continue from parent ${x.parent.name}`);
                x = x.parent;
            } else {
                if (s.left.color === 'BLACK') {
                    yield* recolorBatch([{ node: s.right, to: 'BLACK' }, { node: s, to: 'RED' }],
                        `sibling ${s.name}'s near child is RED, far child BLACK -- recolor near child BLACK, sibling RED, then rotate`);
                    yield* rotateLeftStep(s);
                    s = x.parent.left;
                }
                yield* recolorBatch([{ node: s, to: x.parent.color }, { node: x.parent, to: 'BLACK' }, { node: s.left, to: 'BLACK' }],
                    `sibling ${s.name}'s far child is RED -- recolor sibling to parent ${x.parent.name}'s color, parent BLACK, far child BLACK, then rotate`);
                yield* rotateRightStep(x.parent);
                x = root;
            }
        }
    }
    yield* recolorBatch([{ node: x, to: 'BLACK' }], 'extra black absorbed -- node recolored BLACK to restore rule 5');
}

function blackHeight(node) {
    if (node === TNULL) return 1;
    const l = blackHeight(node.left);
    return l + (node.color === 'BLACK' ? 1 : 0);
}

function refreshStats() {
    nodeCountEl.textContent = String(nodeCount);
    blackHeightEl.textContent = root === TNULL ? '0' : String(blackHeight(root) - 1);
}

const R = 22;

function computeLayout(node, x, y, offset, map) {
    if (node === TNULL) return;
    map.set(node, { x, y });
    if (node.left !== TNULL) computeLayout(node.left, x - offset, y + 120, offset / 1.6, map);
    if (node.right !== TNULL) computeLayout(node.right, x + offset, y + 120, offset / 1.6, map);
}

function layoutRoot() {
    const map = new Map();
    if (root !== TNULL) computeLayout(root, 0, 0, 200, map);
    return map;
}

function lerp(a, b, t) { return a + (b - a) * t; }

function lerpMap(before, after, t) {
    const out = new Map();
    for (const [node, pos] of after) {
        const b = before.get(node) || pos;
        out.set(node, { x: lerp(b.x, pos.x, t), y: lerp(b.y, pos.y, t) });
    }
    return out;
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

let scale = 1, offsetX = 0, offsetY = 0, isPanning = false, panStartX, panStartY, lastPanX, lastPanY;

function scheduleRender() { requestAnimationFrame(() => paintFrame(layoutRoot(), null)); }

function drawCatOrFallback(img, color, cx, cy, r, localAlpha) {
    if (localAlpha <= 0.001) return;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * localAlpha;
    if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    } else {
        ctx.fillStyle = color === 'RED' ? '#c1121f' : '#111827';
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = prevAlpha;
}

function drawNodeAt(node, sx, sy, effect) {
    let scaleF = 1, alpha = 1, recolorChange = null;
    if (effect) {
        if (effect.type === 'insert' && effect.node === node) {
            scaleF = 0.2 + 0.8 * effect.t;
            alpha = effect.t;
        } else if (effect.type === 'remove' && effect.node === node) {
            scaleF = 1 - 0.5 * effect.t;
            alpha = 1 - effect.t;
        } else if (effect.type === 'recolor') {
            recolorChange = effect.changes.find(c => c.node === node) || null;
        }
    }

    const cx = sx, cy = sy + R;
    const r = R * scaleF;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (recolorChange) {
        const fromImg = recolorChange.from === 'RED' ? redCatImage : blackCatImage;
        const toImg = recolorChange.to === 'RED' ? redCatImage : blackCatImage;
        drawCatOrFallback(fromImg, recolorChange.from, cx, cy, r, 1 - effect.t);
        drawCatOrFallback(toImg, recolorChange.to, cx, cy, r, effect.t);
    } else {
        const img = node.color === 'RED' ? redCatImage : blackCatImage;
        drawCatOrFallback(img, node.color, cx, cy, r, 1);
    }

    ctx.fillStyle = '#111827';
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillText(node.name, sx, sy + (R * 2) + 15);
    ctx.restore();
}

function paintFrame(posMap, effect) {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offsetX * scale * dpr, offsetY * scale * dpr);

    if (root === TNULL || posMap.size === 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#6b7280';
        ctx.font = '14px "Courier New", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(';; empty tree -- type a name below and press Ins', 16, 24);
        return;
    }

    const centerX = rect.width / (2 * scale) - offsetX;
    const rootY = 40;

    ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 2;
    (function walkEdges(node) {
        if (node === TNULL) return;
        const p = posMap.get(node);
        if (p) {
            if (node.left !== TNULL) {
                const c = posMap.get(node.left);
                if (c) {
                    ctx.beginPath();
                    ctx.moveTo(centerX + p.x, rootY + p.y + (R * 2) + 20);
                    ctx.lineTo(centerX + c.x, rootY + c.y);
                    ctx.stroke();
                }
            }
            if (node.right !== TNULL) {
                const c = posMap.get(node.right);
                if (c) {
                    ctx.beginPath();
                    ctx.moveTo(centerX + p.x, rootY + p.y + (R * 2) + 20);
                    ctx.lineTo(centerX + c.x, rootY + c.y);
                    ctx.stroke();
                }
            }
        }
        walkEdges(node.left);
        walkEdges(node.right);
    })(root);

    (function walkNodes(node) {
        if (node === TNULL) return;
        const p = posMap.get(node);
        if (p) drawNodeAt(node, centerX + p.x, rootY + p.y, effect);
        walkNodes(node.left);
        walkNodes(node.right);
    })(root);
}

let animating = false;

function setControlsEnabled(enabled) {
    insertButton.disabled = !enabled;
    removeButton.disabled = !enabled;
}

function playStep(step) {
    return new Promise(resolve => {
        let duration = 380;
        if (step.type === 'restructure') duration = 480;
        if (step.type === 'insert-leaf') duration = 320;
        if (step.type === 'remove-node') duration = 320;

        const start = performance.now();
        function frame(now) {
            const t = Math.min(1, (now - start) / duration);
            const eased = easeInOutCubic(t);

            if (step.type === 'recolor') {
                paintFrame(layoutRoot(), { type: 'recolor', changes: step.changes, t: eased });
            } else if (step.type === 'insert-leaf') {
                paintFrame(layoutRoot(), { type: 'insert', node: step.node, t: eased });
            } else if (step.type === 'remove-node') {
                paintFrame(layoutRoot(), { type: 'remove', node: step.node, t: eased });
            } else if (step.type === 'restructure') {
                paintFrame(lerpMap(step.before, step.after, eased), null);
            }

            if (t < 1) requestAnimationFrame(frame);
            else resolve();
        }
        requestAnimationFrame(frame);
    });
}

async function runAnimated(gen) {
    animating = true;
    setControlsEnabled(false);
    for (const step of gen) {
        await playStep(step);
    }
    animating = false;
    setControlsEnabled(true);
    scheduleRender();
    refreshStats();
}

function doInsert() {
    if (animating) return;
    const v = valueInput.value.trim();
    if (!v) { setStatus('Type a name first.', 'warn'); return; }
    valueInput.value = '';
    valueInput.focus();
    runAnimated(insertGen(v));
}

function doRemove() {
    if (animating) return;
    const v = valueInput.value.trim();
    if (!v) { setStatus('Type a name first.', 'warn'); return; }
    valueInput.value = '';
    valueInput.focus();
    runAnimated(removeGen(v));
}

insertButton.addEventListener('click', doInsert);
removeButton.addEventListener('click', doRemove);
valueInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doInsert();
});

canvas.addEventListener('mousedown', (e) => { isPanning = true; panStartX = e.clientX; panStartY = e.clientY; lastPanX = offsetX; lastPanY = offsetY; });
window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    offsetX = lastPanX + (e.clientX - panStartX) / scale;
    offsetY = lastPanY + (e.clientY - panStartY) / scale;
    if (!animating) scheduleRender();
});
window.addEventListener('mouseup', () => isPanning = false);
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const worldX = (mx - offsetX * scale) / scale, worldY = (my - offsetY * scale) / scale;
    scale = Math.min(3, Math.max(0.2, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    offsetX = (mx / scale) - worldX; offsetY = (my / scale) - worldY;
    if (!animating) scheduleRender();
}, { passive: false });

let pinchState = null;

function getPinchState(e) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
    return { dist: Math.hypot(dx, dy), midX: (t0.clientX + t1.clientX) / 2, midY: (t0.clientY + t1.clientY) / 2 };
}

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
        pinchState = null;
        isPanning = true;
        panStartX = e.touches[0].clientX; panStartY = e.touches[0].clientY;
        lastPanX = offsetX; lastPanY = offsetY;
    } else if (e.touches.length === 2) {
        isPanning = false;
        pinchState = getPinchState(e);
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isPanning) {
        offsetX = lastPanX + (e.touches[0].clientX - panStartX) / scale;
        offsetY = lastPanY + (e.touches[0].clientY - panStartY) / scale;
        if (!animating) scheduleRender();
    } else if (e.touches.length === 2 && pinchState) {
        const rect = canvas.getBoundingClientRect();
        const next = getPinchState(e);
        const mx = next.midX - rect.left, my = next.midY - rect.top;
        const worldX = (mx - offsetX * scale) / scale, worldY = (my - offsetY * scale) / scale;
        const factor = next.dist / pinchState.dist;
        scale = Math.min(3, Math.max(0.2, scale * factor));
        offsetX = (mx / scale) - worldX; offsetY = (my / scale) - worldY;
        pinchState = next;
        if (!animating) scheduleRender();
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
        isPanning = false;
        pinchState = null;
    } else if (e.touches.length === 1) {
        pinchState = null;
        isPanning = true;
        panStartX = e.touches[0].clientX; panStartY = e.touches[0].clientY;
        lastPanX = offsetX; lastPanY = offsetY;
    }
}, { passive: false });

window.addEventListener('resize', () => { if (!animating) scheduleRender(); });

const canvasResizeObserver = new ResizeObserver(() => {
    if (!animating) scheduleRender();
});
canvasResizeObserver.observe(container);

const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const bufferTabs = document.querySelectorAll('.buffer-tab');
const buffers = document.querySelectorAll('.buffer-content');

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarToggle.textContent = '[log]';
}

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    sidebarToggle.textContent = sidebar.classList.contains('open') ? '[hide]' : '[log]';
});

sidebarBackdrop.addEventListener('click', closeSidebar);

bufferTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        bufferTabs.forEach(t => t.classList.remove('active'));
        buffers.forEach(b => b.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.buffer).classList.add('active');
    });
});

log('rbt-visualizer loaded -- ready.');
refreshStats();
scheduleRender();
