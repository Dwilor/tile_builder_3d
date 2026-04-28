/**
 * TILE BUILDER 3D - V19 (Fit-to-grid non-uniforme)
 */

const GRID_SIZE = 10, LAYER_HEIGHT = 4;

/**
 * Scale un mesh pour qu'il remplisse exactement la cellule GRID_SIZE × GRID_SIZE.
 * - X et Z sont étirés indépendamment jusqu'à GRID_SIZE (pas de gap, pas de débordement).
 * - Y (hauteur) est scalé avec le même facteur que la plus grande dimension XZ,
 *   pour conserver des proportions visuelles cohérentes.
 * La géométrie doit déjà être centrée sur XZ et posée à Y=0 (fait dans parseSTL).
 */
function fitMeshToGrid(mesh, geo) {
    const s = new THREE.Vector3();
    geo.boundingBox.getSize(s);
    // Facteur de référence pour la hauteur = proportionnel à la grande dim XZ
    const refScale = GRID_SIZE / Math.max(s.x, s.z);
    mesh.scale.set(
        GRID_SIZE / s.x,   // X remplit exactement la cellule
        refScale,           // Y garde des proportions cohérentes
        GRID_SIZE / s.z    // Z remplit exactement la cellule
    );
    mesh.position.set(0, 0, 0);
}

// ─── Renderer offscreen dédié aux previews ───────────────────────────────────
let _previewRenderer = null;
function getPreviewRenderer() {
    if (_previewRenderer) return _previewRenderer;
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    _previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    _previewRenderer.setPixelRatio(1);
    _previewRenderer.setSize(128, 128);
    _previewRenderer.setClearColor(0x000000, 0);
    return _previewRenderer;
}

// ─── Fabrique une scène de preview isolée ────────────────────────────────────
function makePreviewScene(geo) {
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    // Éclairage identique à la map
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(100, 200, 100);
    scene.add(sun);

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc8a96e }));
    const s = new THREE.Vector3();
    geo.boundingBox.getSize(s);
    const maxDim = Math.max(s.x, s.y, s.z);
    mesh.scale.setScalar(10 / maxDim);
    scene.add(mesh);

    const scaledH = (s.y / maxDim) * 10;
    const dist = 22;
    camera.position.set(dist * 0.7, scaledH * 0.5 + dist * 0.6, dist * 0.7);
    camera.lookAt(0, scaledH * 0.5, 0);

    return { scene, camera, mesh };
}

function renderPreviewToCanvas(sceneObj, canvas) {
    const pr = getPreviewRenderer();
    pr.render(sceneObj.scene, sceneObj.camera);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(pr.domElement, 0, 0, canvas.width, canvas.height);
}

// ─── Système hover pour la rotation des previews ────────────────────────────
const _hoverState = {
    active: null, rafId: null,
    _spin() {
        if (!this.active) return;
        this.active.mesh.rotation.y += 0.025;
        renderPreviewToCanvas(this.active, this.active.canvas);
        this.rafId = requestAnimationFrame(() => this._spin());
    },
    enter(viewer) {
        cancelAnimationFrame(this.rafId);
        this.active = viewer;
        this._spin();
    },
    leave(viewer) {
        if (this.active === viewer) {
            cancelAnimationFrame(this.rafId);
            this.active = null;
        }
    }
};

