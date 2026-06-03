import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";

// Three.js and addons from local lib folder
import * as THREE from './lib/three.module.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { OBJLoader } from './lib/OBJLoader.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { FBXLoader } from './lib/FBXLoader.js';

app.registerExtension({
    name: "Comfy.UVPainter",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "YedpUVPainter") {

            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) onNodeCreated.apply(this, arguments);

                // Hide the default painter_data widget
                this.painterDataWidget = this.widgets.find(w => w.name === "painter_data");
                if (this.painterDataWidget) {
                    this.painterDataWidget.type = "hidden";
                    this.painterDataWidget.computeSize = () => [0, -4]; // Completely hides it
                }

                // Default node dimensions
                this.size = [800, 500];
                this.resizable = true;

                // Create the DOM container for the custom UI
                this.domContainer = document.createElement("div");
                this.domContainer.style.position = "absolute";
                this.domContainer.style.transformOrigin = "0 0";
                this.domContainer.style.display = "flex";
                this.domContainer.style.flexDirection = "row";
                this.domContainer.style.backgroundColor = "#111";
                this.domContainer.style.border = "1px solid #444";
                this.domContainer.style.borderRadius = "4px";
                this.domContainer.style.overflow = "hidden";
                this.domContainer.style.zIndex = "10";

                // Left Pane (3D Viewport)
                const leftPane = document.createElement("div");
                leftPane.style.flex = "1";
                leftPane.style.borderRight = "2px solid #333";
                leftPane.style.position = "relative";
                leftPane.style.overflow = "hidden";

                // Floating Load .obj Button inside Left Pane
                const loadContainer = document.createElement("div");
                loadContainer.style.position = "absolute";
                loadContainer.style.top = "10px";
                loadContainer.style.left = "10px";
                loadContainer.style.zIndex = "20";
                loadContainer.style.backgroundColor = "rgba(0,0,0,0.6)";
                loadContainer.style.padding = "5px";
                loadContainer.style.borderRadius = "4px";

                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = ".obj,.gltf,.glb,.fbx";
                fileInput.style.color = "#fff";
                fileInput.style.fontSize = "12px";
                loadContainer.appendChild(fileInput);
                leftPane.appendChild(loadContainer);

                // Floating Toolbar
                const toolbar = document.createElement("div");
                toolbar.style.position = "absolute";
                toolbar.style.top = "45px";
                toolbar.style.left = "10px";
                toolbar.style.zIndex = "20";
                toolbar.style.backgroundColor = "rgba(0,0,0,0.6)";
                toolbar.style.padding = "5px";
                toolbar.style.borderRadius = "4px";
                toolbar.style.color = "#fff";
                toolbar.style.fontSize = "12px";
                toolbar.style.display = "flex";
                toolbar.style.gap = "10px";

                const islandLabel = document.createElement("label");
                islandLabel.style.cursor = "pointer";
                const islandRadio = document.createElement("input");
                islandRadio.type = "radio";
                islandRadio.name = "selectionMode";
                islandRadio.value = "island";
                islandRadio.checked = true;
                islandLabel.appendChild(islandRadio);
                islandLabel.appendChild(document.createTextNode(" Island Mode"));

                const faceLabel = document.createElement("label");
                faceLabel.style.cursor = "pointer";
                const faceRadio = document.createElement("input");
                faceRadio.type = "radio";
                faceRadio.name = "selectionMode";
                faceRadio.value = "face";
                faceLabel.appendChild(faceRadio);
                faceLabel.appendChild(document.createTextNode(" Face Mode"));

                toolbar.appendChild(islandLabel);
                toolbar.appendChild(faceLabel);
                leftPane.appendChild(toolbar);

                // Right Pane (2D Canvas)
                const rightPane = document.createElement("div");
                rightPane.style.flex = "1";
                rightPane.style.position = "relative";
                rightPane.style.overflow = "hidden";
                rightPane.style.backgroundColor = "#555";

                const canvas2d = document.createElement("canvas");
                // Fixed internal resolution for ComfyUI mask output
                canvas2d.width = 1024;
                canvas2d.height = 1024;
                canvas2d.style.width = "100%";
                canvas2d.style.height = "100%";
                canvas2d.style.objectFit = "contain";
                canvas2d.style.display = "block";
                rightPane.appendChild(canvas2d);

                // Highlight Overlay Canvas
                const highlightCanvas2d = document.createElement("canvas");
                highlightCanvas2d.width = 1024;
                highlightCanvas2d.height = 1024;
                highlightCanvas2d.style.width = "100%";
                highlightCanvas2d.style.height = "100%";
                highlightCanvas2d.style.objectFit = "contain";
                highlightCanvas2d.style.display = "block";
                highlightCanvas2d.style.position = "absolute";
                highlightCanvas2d.style.top = "0";
                highlightCanvas2d.style.left = "0";
                highlightCanvas2d.style.pointerEvents = "none";
                rightPane.appendChild(highlightCanvas2d);

                // Prompt Stack UI overlay
                const promptStackContainer = document.createElement('div');
                promptStackContainer.style.position = 'absolute';
                promptStackContainer.style.top = '10px';
                promptStackContainer.style.right = '10px';
                promptStackContainer.style.width = '200px';
                promptStackContainer.style.maxHeight = '90%';
                promptStackContainer.style.display = 'flex';
                promptStackContainer.style.flexDirection = 'column';
                promptStackContainer.style.pointerEvents = 'auto';

                const newLayerBtn = document.createElement('button');
                newLayerBtn.innerText = '+ New Layer';
                newLayerBtn.style.padding = '8px';
                newLayerBtn.style.marginBottom = '10px';
                newLayerBtn.style.background = '#4CAF50';
                newLayerBtn.style.color = 'white';
                newLayerBtn.style.border = 'none';
                newLayerBtn.style.borderRadius = '4px';
                newLayerBtn.style.cursor = 'pointer';
                newLayerBtn.style.fontWeight = 'bold';

                const promptStack = document.createElement('div');
                promptStack.style.overflowY = 'auto';
                promptStack.style.flex = '1';

                promptStackContainer.appendChild(newLayerBtn);
                promptStackContainer.appendChild(promptStack);
                rightPane.appendChild(promptStackContainer);

                let layerCount = 0;
                let activeLayerId = null;
                const maskState = {};
                let currentMesh = null;

                function buildUVMap(mesh) {
                    const geometry = mesh.geometry;
                    const uvAttr = geometry.attributes.uv;
                    const index = geometry.index;
                    if (!uvAttr) return;

                    const numFaces = index ? index.count / 3 : uvAttr.count / 3;

                    mesh.userData.faceToIslandId = new Int32Array(numFaces);
                    mesh.userData.islandIdToFaces = [];
                    const currentUvToFaces = new Map();

                    const getUvKey = (u, v) => `${u.toFixed(5)},${v.toFixed(5)}`;

                    for (let i = 0; i < numFaces; i++) {
                        let a, b, c;
                        if (index) {
                            a = index.getX(i * 3); b = index.getX(i * 3 + 1); c = index.getX(i * 3 + 2);
                        } else {
                            a = i * 3; b = i * 3 + 1; c = i * 3 + 2;
                        }

                        const keys = [
                            getUvKey(uvAttr.getX(a), uvAttr.getY(a)),
                            getUvKey(uvAttr.getX(b), uvAttr.getY(b)),
                            getUvKey(uvAttr.getX(c), uvAttr.getY(c))
                        ];

                        keys.forEach(k => {
                            if (!currentUvToFaces.has(k)) currentUvToFaces.set(k, []);
                            currentUvToFaces.get(k).push(i);
                        });
                    }

                    const visited = new Uint8Array(numFaces);
                    let currentIslandId = 0;

                    for (let i = 0; i < numFaces; i++) {
                        if (!visited[i]) {
                            const islandFaces = [];
                            const queue = [i];
                            visited[i] = 1;

                            let head = 0;
                            while (head < queue.length) {
                                const face = queue[head++];
                                islandFaces.push(face);
                                mesh.userData.faceToIslandId[face] = currentIslandId;

                                let a, b, c;
                                if (index) {
                                    a = index.getX(face * 3); b = index.getX(face * 3 + 1); c = index.getX(face * 3 + 2);
                                } else {
                                    a = face * 3; b = face * 3 + 1; c = face * 3 + 2;
                                }

                                const keys = [
                                    getUvKey(uvAttr.getX(a), uvAttr.getY(a)),
                                    getUvKey(uvAttr.getX(b), uvAttr.getY(b)),
                                    getUvKey(uvAttr.getX(c), uvAttr.getY(c))
                                ];

                                keys.forEach(k => {
                                    const neighbors = currentUvToFaces.get(k);
                                    if (neighbors) {
                                        neighbors.forEach(n => {
                                            if (!visited[n]) {
                                                visited[n] = 1;
                                                queue.push(n);
                                            }
                                        });
                                    }
                                });
                            }
                            mesh.userData.islandIdToFaces[currentIslandId] = islandFaces;
                            currentIslandId++;
                        }
                    }
                }

                function getUVIslandFaces(mesh, startFaceIndex) {
                    const islandId = mesh.userData.faceToIslandId[startFaceIndex];
                    return mesh.userData.islandIdToFaces[islandId] || [startFaceIndex];
                }

                const hiddenCanvas = document.createElement('canvas');
                hiddenCanvas.width = 1024;
                hiddenCanvas.height = 1024;

                this.domContainer.appendChild(leftPane);
                this.domContainer.appendChild(rightPane);

                const loadingOverlay = document.createElement('div');
                loadingOverlay.style.position = 'absolute';
                loadingOverlay.style.top = '0';
                loadingOverlay.style.left = '0';
                loadingOverlay.style.width = '100%';
                loadingOverlay.style.height = '100%';
                loadingOverlay.style.background = 'rgba(0,0,0,0.8)';
                loadingOverlay.style.zIndex = '100';
                loadingOverlay.style.display = 'none';
                loadingOverlay.style.alignItems = 'center';
                loadingOverlay.style.justifyContent = 'center';
                loadingOverlay.style.color = 'white';
                loadingOverlay.style.fontSize = '24px';
                loadingOverlay.style.fontWeight = 'bold';
                loadingOverlay.innerText = "Baking High-Res Cavity Map...";
                this.domContainer.appendChild(loadingOverlay);

                document.body.appendChild(this.domContainer);

                let currentBakedCavity = null;

                const syncData = () => {
                    if (!this.painterDataWidget) return;

                    const layers = [];
                    const w = canvas2d.width;
                    const h = canvas2d.height;
                    const ctx = hiddenCanvas.getContext('2d');

                    Object.values(maskState).forEach(layer => {
                        ctx.clearRect(0, 0, w, h);
                        ctx.fillStyle = '#ffffff';
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1;

                        layer.faces.forEach(f => {
                            ctx.beginPath();
                            ctx.moveTo(f.uvA.x * w, (1 - f.uvA.y) * h);
                            ctx.lineTo(f.uvB.x * w, (1 - f.uvB.y) * h);
                            ctx.lineTo(f.uvC.x * w, (1 - f.uvC.y) * h);
                            ctx.closePath();
                            ctx.fill();
                            ctx.stroke();
                        });

                        layers.push({
                            prompt: layer.prompt,
                            mask: hiddenCanvas.toDataURL("image/png")
                        });
                    });

                    const payload = {
                        layers: layers,
                        cavity: currentBakedCavity
                    };

                    this.painterDataWidget.value = JSON.stringify(payload);
                };

                // --- Three.js Initialization ---
                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0x222222);

                const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
                camera.position.set(0, 0, 5);

                const renderer = new THREE.WebGLRenderer({ antialias: true });
                // We will set size in ResizeObserver
                leftPane.appendChild(renderer.domElement);

                // OrbitControls attached ONLY to renderer.domElement (Left Pane)
                const controls = new OrbitControls(camera, renderer.domElement);
                controls.enableDamping = false;
                
                let isDragging = false;
                controls.addEventListener('start', () => {
                    isDragging = true;
                    handleHover(-1); // Clear hover highlights when starting to drag
                });
                controls.addEventListener('end', () => {
                    isDragging = false;
                });

                // Lighting
                const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
                scene.add(ambientLight);
                const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
                dirLight.position.set(10, 20, 10);
                scene.add(dirLight);

                // --- Normal Map Baker Setup ---
                const bakeWidth = 1024;
                const bakeHeight = 1024;
                const renderTarget = new THREE.WebGLRenderTarget(bakeWidth, bakeHeight);
                const rtCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

                function bakeCavityMap(object) {
                    const originalMaterials = new Map();
                    const originalVisibility = new Map();

                    const depthShaderMaterial = new THREE.ShaderMaterial({
                        vertexShader: `
                            varying vec3 vNormal;
                            void main() {
                                // Transform normal to view space for lighting
                                vNormal = normalize(normalMatrix * normal);
                                // Flatten the mesh to the 2D UV layout space
                                gl_Position = vec4((uv.x * 2.0) - 1.0, (uv.y * 2.0) - 1.0, 0.0, 1.0);
                            }
                        `,
                        fragmentShader: `
                            varying vec3 vNormal;
                            void main() {
                                // Fake a directional light coming from an angle
                                vec3 lightDir = normalize(vec3(0.5, 0.8, 1.0));
                                // Calculate grayscale shading based on normal angles
                                float intensity = abs(dot(vNormal, lightDir));
                                // Add a base ambient brightness so shadows aren't pitch black
                                float light = intensity * 0.7 + 0.3;
                                gl_FragColor = vec4(vec3(light), 1.0);
                            }
                        `,
                        side: THREE.DoubleSide
                    });

                    object.traverse((child) => {
                        originalVisibility.set(child, child.visible);
                        if (child.isMesh) {
                            originalMaterials.set(child, child.material);
                            child.material = depthShaderMaterial;
                        } else if (child.isLine || child.isLineSegments) {
                            child.visible = false;
                        }
                    });

                    const tempScene = new THREE.Scene();
                    tempScene.add(object);

                    const bakeLight = new THREE.DirectionalLight(0xffffff, 1.5);
                    bakeLight.position.set(0, 0, 10);
                    tempScene.add(bakeLight);

                    const currentRenderTarget = renderer.getRenderTarget();
                    const currentClearColor = renderer.getClearColor(new THREE.Color());
                    const currentClearAlpha = renderer.getClearAlpha();

                    renderer.setRenderTarget(renderTarget);
                    renderer.setClearColor(0x000000, 1.0);
                    renderer.clear();
                    renderer.render(tempScene, rtCamera);

                    const buffer = new Uint8Array(bakeWidth * bakeHeight * 4);
                    renderer.readRenderTargetPixels(renderTarget, 0, 0, bakeWidth, bakeHeight, buffer);

                    renderer.setRenderTarget(currentRenderTarget);
                    renderer.setClearColor(currentClearColor, currentClearAlpha);

                    scene.add(object);

                    object.traverse((child) => {
                        child.visible = originalVisibility.get(child);
                        if (child.isMesh) {
                            child.material = originalMaterials.get(child);
                        }
                    });

                    const canvas = document.createElement('canvas');
                    canvas.width = bakeWidth;
                    canvas.height = bakeHeight;
                    const ctx = canvas.getContext('2d');
                    const imgData = new ImageData(new Uint8ClampedArray(buffer), bakeWidth, bakeHeight);
                    ctx.putImageData(imgData, 0, 0);

                    const flippedCanvas = document.createElement('canvas');
                    flippedCanvas.width = bakeWidth;
                    flippedCanvas.height = bakeHeight;
                    const flippedCtx = flippedCanvas.getContext('2d');
                    flippedCtx.translate(0, bakeHeight);
                    flippedCtx.scale(1, -1);
                    flippedCtx.drawImage(canvas, 0, 0);

                    console.log("Cavity Map Baked successfully.");
                    return flippedCanvas.toDataURL('image/png');
                }

                function drawFullUVWireframe(geometry, ctx) {
                    const uvAttr = geometry.attributes.uv;
                    if (!uvAttr) return;

                    const index = geometry.index;
                    const w = canvas2d.width;
                    const h = canvas2d.height;

                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; // Faint white lines
                    ctx.lineWidth = 1;
                    ctx.beginPath();

                    if (index) {
                        for (let i = 0; i < index.count; i += 3) {
                            const a = index.getX(i);
                            const b = index.getX(i + 1);
                            const c = index.getX(i + 2);

                            ctx.moveTo(uvAttr.getX(a) * w, (1 - uvAttr.getY(a)) * h);
                            ctx.lineTo(uvAttr.getX(b) * w, (1 - uvAttr.getY(b)) * h);
                            ctx.lineTo(uvAttr.getX(c) * w, (1 - uvAttr.getY(c)) * h);
                            ctx.lineTo(uvAttr.getX(a) * w, (1 - uvAttr.getY(a)) * h);
                        }
                    } else {
                        for (let i = 0; i < uvAttr.count; i += 3) {
                            ctx.moveTo(uvAttr.getX(i) * w, (1 - uvAttr.getY(i)) * h);
                            ctx.lineTo(uvAttr.getX(i + 1) * w, (1 - uvAttr.getY(i + 1)) * h);
                            ctx.lineTo(uvAttr.getX(i + 2) * w, (1 - uvAttr.getY(i + 2)) * h);
                            ctx.lineTo(uvAttr.getX(i) * w, (1 - uvAttr.getY(i)) * h);
                        }
                    }
                    ctx.stroke();
                }

                // Load 3D model logic
                fileInput.addEventListener("change", (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    const filename = file.name.toLowerCase();
                    const url = URL.createObjectURL(file);

                    let loader;
                    if (filename.endsWith(".gltf") || filename.endsWith(".glb")) {
                        loader = new GLTFLoader();
                    } else if (filename.endsWith(".fbx")) {
                        loader = new FBXLoader();
                    } else {
                        loader = new OBJLoader(); // fallback/default to obj
                    }

                    loader.load(url, (loadedData) => {
                        if (currentMesh) {
                            scene.remove(currentMesh);
                            currentMesh.traverse((child) => {
                                if (child.isMesh) {
                                    if (child.geometry) child.geometry.dispose();
                                    if (child.material) {
                                        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                                        else child.material.dispose();
                                    }
                                }
                            });
                        }

                        // Full state reset
                        Object.keys(maskState).forEach(key => delete maskState[key]);
                        promptStack.innerHTML = '';
                        layerCount = 0;
                        activeLayerId = null;
                        
                        if (activeHighlightMesh) {
                            scene.remove(activeHighlightMesh);
                            activeHighlightMesh = null;
                        }
                        if (recordedHighlightMesh) {
                            scene.remove(recordedHighlightMesh);
                            recordedHighlightMesh = null;
                        }
                        
                        const ctx2d = canvas2d.getContext('2d');
                        ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
                        const hCtx = highlightCanvas2d.getContext('2d');
                        hCtx.clearRect(0, 0, highlightCanvas2d.width, highlightCanvas2d.height);

                        // GLTFLoader returns an object where the mesh is in loadedData.scene
                        let object = loadedData.scene || loadedData;
                        currentMesh = object;

                        // Apply white material and dark wireframe
                        object.traverse((child) => {
                            if (child.isMesh) {
                                child.material = new THREE.MeshStandardMaterial({
                                    color: 0xffffff,
                                    roughness: 0.5,
                                    metalness: 0.1
                                });

                                // Add wireframe
                                const wireframeGeometry = new THREE.WireframeGeometry(child.geometry);
                                const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
                                const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
                                child.add(wireframe);

                                // Build per-mesh UV maps
                                if (!child.userData.uvMapBuilt) {
                                    buildUVMap(child);
                                    child.userData.uvMapBuilt = true;
                                }
                                drawFullUVWireframe(child.geometry, canvas2d.getContext('2d'));
                            }
                        });

                        // Center and scale object
                        const box = new THREE.Box3().setFromObject(object);
                        const size = box.getSize(new THREE.Vector3()).length();
                        const center = box.getCenter(new THREE.Vector3());

                        object.position.x += (object.position.x - center.x);
                        object.position.y += (object.position.y - center.y);
                        object.position.z += (object.position.z - center.z);

                        camera.position.copy(center);
                        camera.position.z += size * 1.5;
                        camera.lookAt(center);
                        controls.target.copy(center);
                        controls.update();

                        scene.add(object);

                        loadingOverlay.style.display = 'flex';

                        requestAnimationFrame(() => {
                            setTimeout(() => {
                                currentBakedCavity = bakeCavityMap(object);
                                redrawMasks();
                                syncData();
                                loadingOverlay.style.display = 'none';
                            }, 50);
                        });

                        URL.revokeObjectURL(url);
                    });
                });

                // Raycasting & Click Logic
                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2();

                renderer.domElement.addEventListener('pointerdown', (e) => {
                    const rect = renderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                    raycaster.setFromCamera(mouse, camera);
                    const intersects = raycaster.intersectObjects(scene.children, true);

                    if (intersects.length > 0) {
                        const hit = intersects.find(i => i.object.isMesh && i.face && i.object !== activeHighlightMesh && i.object !== recordedHighlightMesh);
                        if (hit && hit.object.geometry && hit.object.geometry.attributes.uv) {
                            handleFaceClick(hit);
                        }
                    }
                });

                let hoverTimeout = null;
                renderer.domElement.addEventListener('mousemove', (e) => {
                    if (isDragging) return;
                    
                    const rect = renderer.domElement.getBoundingClientRect();
                    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                    if (hoverTimeout) clearTimeout(hoverTimeout);
                    
                    hoverTimeout = setTimeout(() => {
                        raycaster.setFromCamera(mouse, camera);
                        const intersects = raycaster.intersectObjects(scene.children, true);
                        const hit = intersects.find(i => i.object.isMesh && i.face && i.object !== activeHighlightMesh && i.object !== recordedHighlightMesh);
                        if (hit) {
                            handleHover(hit);
                        } else {
                            handleHover(null);
                        }
                    }, 50); // only calculate when completely static for 50ms
                });

                renderer.domElement.addEventListener('mouseleave', () => handleHover(null));

                function handleFaceClick(hit) {
                    const isIslandMode = islandRadio.checked;
                    const startFaceIndex = hit.faceIndex;

                    if (!activeLayerId || !maskState[activeLayerId]) {
                        createNewLayer();
                    }
                    const layerId = activeLayerId;

                    let facesToProcess = [startFaceIndex];
                    if (isIslandMode) {
                        facesToProcess = getUVIslandFaces(hit.object, startFaceIndex);
                    }

                    const uvAttr = hit.object.geometry.attributes.uv;
                    const posAttr = hit.object.geometry.attributes.position;
                    const index = hit.object.geometry.index;

                    const faceDataArray = [];

                    facesToProcess.forEach(fIdx => {
                        if (maskState[layerId].faces.some(f => f.faceIndex === fIdx && f.meshUuid === hit.object.uuid)) return;

                        let a, b, c;
                        if (index) {
                            a = index.getX(fIdx * 3); b = index.getX(fIdx * 3 + 1); c = index.getX(fIdx * 3 + 2);
                        } else {
                            a = fIdx * 3; b = fIdx * 3 + 1; c = fIdx * 3 + 2;
                        }

                        const uvA = { x: uvAttr.getX(a), y: uvAttr.getY(a) };
                        const uvB = { x: uvAttr.getX(b), y: uvAttr.getY(b) };
                        const uvC = { x: uvAttr.getX(c), y: uvAttr.getY(c) };

                        const vA = new THREE.Vector3(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a)).applyMatrix4(hit.object.matrixWorld);
                        const vB = new THREE.Vector3(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b)).applyMatrix4(hit.object.matrixWorld);
                        const vC = new THREE.Vector3(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c)).applyMatrix4(hit.object.matrixWorld);

                        faceDataArray.push({ meshUuid: hit.object.uuid, faceIndex: fIdx, uvA, uvB, uvC, vA, vB, vC });
                    });

                    if (faceDataArray.length > 0) {
                        maskState[layerId].faces.push(...faceDataArray);
                        redrawMasks();
                    }
                }

                function redrawMasks() {
                    const w = canvas2d.width;
                    const h = canvas2d.height;

                    const drawOnCtx = (canvas, isHidden) => {
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, w, h);

                        if (!isHidden && currentMesh) {
                            currentMesh.traverse((child) => {
                                if (child.isMesh && child.geometry) {
                                    drawFullUVWireframe(child.geometry, ctx);
                                }
                            });
                        }

                        Object.entries(maskState).forEach(([layerId, layer]) => {
                            const isActive = (layerId === activeLayerId);
                            
                            if (isHidden) {
                                ctx.fillStyle = '#ffffff';
                                ctx.strokeStyle = '#ffffff';
                            } else {
                                ctx.fillStyle = isActive ? 'rgba(76, 175, 80, 0.65)' : 'rgba(100, 150, 255, 0.5)';
                                ctx.strokeStyle = isActive ? 'rgba(76, 175, 80, 0.65)' : 'rgba(100, 150, 255, 0.5)';
                            }
                            ctx.lineWidth = 1;

                            layer.faces.forEach(f => {
                                ctx.beginPath();
                                ctx.moveTo(f.uvA.x * w, (1 - f.uvA.y) * h);
                                ctx.lineTo(f.uvB.x * w, (1 - f.uvB.y) * h);
                                ctx.lineTo(f.uvC.x * w, (1 - f.uvC.y) * h);
                                ctx.closePath();
                                ctx.fill();
                                ctx.stroke();
                            });
                        });
                    };

                    drawOnCtx(canvas2d, false);
                    // hiddenCanvas is now updated during syncData() per layer, 
                    // but we can leave the overall hiddenCanvas draw here or remove it. 
                    // Let's omit drawOnCtx(hiddenCanvas, true) because syncData does it.


                    if (recordedHighlightMesh) {
                        scene.remove(recordedHighlightMesh);
                        recordedHighlightMesh = null;
                    }

                    let totalRecordedFaces = 0;
                    Object.values(maskState).forEach(m => { totalRecordedFaces += m.faces.length; });
                    if (totalRecordedFaces > 0) {
                        const vertices = new Float32Array(totalRecordedFaces * 9);
                        const colors = new Float32Array(totalRecordedFaces * 9);
                        let i = 0;
                        Object.entries(maskState).forEach(([layerId, m]) => {
                            const isActive = (layerId === activeLayerId);
                            const r = isActive ? 0.298 : 0.353;
                            const g = isActive ? 0.686 : 0.498;
                            const b = isActive ? 0.314 : 0.659;
                            m.faces.forEach(f => {
                                vertices[i * 9 + 0] = f.vA.x; vertices[i * 9 + 1] = f.vA.y; vertices[i * 9 + 2] = f.vA.z;
                                vertices[i * 9 + 3] = f.vB.x; vertices[i * 9 + 4] = f.vB.y; vertices[i * 9 + 5] = f.vB.z;
                                vertices[i * 9 + 6] = f.vC.x; vertices[i * 9 + 7] = f.vC.y; vertices[i * 9 + 8] = f.vC.z;
                                
                                colors[i * 9 + 0] = r; colors[i * 9 + 1] = g; colors[i * 9 + 2] = b;
                                colors[i * 9 + 3] = r; colors[i * 9 + 4] = g; colors[i * 9 + 5] = b;
                                colors[i * 9 + 6] = r; colors[i * 9 + 7] = g; colors[i * 9 + 8] = b;
                                i++;
                            });
                        });
                        const geom = new THREE.BufferGeometry();
                        geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
                        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                        const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.65, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
                        recordedHighlightMesh = new THREE.Mesh(geom, mat);
                        scene.add(recordedHighlightMesh);
                    }
                    syncData();
                }

                let activeHighlightMesh = null;
                let recordedHighlightMesh = null;

                let currentHoverKey = 'none';
                let hoverInputRow = null;

                function handleHover(hit) {
                    if (!hit || !currentMesh) {
                        if (currentHoverKey === 'none') return;
                        currentHoverKey = 'none';
                        if (hoverInputRow) {
                            updateLayerUI();
                            hoverInputRow = null;
                        }
                        if (activeHighlightMesh) {
                            scene.remove(activeHighlightMesh);
                            activeHighlightMesh = null;
                        }
                        const ctx = highlightCanvas2d.getContext('2d');
                        ctx.clearRect(0, 0, highlightCanvas2d.width, highlightCanvas2d.height);
                        return;
                    }

                    const hitFaceIndex = hit.faceIndex;
                    const isIslandMode = islandRadio.checked;

                    let existingStateId = null;
                    for (const [key, mask] of Object.entries(maskState)) {
                        if (mask.faces.some(f => f.faceIndex === hitFaceIndex && f.meshUuid === hit.object.uuid)) {
                            existingStateId = key;
                            break;
                        }
                    }

                    let newHoverKey = 'none';
                    if (existingStateId) {
                        newHoverKey = `mask_${existingStateId}`;
                    } else if (isIslandMode) {
                        newHoverKey = `island_${hit.object.userData.faceToIslandId[hitFaceIndex]}_${hit.object.uuid}`;
                    } else {
                        newHoverKey = `face_${hitFaceIndex}_${hit.object.uuid}`;
                    }

                    if (newHoverKey === currentHoverKey) return;
                    currentHoverKey = newHoverKey;

                    if (hoverInputRow) {
                        updateLayerUI();
                        hoverInputRow = null;
                    }
                    if (activeHighlightMesh) {
                        scene.remove(activeHighlightMesh);
                        activeHighlightMesh = null;
                    }
                    const ctx = highlightCanvas2d.getContext('2d');
                    ctx.clearRect(0, 0, highlightCanvas2d.width, highlightCanvas2d.height);

                    let facesToProcess = [hitFaceIndex];
                    let highlightColor = 'rgba(255, 255, 0, 0.5)';
                    let highlightColorHex = 0xffff00;

                    if (existingStateId) {
                        highlightColor = 'rgba(0, 170, 255, 0.7)';
                        highlightColorHex = 0x00aaff;
                        facesToProcess = maskState[existingStateId].faces.map(f => f.faceIndex);

                        hoverInputRow = maskState[existingStateId].inputRow;
                        hoverInputRow.style.background = 'rgba(0,170,255,0.4)';
                    } else if (isIslandMode) {
                        facesToProcess = getUVIslandFaces(hit.object, hitFaceIndex);
                    }

                    const uvAttr = hit.object.geometry.attributes.uv;
                    const posAttr = hit.object.geometry.attributes.position;
                    const index = hit.object.geometry.index;

                    const vertices = new Float32Array(facesToProcess.length * 9);

                    ctx.fillStyle = highlightColor;

                    facesToProcess.forEach((fIdx, i) => {
                        let a, b, c;
                        if (index) {
                            a = index.getX(fIdx * 3); b = index.getX(fIdx * 3 + 1); c = index.getX(fIdx * 3 + 2);
                        } else {
                            a = fIdx * 3; b = fIdx * 3 + 1; c = fIdx * 3 + 2;
                        }

                        const uvA = { x: uvAttr.getX(a), y: uvAttr.getY(a) };
                        const uvB = { x: uvAttr.getX(b), y: uvAttr.getY(b) };
                        const uvC = { x: uvAttr.getX(c), y: uvAttr.getY(c) };

                        ctx.beginPath();
                        ctx.moveTo(uvA.x * highlightCanvas2d.width, (1 - uvA.y) * highlightCanvas2d.height);
                        ctx.lineTo(uvB.x * highlightCanvas2d.width, (1 - uvB.y) * highlightCanvas2d.height);
                        ctx.lineTo(uvC.x * highlightCanvas2d.width, (1 - uvC.y) * highlightCanvas2d.height);
                        ctx.closePath();
                        ctx.fill();

                        const vA = new THREE.Vector3(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a)).applyMatrix4(hit.object.matrixWorld);
                        const vB = new THREE.Vector3(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b)).applyMatrix4(hit.object.matrixWorld);
                        const vC = new THREE.Vector3(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c)).applyMatrix4(hit.object.matrixWorld);

                        vertices[i * 9 + 0] = vA.x; vertices[i * 9 + 1] = vA.y; vertices[i * 9 + 2] = vA.z;
                        vertices[i * 9 + 3] = vB.x; vertices[i * 9 + 4] = vB.y; vertices[i * 9 + 5] = vB.z;
                        vertices[i * 9 + 6] = vC.x; vertices[i * 9 + 7] = vC.y; vertices[i * 9 + 8] = vC.z;
                    });

                    const geom = new THREE.BufferGeometry();
                    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
                    const mat = new THREE.MeshBasicMaterial({ color: highlightColorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
                    activeHighlightMesh = new THREE.Mesh(geom, mat);
                    scene.add(activeHighlightMesh);
                }

                function updateLayerUI() {
                    Object.entries(maskState).forEach(([stateId, layer]) => {
                        if (stateId === activeLayerId) {
                            layer.inputRow.style.background = 'rgba(46, 125, 50, 0.6)'; // Darker green for active layer
                            layer.inputRow.style.border = '1px solid #4CAF50';
                        } else {
                            layer.inputRow.style.background = 'rgba(0,0,0,0.7)';
                            layer.inputRow.style.border = '1px solid transparent';
                        }
                    });
                }

                function createNewLayer() {
                    layerCount++;
                    const id = layerCount;
                    const stateId = `layer_${id}`;

                    const row = document.createElement('div');
                    row.style.marginBottom = '5px';
                    row.style.background = 'rgba(0,0,0,0.7)';
                    row.style.padding = '8px';
                    row.style.borderRadius = '4px';
                    row.style.display = 'flex';
                    row.style.flexDirection = 'column';
                    row.style.transition = 'background 0.2s';

                    const header = document.createElement('div');
                    header.style.display = 'flex';
                    header.style.justifyContent = 'space-between';
                    header.style.alignItems = 'center';
                    header.style.marginBottom = '4px';

                    const leftHeader = document.createElement('div');
                    leftHeader.style.display = 'flex';
                    leftHeader.style.alignItems = 'center';
                    leftHeader.style.gap = '5px';

                    const radioBtn = document.createElement('input');
                    radioBtn.type = 'radio';
                    radioBtn.name = 'activeLayer';
                    radioBtn.value = stateId;
                    radioBtn.style.cursor = 'pointer';
                    radioBtn.addEventListener('change', () => {
                        if (radioBtn.checked) {
                            activeLayerId = stateId;
                            updateLayerUI();
                            redrawMasks();
                        }
                    });

                    const label = document.createElement('div');
                    label.innerText = `Layer ${id}`;
                    label.style.fontSize = '12px';
                    label.style.color = '#fff';

                    leftHeader.appendChild(radioBtn);
                    leftHeader.appendChild(label);

                    const delBtn = document.createElement('button');
                    delBtn.innerText = 'Delete';
                    delBtn.style.fontSize = '10px';
                    delBtn.style.background = '#d9534f';
                    delBtn.style.color = '#fff';
                    delBtn.style.border = 'none';
                    delBtn.style.borderRadius = '2px';
                    delBtn.style.cursor = 'pointer';
                    delBtn.addEventListener('click', () => {
                        delete maskState[stateId];
                        row.remove();
                        if (activeLayerId === stateId) {
                            activeLayerId = null;
                            const layers = Object.keys(maskState);
                            if (layers.length > 0) {
                                activeLayerId = layers[0];
                                maskState[activeLayerId].inputRow.querySelector('input[type="radio"]').checked = true;
                            }
                        }
                        updateLayerUI();
                        redrawMasks();
                        if (activeHighlightMesh) {
                            scene.remove(activeHighlightMesh);
                            activeHighlightMesh = null;
                        }
                    });

                    header.appendChild(leftHeader);
                    header.appendChild(delBtn);

                    const input = document.createElement('input');
                    input.className = 'prompt-input';
                    input.type = 'text';
                    input.placeholder = 'Enter prompt...';
                    input.style.width = '100%';
                    input.style.boxSizing = 'border-box';
                    input.style.padding = '4px';
                    input.style.background = '#333';
                    input.style.color = '#fff';
                    input.style.border = '1px solid #555';
                    input.style.borderRadius = '2px';

                    input.addEventListener('input', (e) => {
                        maskState[stateId].prompt = e.target.value;
                        syncData();
                    });

                    row.appendChild(header);
                    row.appendChild(input);
                    promptStack.appendChild(row);

                    maskState[stateId] = { id, prompt: '', faces: [], inputRow: row };
                    activeLayerId = stateId;
                    radioBtn.checked = true;
                    updateLayerUI();
                    redrawMasks();

                    row.addEventListener('mouseenter', () => {
                        row.style.background = 'rgba(100,100,100,0.7)';
                        const ctx = highlightCanvas2d.getContext('2d');
                        ctx.clearRect(0, 0, highlightCanvas2d.width, highlightCanvas2d.height);
                        if (maskState[stateId].faces.length === 0) return;

                        ctx.fillStyle = 'rgba(0, 170, 255, 0.7)';
                        const vertices = new Float32Array(maskState[stateId].faces.length * 9);

                        maskState[stateId].faces.forEach((f, i) => {
                            ctx.beginPath();
                            ctx.moveTo(f.uvA.x * highlightCanvas2d.width, (1 - f.uvA.y) * highlightCanvas2d.height);
                            ctx.lineTo(f.uvB.x * highlightCanvas2d.width, (1 - f.uvB.y) * highlightCanvas2d.height);
                            ctx.lineTo(f.uvC.x * highlightCanvas2d.width, (1 - f.uvC.y) * highlightCanvas2d.height);
                            ctx.closePath();
                            ctx.fill();

                            vertices[i * 9 + 0] = f.vA.x; vertices[i * 9 + 1] = f.vA.y; vertices[i * 9 + 2] = f.vA.z;
                            vertices[i * 9 + 3] = f.vB.x; vertices[i * 9 + 4] = f.vB.y; vertices[i * 9 + 5] = f.vB.z;
                            vertices[i * 9 + 6] = f.vC.x; vertices[i * 9 + 7] = f.vC.y; vertices[i * 9 + 8] = f.vC.z;
                        });

                        if (activeHighlightMesh) scene.remove(activeHighlightMesh);
                        const geom = new THREE.BufferGeometry();
                        geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
                        const mat = new THREE.MeshBasicMaterial({ color: 0x00aaff, side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthTest: false });
                        activeHighlightMesh = new THREE.Mesh(geom, mat);
                        scene.add(activeHighlightMesh);
                    });

                    row.addEventListener('mouseleave', () => {
                        updateLayerUI();
                        const ctx = highlightCanvas2d.getContext('2d');
                        ctx.clearRect(0, 0, highlightCanvas2d.width, highlightCanvas2d.height);
                        if (activeHighlightMesh) {
                            scene.remove(activeHighlightMesh);
                            activeHighlightMesh = null;
                        }
                    });
                }

                newLayerBtn.addEventListener('click', createNewLayer);

                // Animation loop
                let animationId;
                const animate = function () {
                    animationId = requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                };
                animate();

                // Clean up on remove
                this.onRemoved = function () {
                    cancelAnimationFrame(animationId);
                    if (this.domContainer) {
                        this.domContainer.remove();
                    }
                    if (onRemoved) onRemoved.apply(this, arguments);
                };

                // Handle Resizing using ResizeObserver
                const resizeObserver = new ResizeObserver(entries => {
                    for (let entry of entries) {
                        if (entry.target === leftPane) {
                            const { width, height } = entry.contentRect;
                            if (width > 0 && height > 0) {
                                camera.aspect = width / height;
                                camera.updateProjectionMatrix();
                                renderer.setSize(width, height);
                            }
                        } else if (entry.target === rightPane) {
                            // Canvas scales automatically via CSS object-fit, preserving internal 1024x1024 resolution and drawing history.
                        }
                    }
                });

                resizeObserver.observe(leftPane);
                resizeObserver.observe(rightPane);

                function getHitFaceIndex2D(clientX, clientY) {
                    if (!currentGeometry) return -1;
                    const rect = canvas2d.getBoundingClientRect();
                    const x = clientX - rect.left;
                    const y = clientY - rect.top;

                    const imgAspect = 1.0;
                    const canvasAspect = rect.width / rect.height;
                    let renderWidth = rect.width, renderHeight = rect.height, offsetX = 0, offsetY = 0;
                    if (canvasAspect > imgAspect) {
                        renderWidth = rect.height * imgAspect; offsetX = (rect.width - renderWidth) / 2;
                    } else {
                        renderHeight = rect.width / imgAspect; offsetY = (rect.height - renderHeight) / 2;
                    }

                    const px = x - offsetX, py = y - offsetY;
                    if (px < 0 || px > renderWidth || py < 0 || py > renderHeight) return -1;

                    const u = px / renderWidth; const v = 1.0 - (py / renderHeight);

                    const uvAttr = currentGeometry.attributes.uv;
                    const index = currentGeometry.index;
                    const numFaces = index ? index.count / 3 : uvAttr.count / 3;

                    function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
                        const v0x = cx - ax, v0y = cy - ay;
                        const v1x = bx - ax, v1y = by - ay;
                        const v2x = px - ax, v2y = py - ay;
                        const dot00 = v0x * v0x + v0y * v0y;
                        const dot01 = v0x * v1x + v0y * v1y;
                        const dot02 = v0x * v2x + v0y * v2y;
                        const dot11 = v1x * v1x + v1y * v1y;
                        const dot12 = v1x * v2x + v1y * v2y;
                        const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
                        const baryU = (dot11 * dot02 - dot01 * dot12) * invDenom;
                        const baryV = (dot00 * dot12 - dot01 * dot02) * invDenom;
                        return (baryU >= 0) && (baryV >= 0) && (baryU + baryV < 1);
                    }

                    const uvArr = uvAttr.array;
                    const idxArr = index ? index.array : null;

                    for (let i = 0; i < numFaces; i++) {
                        let a, b, c;
                        if (idxArr) { a = idxArr[i * 3]; b = idxArr[i * 3 + 1]; c = idxArr[i * 3 + 2]; }
                        else { a = i * 3; b = i * 3 + 1; c = i * 3 + 2; }

                        if (pointInTriangle(u, v, uvArr[a * 2], uvArr[a * 2 + 1], uvArr[b * 2], uvArr[b * 2 + 1], uvArr[c * 2], uvArr[c * 2 + 1])) {
                            return i;
                        }
                    }
                    return -1;
                }

                // Add click and hover listeners to the UV canvas
                canvas2d.addEventListener('click', (e) => {
                    const hitFaceIndex = getHitFaceIndex2D(e.clientX, e.clientY);
                    if (hitFaceIndex !== -1 && currentRenderMesh) {
                        handleFaceClick({ faceIndex: hitFaceIndex, object: currentRenderMesh });
                    }
                });

                let lastCanvasMoveTime = 0;
                canvas2d.addEventListener('mousemove', (e) => {
                    if (isDragging) return;
                    
                    const now = Date.now();
                    if (now - lastCanvasMoveTime < 32) return; // limit to ~30fps
                    lastCanvasMoveTime = now;

                    const hitFaceIndex = getHitFaceIndex2D(e.clientX, e.clientY);
                    handleHover(hitFaceIndex);
                });

                canvas2d.addEventListener('mouseleave', () => handleHover(-1));
            };

            // Hook into drawing to track and align DOM element to node perfectly
            const onDrawBackground = nodeType.prototype.onDrawBackground;
            nodeType.prototype.onDrawBackground = function (ctx) {
                if (onDrawBackground) onDrawBackground.apply(this, arguments);

                if (this.flags.collapsed) {
                    if (this.domContainer && this.domContainer.style.display !== "none") {
                        this.domContainer.style.display = "none";
                    }
                    return;
                }

                if (this.domContainer && this.domContainer.style.display === "none") {
                    this.domContainer.style.display = "flex";
                }

                const titleHeight = LiteGraph.NODE_TITLE_HEIGHT || 30;

                const canvas = app.canvas;
                const scale = canvas.ds.scale;
                const offsetX = canvas.ds.offset[0];
                const offsetY = canvas.ds.offset[1];

                const nodeX = this.pos[0];
                const nodeY = this.pos[1];

                const canvasRect = canvas.canvas.getBoundingClientRect();

                const screenX = canvasRect.left + (nodeX + offsetX) * scale;
                const screenY = canvasRect.top + (nodeY + offsetY) * scale;

                // Define precise margins to clear the ports
                const leftMargin = 15;
                const rightMargin = 15;
                // Push the UI down 80px to clear the "image" input and the 3 output labels
                const topMargin = 80;
                const bottomMargin = 10;

                const finalX = screenX + leftMargin * scale;
                const finalY = screenY + (titleHeight + topMargin) * scale;

                if (this.domContainer) {
                    this.domContainer.style.transform = `translate(${finalX}px, ${finalY}px) scale(${scale})`;
                    this.domContainer.style.width = `${this.size[0] - leftMargin - rightMargin}px`;
                    this.domContainer.style.height = `${this.size[1] - titleHeight - topMargin - bottomMargin}px`;
                }
            };
        }
    }
});