const engine = {
    scene: null, camera: null, renderer: null,
    ghostGroup: null, mapGrid: {}, selectedTile: null,
    currentRot: 0, geoCache: {}, keys: {},
    dpr: window.devicePixelRatio || 1,
    camTarget: new THREE.Vector3(120, 0, 120),
    camDist: 180, camTheta: Math.PI / 4, camPhi: Math.PI / 3.5,

    init() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);

        const canvas = document.getElementById('map-canvas');
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        this.renderer.setPixelRatio(this.dpr);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        this.scene.add(new THREE.GridHelper(480, 48, 0x443322, 0x221a10));
        this.sun = new THREE.DirectionalLight(0xffffff, 0.6);
        this.sun.position.set(100, 200, 100);
        this.scene.add(this.sun);

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ visible: false }));
        floor.rotation.x = -Math.PI / 2; floor.name = "ground_hit";
        this.scene.add(floor);

        this.ghostGroup = new THREE.Group();
        this.scene.add(this.ghostGroup);

        // Resize robuste — corrige le décalage curseur + bande noire
        this._doResize();
        window.addEventListener('resize', () => this._doResize());
        const ro = new ResizeObserver(() => this._doResize());
        ro.observe(document.getElementById('map-interaction-zone'));

        this.setupListeners();
        this.animate();
    },

    _doResize() {
        const W = window.innerWidth, H = window.innerHeight;
        this.camera.aspect = W / H;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(W, H);
    },

    loadSTL(url) {
        return new Promise((resolve) => {
            if (this.geoCache[url]) return resolve(this.geoCache[url]);
            new THREE.FileLoader().setResponseType('arraybuffer').load(url, (buffer) => {
                const geo = this.parseSTL(buffer);
                this.geoCache[url] = geo; resolve(geo);
            });
        });
    },

    parseSTL(buffer) {
        const dv = new DataView(buffer), numTri = dv.getUint32(80, true);
        const geo = new THREE.BufferGeometry(), verts = new Float32Array(numTri * 9);
        let offset = 84;
        for (let i = 0; i < numTri; i++) {
            offset += 12;
            for (let v = 0; v < 3; v++) {
                verts[i*9+v*3]   = dv.getFloat32(offset,   true);
                verts[i*9+v*3+1] = dv.getFloat32(offset+4, true);
                verts[i*9+v*3+2] = dv.getFloat32(offset+8, true);
                offset += 12;
            }
            offset += 2;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.rotateX(-Math.PI / 2); geo.computeVertexNormals(); geo.computeBoundingBox();
        const center = new THREE.Vector3(); geo.boundingBox.getCenter(center);
        geo.translate(-center.x, -geo.boundingBox.min.y, -center.z);
        return geo;
    },

    setupListeners() {
        const zone = document.getElementById('map-interaction-zone');
        window.onkeydown = e => {
            const key = e.key.toLowerCase();
            if (e.ctrlKey) {
                if (key === 'z') { e.preventDefault(); ui.undo(); return; }
                if (key === 'y') { e.preventDefault(); ui.redo(); return; }
            }
            this.keys[key] = true;
            if (key === 'r') this.rotateTile();
            if (e.key === 'ArrowUp')   ui.changeLayer(1);
            if (e.key === 'ArrowDown') ui.changeLayer(-1);
            if (e.key === 'e') ui.setMode(ui.mode === 'place' ? 'erase' : 'place');
            // Chiffres 0–9 pour changer de niveau directement
            if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
                ui.currentLayer = parseInt(e.key);
                ui.applyLayerState();
            }
        };
        window.onkeyup = e => this.keys[e.key.toLowerCase()] = false;
        zone.onmousemove   = e => this.handleMouseMove(e);
        zone.onmousedown   = e => { if (e.button === 0) this.placeOrErase(); };
        zone.onwheel       = e => { this.camDist = Math.max(30, Math.min(600, this.camDist + e.deltaY * 0.5)); };
        zone.oncontextmenu = e => e.preventDefault();
    },

    handleMouseMove(e) {
        // Calcul via getBoundingClientRect pour éviter tout décalage de layout
        const rect   = this.renderer.domElement.getBoundingClientRect();
        const mouseX = ((e.clientX - rect.left) / rect.width)  *  2 - 1;
        const mouseY = ((e.clientY - rect.top)  / rect.height) * -2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), this.camera);
        const hits = raycaster.intersectObject(this.scene.getObjectByName("ground_hit"));
        if (hits.length > 0) {
            const x = Math.floor(hits[0].point.x / GRID_SIZE) * GRID_SIZE + 5;
            const z = Math.floor(hits[0].point.z / GRID_SIZE) * GRID_SIZE + 5;
            this.ghostGroup.position.set(x, ui.currentLayer * LAYER_HEIGHT, z);
            this.ghostGroup.visible = (ui.mode === 'place' && this.selectedTile);
        }
        if (e.buttons === 2) {
            this.camTheta -= e.movementX * 0.0025;
            this.camPhi = Math.max(0.1, Math.min(Math.PI/2.1, this.camPhi - e.movementY * 0.0025));
        }
    },

    placeOrErase(manualData = null, isUndoRedo = false) {
        const pos  = manualData ? new THREE.Vector3(manualData.pos.x, manualData.pos.y, manualData.pos.z) : this.ghostGroup.position.clone();
        const rot  = manualData ? manualData.rot : this.currentRot * (Math.PI / 2);
        const tile = manualData ? ui.allTiles.find(t => t.id === manualData.tileId) : this.selectedTile;
        const key  = `${pos.x},${pos.y},${pos.z}`;

        if (!manualData && !isUndoRedo) ui.saveHistory();

        if (ui.mode === 'erase' && !manualData) {
            if (this.mapGrid[key]) {
                ui.updateInventory(this.mapGrid[key].tileData.id, -1);
                this.scene.remove(this.mapGrid[key].group);
                delete this.mapGrid[key];
            }
            return;
        }
        if (!tile) return;
        if (this.mapGrid[key]) {
            ui.updateInventory(this.mapGrid[key].tileData.id, -1);
            this.scene.remove(this.mapGrid[key].group);
        }

        const group = new THREE.Group();
        group.position.copy(pos); group.rotation.y = rot;
        const geo  = this.geoCache[`/stl/${tile.filename}`];
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc8a96e }));
        fitMeshToGrid(mesh, geo);
        group.add(mesh); this.scene.add(group);
        this.mapGrid[key] = { group, tileData: tile };
        ui.updateInventory(tile.id, 1);
        if (!manualData && !isUndoRedo) { ui.currentLayer = 0; ui.applyLayerState(); }
    },

    rotateTile() {
        this.currentRot = (this.currentRot - 1 + 4) % 4;
        this.ghostGroup.rotation.y = this.currentRot * (Math.PI / 2);
    },

    setLighting(style) {
        const amb = this.scene.children.find(c => c.type === "AmbientLight");
        if (style === 'sunset') {
            amb.color.setHex(0xffaa66); amb.intensity = 0.4;
            this.sun.color.setHex(0xff7700); this.sun.intensity = 1.2;
            this.sun.position.set(200, 30, 50);
        } else if (style === 'moonlight') {
            amb.color.setHex(0x222266); amb.intensity = 0.3;
            this.sun.color.setHex(0xaaaaff); this.sun.intensity = 0.7;
            this.sun.position.set(-50, 150, -50);
        } else if (style === 'dungeon') {
            amb.color.setHex(0x221100); amb.intensity = 0.5;
            this.sun.color.setHex(0xff8800); this.sun.intensity = 1.0;
            this.sun.position.set(0, 100, 0);
        } else {
            amb.color.setHex(0xffffff); amb.intensity = 0.7;
            this.sun.color.setHex(0xffffff); this.sun.intensity = 0.6;
            this.sun.position.set(100, 200, 100);
        }
    },

    animate() {
        requestAnimationFrame(() => this.animate());
        const speed   = this.camDist * 0.005;
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
        if (this.keys['z'] || this.keys['w']) this.camTarget.addScaledVector(forward,  speed);
        if (this.keys['s'])                   this.camTarget.addScaledVector(forward, -speed);
        if (this.keys['q'] || this.keys['a']) this.camTarget.addScaledVector(right,   -speed);
        if (this.keys['d'])                   this.camTarget.addScaledVector(right,    speed);
        this.camera.position.set(
            this.camTarget.x + this.camDist * Math.sin(this.camPhi) * Math.sin(this.camTheta),
            this.camTarget.y + this.camDist * Math.cos(this.camPhi),
            this.camTarget.z + this.camDist * Math.sin(this.camPhi) * Math.cos(this.camTheta)
        );
        this.camera.lookAt(this.camTarget);
        this.renderer.render(this.scene, this.camera);
    },

    resetMap() {
        if (confirm("Vider la map ?")) {
            ui.saveHistory();
            Object.values(this.mapGrid).forEach(m => this.scene.remove(m.group));
            this.mapGrid = {}; ui.inventory = {};
            ui.updateInventoryUI(); ui.currentLayer = 0; ui.applyLayerState();
        }
    }
};

const ui = {
    allTiles: [], currentLayer: 0, mode: 'place', inventory: {},
    undoStack: [], redoStack: [],

    async init() {
        const res = await fetch('/api/tiles'); this.allTiles = await res.json();
        const total = this.allTiles.length;
        for (let i = 0; i < total; i++) {
            const t = this.allTiles[i];
            document.getElementById('loading-status').innerText = `⚒ Forgeage : ${t.label}…`;
            await engine.loadSTL(`/stl/${t.filename}`);
            document.getElementById('loading-progress').style.width = `${((i+1)/total)*100}%`;
        }
        if (this.allTiles.length === 0) {
            const grid = document.getElementById('tile-grid');
            grid.innerHTML = `
                <div class="lib-empty" style="padding:30px 16px; text-align:center; color:var(--text-muted);">
                    <div style="font-size:36px; margin-bottom:14px; opacity:0.35;">🗄</div>
                    <div style="font-family:'Cinzel',serif; font-size:0.7rem; color:var(--gold-dim); letter-spacing:1px; margin-bottom:10px;">Bibliothèque vide</div>
                    <div style="font-size:12px; line-height:1.8;">
                        Importez vos fichiers STL<br>via le bouton <strong style="color:var(--gold-dim);">⚒ Bibliothèque</strong><br>dans la barre du haut.
                    </div>
                </div>`;
        } else {
            this.showCategories();
        }
        setTimeout(() => document.getElementById('loading').style.display = 'none', 500);
    },

    async reload() {
        const res = await fetch('/api/tiles');
        const newTiles = await res.json();
        for (const t of newTiles) {
            if (!engine.geoCache[`/stl/${t.filename}`]) await engine.loadSTL(`/stl/${t.filename}`);
        }
        this.allTiles = newTiles;
        const backBtn    = document.getElementById('back-to-cats');
        const currentCat = document.getElementById('current-category').innerText;
        if (backBtn.style.display === 'none' || currentCat === 'Bibliothèque' || currentCat === 'Catégories') {
            this.showCategories();
        } else {
            this.showTiles(currentCat);
        }
    },

    saveHistory() {
        const state = JSON.stringify(Object.entries(engine.mapGrid).map(([k,v]) => ({ pos: v.group.position, tileId: v.tileData.id, rot: v.group.rotation.y })));
        this.undoStack.push(state);
        if (this.undoStack.length > 40) this.undoStack.shift();
        this.redoStack = [];
    },

    undo() {
        if (!this.undoStack.length) return;
        const cur = JSON.stringify(Object.entries(engine.mapGrid).map(([k,v]) => ({ pos: v.group.position, tileId: v.tileData.id, rot: v.group.rotation.y })));
        this.redoStack.push(cur);
        this.applyState(JSON.parse(this.undoStack.pop()));
    },

    redo() {
        if (!this.redoStack.length) return;
        const cur = JSON.stringify(Object.entries(engine.mapGrid).map(([k,v]) => ({ pos: v.group.position, tileId: v.tileData.id, rot: v.group.rotation.y })));
        this.undoStack.push(cur);
        this.applyState(JSON.parse(this.redoStack.pop()));
    },

    applyState(data) {
        Object.values(engine.mapGrid).forEach(m => engine.scene.remove(m.group));
        engine.mapGrid = {}; this.inventory = {};
        data.forEach(item => engine.placeOrErase(item, true));
        this.updateInventoryUI();
    },

    showCategories() {
        const grid = document.getElementById('tile-grid'); grid.innerHTML = '';
        document.getElementById('back-to-cats').style.display = 'none';
        document.getElementById('current-category').innerText = "Catégories";
        [...new Set(this.allTiles.map(t => t.category))].sort().forEach(cat => {
            const div = document.createElement('div'); div.className = 'cat-card';
            div.innerText = cat; div.onclick = () => this.showTiles(cat);
            grid.appendChild(div);
        });
    },

    showTiles(cat) {
        const grid = document.getElementById('tile-grid'); grid.innerHTML = '';
        document.getElementById('back-to-cats').style.display = 'block';
        document.getElementById('current-category').innerText = cat;

        this.allTiles.filter(t => t.category === cat).forEach(tile => {
            const card = document.createElement('div'); card.className = 'tile-card';
            const num  = tile.id.split('_')[1] || "??";
            card.innerHTML = `<canvas class="thumb-canvas" width="88" height="88"></canvas>
                <div class="tile-info"><span class="tile-id">#${num}</span><span class="tile-label">${tile.label}</span></div>`;
            card.onclick = () => {
                document.querySelectorAll('.tile-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.selectTile(tile);
            };
            grid.appendChild(card);

            const canvas = card.querySelector('canvas');
            const geo    = engine.geoCache[`/stl/${tile.filename}`];
            if (!geo) return;
            const sceneObj = makePreviewScene(geo);
            sceneObj.canvas = canvas;
            renderPreviewToCanvas(sceneObj, canvas);   // rendu initial statique
            canvas.addEventListener('mouseenter', () => _hoverState.enter(sceneObj));
            canvas.addEventListener('mouseleave', () => { _hoverState.leave(sceneObj); renderPreviewToCanvas(sceneObj, canvas); });
        });
    },

    selectTile(tile) {
        this.selectedTile = tile; engine.selectedTile = tile; engine.ghostGroup.clear();
        const geo  = engine.geoCache[`/stl/${tile.filename}`];
        // Ghost = rendu normal (couleur identique, pas de transparence verte)
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc8a96e }));
        fitMeshToGrid(mesh, geo);
        engine.ghostGroup.add(mesh);
    },

    updateInventory(id, change) {
        if (!this.inventory[id]) {
            const t = this.allTiles.find(t => t.id === id);
            this.inventory[id] = { label: t ? t.label : id, count: 0, id_full: id };
        }
        this.inventory[id].count += change;
        if (this.inventory[id].count <= 0) delete this.inventory[id];
        this.updateInventoryUI();
    },

    updateInventoryUI() {
        const list = document.getElementById('inventory-list'); list.innerHTML = '';
        const entries = Object.entries(this.inventory);
        if (entries.length === 0) {
            list.innerHTML = `<div class="inventory-empty"><span class="inventory-empty-rune">⚗</span>Sélectionnez une tuile et<br>cliquez sur la carte pour<br>commencer à construire.</div>`;
            return;
        }
        entries.forEach(([id, data]) => {
            const div = document.createElement('div'); div.className = 'inventory-item';
            div.innerHTML = `<span class="inv-count">${data.count}</span><span class="inv-name">#${id.split('_')[1]} ${data.label}</span>`;
            list.appendChild(div);
        });
    },

    saveMap() {
        const data = { grid: Object.entries(engine.mapGrid).map(([k,v]) => ({ pos: v.group.position, tileId: v.tileData.id, rot: v.group.rotation.y })) };
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = "tiles_save.json"; a.click();
    },

    loadMap(event) {
        if (!event.target.files[0]) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                this.saveHistory();
                const data = JSON.parse(e.target.result);
                engine.resetMap();
                data.grid.forEach(item => engine.placeOrErase(item, true));
            } catch(err) { alert("Fichier invalide"); }
        };
        reader.readAsText(event.target.files[0]);
    },

    changeLayer(v) { this.currentLayer = Math.max(0, this.currentLayer + v); this.applyLayerState(); },

    applyLayerState() {
        document.getElementById('layer-label').innerText = `Lvl ${this.currentLayer}`;
        Object.values(engine.mapGrid).forEach(item => {
            const itemLvl = Math.round(item.group.position.y / LAYER_HEIGHT);
            item.group.traverse(c => {
                if (c.isMesh) {
                    c.material.transparent = true;
                    if (this.currentLayer === 0) c.material.opacity = 1.0;
                    else c.material.opacity = (itemLvl === this.currentLayer) ? 1.0 : (itemLvl < this.currentLayer ? 0.3 : 0.05);
                }
            });
        });
    },

    exportList() {
        let t = "--- LISTE D'IMPRESSION TILE BUILDER ---\n\n";
        Object.values(this.inventory).forEach(i => {
            const pieceNum = i.id_full.split('_')[1] || "??";
            t += `${i.count} exemplaire(s) - #${pieceNum} ${i.label}\n`;
        });
        const b = new Blob([t], {type: 'text/plain'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = "liste_impression.txt"; a.click();
    },

    setMode(m) {
        this.mode = m;
        document.getElementById('btn-place').classList.toggle('active', m==='place');
        document.getElementById('btn-erase').classList.toggle('active', m==='erase');
        engine.ghostGroup.visible = (m==='place' && this.selectedTile);
    }
};

window.onload = () => { engine.init(); ui.init(); };

/* ══════════════════════════════════════════════════════
   LIBRARY MANAGER
══════════════════════════════════════════════════════ */

const libManager = {
    currentFolder: null,
    libraryData:   null,
    previewViewers: [],

    async open() {
        document.getElementById('lib-overlay').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        await this.refresh();
    },

    close() {
        document.getElementById('lib-overlay').classList.add('hidden');
        document.body.style.overflow = '';
        this.stopPreviews();
        this.currentFolder = null;
    },

    async refresh() {
        const res = await fetch('/api/library');
        this.libraryData = await res.json();
        this.renderSidebar();
        if (this.currentFolder !== null) {
            const folderStillExists = this.currentFolder === '__root__' || this.libraryData.folders.includes(this.currentFolder);
            if (folderStillExists) {
                this.renderFiles(this.currentFolder);
            } else {
                this.currentFolder = null;
                this.renderFiles(null);
            }
        } else {
            this.renderFiles(null);
        }
        await ui.reload();
    },

    renderSidebar() {
        const list = document.getElementById('lib-folder-list'); list.innerHTML = '';
        const allFiles = this.libraryData.files;
        const rootFiles = allFiles['__root__'] || [];
        if (rootFiles.length > 0) list.appendChild(this._folderItem('__root__', '📂', 'Racine', rootFiles.length, false));
        this.libraryData.folders.forEach(name => {
            const files = allFiles[name] || [];
            list.appendChild(this._folderItem(name, '📁', name, files.length, true));
        });
        if (list.children.length === 0) {
            list.innerHTML = `<div class="lib-empty" style="padding:20px 10px;font-size:12px;"><div class="lib-empty-icon">🗂</div>Aucune catégorie.<br>Créez-en une pour commencer.</div>`;
        }
    },

    _folderItem(key, icon, label, count, deletable) {
        const div = document.createElement('div');
        div.className = 'lib-folder-item' + (this.currentFolder === key ? ' active' : '');
        div.innerHTML = `
            <span class="lib-folder-icon">${icon}</span>
            <span class="lib-folder-name">${label}</span>
            <span class="lib-folder-count">${count}</span>
            ${deletable ? `<button class="lib-folder-del" title="Supprimer ce dossier">✕</button>` : ''}
        `;
        div.addEventListener('click', (e) => {
            if (e.target.classList.contains('lib-folder-del')) return;
            this.currentFolder = key;
            document.querySelectorAll('.lib-folder-item').forEach(el => el.classList.remove('active'));
            div.classList.add('active');
            this.renderFiles(key);
        });
        if (deletable) {
            div.querySelector('.lib-folder-del').addEventListener('click', (e) => {
                e.stopPropagation(); this.deleteFolder(key);
            });
        }
        return div;
    },

    renderFiles(folderKey) {
        const label     = document.getElementById('lib-current-folder-label');
        const importBtn = document.getElementById('lib-import-btn');
        const dropzone  = document.getElementById('lib-dropzone');
        const fileList  = document.getElementById('lib-file-list');

        this.stopPreviews();
        fileList.innerHTML = '';

        if (!folderKey) {
            label.textContent = 'Sélectionnez une catégorie';
            importBtn.style.display = 'none';
            dropzone.classList.add('hidden');
            fileList.innerHTML = '<div class="lib-empty"><div class="lib-empty-icon">👈</div>Choisissez un dossier à gauche</div>';
            return;
        }

        const name = folderKey === '__root__' ? 'Racine' : folderKey;
        label.textContent = name;
        importBtn.style.display = '';
        dropzone.classList.remove('hidden');
        dropzone.onclick    = () => this.triggerImport();
        dropzone.ondragover  = (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); };
        dropzone.ondragleave = () => dropzone.classList.remove('drag-over');
        dropzone.ondrop      = (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); this.uploadFiles([...e.dataTransfer.files]); };

        const files = this.libraryData.files[folderKey] || [];
        if (files.length === 0) {
            fileList.innerHTML = '<div class="lib-empty"><div class="lib-empty-icon">📭</div>Aucun STL dans cette catégorie.<br>Importez des fichiers ci-dessus.</div>';
            return;
        }

        files.forEach((f) => {
            const item = document.createElement('div'); item.className = 'lib-file-item';
            item.innerHTML = `
                <canvas class="lib-thumb" width="128" height="128"></canvas>
                <div class="lib-file-info">
                    <span class="lib-file-name">${f.label}</span>
                    <span class="lib-file-stem">${f.stem}</span>
                </div>
                <button class="lib-file-del" title="Supprimer ce fichier">✕</button>
            `;
            item.querySelector('.lib-file-del').addEventListener('click', () => this.deleteFile(f.filename));
            fileList.appendChild(item);

            const canvas = item.querySelector('.lib-thumb');
            const setup  = (g) => {
                const sceneObj = makePreviewScene(g);
                sceneObj.canvas = canvas;
                renderPreviewToCanvas(sceneObj, canvas);
                canvas.addEventListener('mouseenter', () => _hoverState.enter(sceneObj));
                canvas.addEventListener('mouseleave', () => { _hoverState.leave(sceneObj); renderPreviewToCanvas(sceneObj, canvas); });
                this.previewViewers.push(sceneObj);
            };
            const geo = engine.geoCache[`/stl/${f.filename}`];
            if (geo) setup(geo);
            else engine.loadSTL(`/stl/${f.filename}`).then(g => setup(g));
        });
    },

    stopPreviews() {
        this.previewViewers.forEach(v => _hoverState.leave(v));
        this.previewViewers = [];
    },

    async promptNewFolder() {
        const name = prompt('Nom du nouveau dossier (catégorie) :');
        if (!name || !name.trim()) return;
        const res  = await fetch('/api/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
        const data = await res.json();
        if (data.error) { this.toast(data.error, true); return; }
        this.currentFolder = name.trim();
        this.toast(`Dossier « ${name.trim()} » créé`);
        await this.refresh();
    },

    async deleteFolder(name) {
        const files = this.libraryData.files[name] || [];
        const msg   = files.length > 0 ? `Supprimer le dossier « ${name} » et ses ${files.length} fichier(s) ?` : `Supprimer le dossier « ${name} » ?`;
        if (!confirm(msg)) return;
        const res  = await fetch(`/api/folder/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) { this.toast(data.error, true); return; }
        if (this.currentFolder === name) this.currentFolder = null;
        this.toast('Dossier supprimé');
        await this.refresh();
    },

    triggerImport() {
        if (!this.currentFolder) { this.toast("Sélectionnez d'abord un dossier", true); return; }
        document.getElementById('lib-file-input').click();
    },

    handleFileInput(event) { this.uploadFiles([...event.target.files]); event.target.value = ''; },

    async uploadFiles(files) {
        if (!this.currentFolder) return;
        const stlFiles = files.filter(f => f.name.toLowerCase().endsWith('.stl'));
        if (stlFiles.length === 0) { this.toast('Aucun fichier .stl sélectionné', true); return; }
        const progress = document.getElementById('lib-upload-progress');
        const bar      = document.getElementById('lib-upload-bar');
        const lbl      = document.getElementById('lib-upload-label');
        progress.classList.remove('hidden');
        const formData = new FormData();
        stlFiles.forEach(f => formData.append('files', f));
        let pct = 0;
        const tick = setInterval(() => { pct = Math.min(pct + 8, 88); bar.style.width = pct + '%'; }, 80);
        try {
            const folder = encodeURIComponent(this.currentFolder);
            const res  = await fetch(`/api/upload/${folder}`, { method: 'POST', body: formData });
            const data = await res.json();
            clearInterval(tick);
            bar.style.width = '100%';
            lbl.textContent = `${data.saved?.length || 0} fichier(s) importé(s)`;
            setTimeout(() => { progress.classList.add('hidden'); bar.style.width = '0%'; }, 1200);
            this.toast(`${data.saved?.length || 0} fichier(s) importé(s) ✓`);
            await this.refresh();
        } catch (err) {
            clearInterval(tick);
            progress.classList.add('hidden');
            this.toast("Erreur lors de l'import", true);
        }
    },

    async deleteFile(filename) {
        const name = filename.split('/').pop();
        if (!confirm(`Supprimer « ${name} » ?`)) return;
        const res  = await fetch(`/api/stl/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) { this.toast(data.error, true); return; }
        this.toast('Fichier supprimé');
        await this.refresh();
    },

    toast(msg, isError = false) {
        let el = document.getElementById('lib-toast');
        if (!el) { el = document.createElement('div'); el.id = 'lib-toast'; document.body.appendChild(el); }
        el.textContent = msg;
        el.className   = isError ? 'error' : '';
        el.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
    },

    // renderPreviews n'est plus appelé depuis engine.animate — les previews sont autonomes
    renderPreviews() {}
};

/* ── Heartbeat : maintient le serveur Flask en vie tant que la page est ouverte ── */
(function startHeartbeat() {
    function ping() {
        fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
    }
    ping(); // ping immédiat au chargement
    setInterval(ping, 5000); // puis toutes les 5s
})();