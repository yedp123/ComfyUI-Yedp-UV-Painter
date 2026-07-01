import { app } from "../../../scripts/app.js";
import { ComfyWidgets } from "../../../scripts/widgets.js";
import { api } from "../../../scripts/api.js";

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

            function compressIndices(indicesArray) {
                if (!indicesArray || indicesArray.length === 0) return [];
                const sorted = [...indicesArray].sort((a, b) => a - b);
                const ranges = [];
                let start = sorted[0];
                let prev = start;
                for (let i = 1; i < sorted.length; i++) {
                    if (sorted[i] !== prev + 1 && sorted[i] !== prev) {
                        ranges.push([start, prev]);
                        start = sorted[i];
                    }
                    prev = sorted[i];
                }
                ranges.push([start, prev]);
                return ranges;
            }

            function decompressIndices(rangesArray) {
                if (!rangesArray || !Array.isArray(rangesArray)) return [];
                const indices = [];
                for (const range of rangesArray) {
                    if (Array.isArray(range) && range.length === 2) {
                        const [start, end] = range;
                        for (let i = start; i <= end; i++) {
                            indices.push(i);
                        }
                    } else if (typeof range === 'number') {
                        indices.push(range);
                    }
                }
                return indices;
            }

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
                // NOTE: position / transformOrigin / zIndex intentionally omitted --
                // addDOMWidget's wrapper owns positioning, scaling and stacking.
                // position:relative keeps internal absolute children (toolbar,
                // loadingOverlay) anchored to this container.
                this.domContainer.style.position = "relative";
                this.domContainer.style.width = "100%";
                this.domContainer.style.height = "100%";
                this.domContainer.style.boxSizing = "border-box";
                this.domContainer.style.display = "flex";
                this.domContainer.style.flexDirection = "column";
                this.domContainer.style.backgroundColor = "#111";
                this.domContainer.style.border = "1px solid #444";
                this.domContainer.style.borderRadius = "4px";
                this.domContainer.style.overflow = "hidden";

                // Top Bar
                const topBar = document.createElement("div");
                topBar.style.display = "flex";
                topBar.style.flexDirection = "row";
                topBar.style.justifyContent = "space-between";
                topBar.style.alignItems = "center";
                topBar.style.padding = "5px 10px";
                topBar.style.backgroundColor = "#222";
                topBar.style.borderBottom = "2px solid #333";

                // Main Area
                const mainArea = document.createElement("div");
                mainArea.style.display = "flex";
                mainArea.style.flexDirection = "row";
                mainArea.style.flex = "1";
                mainArea.style.overflow = "hidden";

                // Left Pane (3D Viewport)
                const leftPane = document.createElement("div");
                leftPane.style.flex = "1";
                leftPane.style.borderRight = "2px solid #333";
                leftPane.style.position = "relative";
                leftPane.style.overflow = "hidden";

                // Load .obj Button (moved to Top Bar)
                const loadContainer = document.createElement("div");
                loadContainer.style.backgroundColor = "rgba(0,0,0,0.6)";
                loadContainer.style.padding = "5px";
                loadContainer.style.borderRadius = "4px";

                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = ".obj,.gltf,.glb,.fbx";
                fileInput.style.color = "#fff";
                fileInput.style.fontSize = "12px";
                loadContainer.appendChild(fileInput);
                
                const leftControlsContainer = document.createElement("div");
                leftControlsContainer.style.display = "flex";
                leftControlsContainer.style.gap = "10px";
                leftControlsContainer.style.alignItems = "center";
                topBar.appendChild(leftControlsContainer);
                leftControlsContainer.appendChild(loadContainer);

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

                const symmetryLabel = document.createElement("label");
                symmetryLabel.style.cursor = "pointer";
                symmetryLabel.style.marginLeft = "15px";
                symmetryLabel.style.display = "flex";
                symmetryLabel.style.alignItems = "center";
                symmetryLabel.style.gap = "5px";
                
                const symmetryCheckbox = document.createElement("input");
                symmetryCheckbox.type = "checkbox";
                
                const symmetrySelect = document.createElement("select");
                symmetrySelect.style.background = "#333";
                symmetrySelect.style.color = "white";
                symmetrySelect.style.border = "1px solid #666";
                symmetrySelect.style.borderRadius = "3px";
                symmetrySelect.style.padding = "2px 5px";
                
                ['X', 'Y', 'Z'].forEach(axis => {
                    const opt = document.createElement("option");
                    opt.value = axis;
                    opt.innerText = axis;
                    symmetrySelect.appendChild(opt);
                });
                
                symmetryLabel.appendChild(symmetryCheckbox);
                symmetryLabel.appendChild(document.createTextNode("Symmetry"));
                symmetryLabel.appendChild(symmetrySelect);

                toolbar.appendChild(islandLabel);
                toolbar.appendChild(faceLabel);
                toolbar.appendChild(symmetryLabel);
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

                // Drawing Overlay Canvas
                const drawingCanvas = document.createElement("canvas");
                drawingCanvas.width = 1024;
                drawingCanvas.height = 1024;
                drawingCanvas.style.width = "100%";
                drawingCanvas.style.height = "100%";
                drawingCanvas.style.objectFit = "contain";
                drawingCanvas.style.display = "block";
                drawingCanvas.style.position = "absolute";
                drawingCanvas.style.top = "0";
                drawingCanvas.style.left = "0";
                drawingCanvas.style.pointerEvents = "none";
                rightPane.appendChild(drawingCanvas);

                // Brush UI Panel
                const brushUI = document.createElement("div");
                brushUI.style.position = "absolute";
                brushUI.style.top = "10px";
                brushUI.style.left = "10px";
                brushUI.style.background = "rgba(0, 0, 0, 0.7)";
                brushUI.style.padding = "10px";
                brushUI.style.borderRadius = "5px";
                brushUI.style.display = "none";
                brushUI.style.flexDirection = "column";
                brushUI.style.gap = "10px";
                brushUI.style.zIndex = "100";
                brushUI.style.color = "white";
                brushUI.style.fontFamily = "sans-serif";
                brushUI.style.fontSize = "12px";

                const brushSizeWrapper = document.createElement("div");
                brushSizeWrapper.style.display = "flex";
                brushSizeWrapper.style.alignItems = "center";
                brushSizeWrapper.style.gap = "10px";

                const brushSizeLabel = document.createElement("label");
                brushSizeLabel.innerText = "Size: 5";

                const brushSizeSlider = document.createElement("input");
                brushSizeSlider.type = "range";
                brushSizeSlider.min = "1";
                brushSizeSlider.max = "50";
                brushSizeSlider.value = "5";

                brushSizeSlider.addEventListener("input", (e) => {
                    currentBrushSize = parseInt(e.target.value, 10);
                    brushSizeLabel.innerText = `Size: ${currentBrushSize}`;
                });

                brushSizeWrapper.appendChild(brushSizeLabel);
                brushSizeWrapper.appendChild(brushSizeSlider);

                const brushToolsWrapper = document.createElement("div");
                brushToolsWrapper.style.display = "flex";
                brushToolsWrapper.style.gap = "5px";

                const paintBtn = document.createElement("button");
                paintBtn.innerHTML = "🖌️ Brush";
                paintBtn.style.flex = "1";
                paintBtn.style.padding = "5px";
                paintBtn.style.background = "#2196F3"; // Active by default
                paintBtn.style.color = "white";
                paintBtn.style.border = "1px solid #666";
                paintBtn.style.borderRadius = "4px";
                paintBtn.style.cursor = "pointer";

                const eraserBtn = document.createElement("button");
                eraserBtn.innerHTML = "🧽 Eraser";
                eraserBtn.style.flex = "1";
                eraserBtn.style.padding = "5px";
                eraserBtn.style.background = "#333";
                eraserBtn.style.color = "white";
                eraserBtn.style.border = "1px solid #666";
                eraserBtn.style.borderRadius = "4px";
                eraserBtn.style.cursor = "pointer";

                paintBtn.addEventListener("click", () => {
                    isEraserMode = false;
                    paintBtn.style.background = "#2196F3";
                    eraserBtn.style.background = "#333";
                });

                eraserBtn.addEventListener("click", () => {
                    isEraserMode = true;
                    eraserBtn.style.background = "#f44336";
                    paintBtn.style.background = "#333";
                });

                const clearBtn = document.createElement("button");
                clearBtn.innerHTML = "🗑️ Clear";
                clearBtn.style.padding = "5px 10px";
                clearBtn.style.background = "#f44336";
                clearBtn.style.color = "white";
                clearBtn.style.border = "1px solid #666";
                clearBtn.style.borderRadius = "4px";
                clearBtn.style.cursor = "pointer";
                clearBtn.style.fontWeight = "bold";

                clearBtn.addEventListener("click", () => {
                    if (activeLayerId && maskState[activeLayerId] && maskState[activeLayerId].strokes) {
                        maskState[activeLayerId].strokes = maskState[activeLayerId].strokes.filter(s => s.mode !== currentToolMode);
                        if (typeof redrawStrokes === 'function') redrawStrokes();
                        if (currentToolMode === 'SKETCH' && typeof updateLiveCannyPreview === 'function') {
                            updateLiveCannyPreview();
                        }
                    }
                });

                brushToolsWrapper.appendChild(paintBtn);
                brushToolsWrapper.appendChild(eraserBtn);
                brushToolsWrapper.appendChild(clearBtn);

                brushUI.appendChild(brushSizeWrapper);
                brushUI.appendChild(brushToolsWrapper);
                rightPane.appendChild(brushUI);

                // Brush Cursor — appended to document.body so position:fixed works
                const brushCursor = document.createElement("div");
                brushCursor.id = "brushCursor";
                brushCursor.style.position = "fixed";
                brushCursor.style.border = "1px solid white";
                brushCursor.style.borderRadius = "50%";
                brushCursor.style.pointerEvents = "none";
                brushCursor.style.transform = "translate(-50%, -50%)";
                brushCursor.style.display = "none";
                brushCursor.style.zIndex = "10000";
                brushCursor.style.boxShadow = "0 0 2px rgba(0,0,0,0.5)";
                document.body.appendChild(brushCursor);

                // Prompt Stack UI overlay (moved to right side panel)
                const promptStackContainer = document.createElement('div');
                promptStackContainer.style.width = '290px';
                promptStackContainer.style.minWidth = '290px';
                promptStackContainer.style.borderLeft = '2px solid #333';
                promptStackContainer.style.backgroundColor = '#222';
                promptStackContainer.style.display = 'flex';
                promptStackContainer.style.flexDirection = 'column';
                promptStackContainer.style.padding = '10px';
                promptStackContainer.style.boxSizing = 'border-box';

                const genStackContainer = document.createElement('div');
                genStackContainer.style.width = '290px';
                genStackContainer.style.minWidth = '290px';
                genStackContainer.style.borderLeft = '2px solid #333';
                genStackContainer.style.backgroundColor = '#222';
                genStackContainer.style.display = 'none';
                genStackContainer.style.flexDirection = 'column';
                genStackContainer.style.padding = '10px';
                genStackContainer.style.boxSizing = 'border-box';
                genStackContainer.style.overflowY = 'auto';

                function renderGenerationStack() {
                    genStackContainer.innerHTML = '';
                    const header = document.createElement('div');
                    header.innerText = 'Generation Stack';
                    header.style.color = '#fff';
                    header.style.fontWeight = 'bold';
                    header.style.marginBottom = '10px';
                    genStackContainer.appendChild(header);

                    generationStack.forEach((entry, index) => {
                        const row = document.createElement('div');
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.gap = '5px';
                        row.style.background = 'rgba(0,0,0,0.7)';
                        row.style.padding = '8px';
                        row.style.marginBottom = '5px';
                        row.style.borderRadius = '4px';

                        const eyeIcon = document.createElement('button');
                        eyeIcon.innerText = '👁️';
                        eyeIcon.style.background = 'none';
                        eyeIcon.style.border = 'none';
                        eyeIcon.style.cursor = 'pointer';
                        eyeIcon.style.opacity = entry.isVisible ? '1' : '0.3';
                        eyeIcon.onclick = () => {
                            entry.isVisible = !entry.isVisible;
                            renderGenerationStack();
                            if (typeof compositeFinalTexture === 'function') compositeFinalTexture();
                        };

                        const lockIcon = document.createElement('button');
                        lockIcon.innerText = '🔒';
                        lockIcon.style.background = 'none';
                        lockIcon.style.border = 'none';
                        lockIcon.style.cursor = 'pointer';
                        lockIcon.style.opacity = entry.isLocked ? '1' : '0.3';
                        lockIcon.onclick = () => {
                            entry.isLocked = !entry.isLocked;
                            renderGenerationStack();
                        };

                        const titleDiv = document.createElement('div');
                        titleDiv.style.flex = '1';
                        titleDiv.style.color = '#fff';
                        titleDiv.style.fontSize = '12px';
                        titleDiv.innerHTML = `<strong>${entry.layerName}</strong><br><span style="color:#aaa;font-size:10px">Depends on: ${entry.linkedUvGroupId}</span>`;

                        const delBtn = document.createElement('button');
                        delBtn.innerText = 'Del';
                        delBtn.style.fontSize = '10px';
                        delBtn.style.background = '#d9534f';
                        delBtn.style.color = '#fff';
                        delBtn.style.border = 'none';
                        delBtn.style.borderRadius = '2px';
                        delBtn.style.cursor = 'pointer';
                        delBtn.onclick = () => {
                            generationStack.splice(index, 1);
                            renderGenerationStack();
                        };

                        row.appendChild(eyeIcon);
                        row.appendChild(lockIcon);
                        row.appendChild(titleDiv);
                        row.appendChild(delBtn);

                        genStackContainer.appendChild(row);
                    });

                    // ADD THE EXPORT BUTTON
                    if (!document.getElementById('export-gen-btn') && generationStack.length > 0) {
                        const exportBtn = document.createElement('button');
                        exportBtn.id = 'export-gen-btn';
                        exportBtn.innerText = '💾 Export Final Texture';
                        exportBtn.style.marginTop = '15px';
                        exportBtn.style.padding = '8px';
                        exportBtn.style.background = '#1976D2';
                        exportBtn.style.color = '#fff';
                        exportBtn.style.border = 'none';
                        exportBtn.style.borderRadius = '4px';
                        exportBtn.style.cursor = 'pointer';
                        exportBtn.style.fontWeight = 'bold';
                        
                        exportBtn.onclick = async () => {
                            const textureUrl = await compositeFinalTexture();
                            if (textureUrl) {
                                // Just download the file directly from ComfyUI's output folder
                                const a = document.createElement('a');
                                a.href = textureUrl;
                                a.download = 'yedp_generated_texture.png';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            } else {
                                alert("No visible texture to export!");
                            }
                        };
                        genStackContainer.appendChild(exportBtn);
                    }
                }

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

                const wireframeControls = document.createElement('div');
                wireframeControls.style.position = 'absolute';
                wireframeControls.style.bottom = '10px';
                wireframeControls.style.right = '10px';
                wireframeControls.style.zIndex = '100';
                wireframeControls.style.background = 'rgba(0,0,0,0.6)';
                wireframeControls.style.padding = '5px';
                wireframeControls.style.borderRadius = '4px';
                wireframeControls.style.display = 'flex';
                wireframeControls.style.alignItems = 'center';
                wireframeControls.style.gap = '5px';
                wireframeControls.style.color = 'white';
                wireframeControls.style.fontSize = '12px';
                wireframeControls.style.background = 'rgba(0,0,0,0.5)';
                wireframeControls.style.padding = '5px';
                wireframeControls.style.borderRadius = '4px';

                const toggleWireframe = document.createElement('input');
                toggleWireframe.type = 'checkbox';
                // Avoid global IDs, use scoped variable
                toggleWireframe.checked = true;

                const wireframeLabel = document.createElement('label');
                wireframeLabel.innerText = 'Show Topology';
                wireframeLabel.style.cursor = 'pointer';
                wireframeLabel.style.flex = '1';
                
                // Allow label to toggle checkbox
                wireframeLabel.addEventListener('click', () => {
                    toggleWireframe.checked = !toggleWireframe.checked;
                    toggleWireframe.dispatchEvent(new Event('change'));
                });

                const wireframeColor = document.createElement('input');
                wireframeColor.type = 'color';
                wireframeColor.value = '#00ff00';
                wireframeColor.style.height = '20px';
                wireframeColor.style.width = '24px';
                wireframeColor.style.padding = '0';
                wireframeColor.style.border = 'none';
                wireframeColor.style.cursor = 'pointer';

                wireframeControls.appendChild(toggleWireframe);
                wireframeControls.appendChild(wireframeLabel);
                wireframeControls.appendChild(wireframeColor);

                const toggleMasks = document.createElement('input');
                toggleMasks.type = 'checkbox';
                toggleMasks.checked = true;
                toggleMasks.style.marginLeft = '10px';

                const masksLabel = document.createElement('label');
                masksLabel.innerText = 'Show Masks';
                masksLabel.style.cursor = 'pointer';
                
                masksLabel.addEventListener('click', () => {
                    toggleMasks.checked = !toggleMasks.checked;
                    toggleMasks.dispatchEvent(new Event('change'));
                });

                toggleMasks.addEventListener('change', () => {
                    redrawMasks();
                });

                wireframeControls.appendChild(toggleMasks);
                wireframeControls.appendChild(masksLabel);

                // Move wireframe UI directly over the Three.js viewport
                leftPane.appendChild(wireframeControls);

                let currentToolMode = 'MASK';
                let currentBrushSize = 5;
                let isEraserMode = false;

                const toolModeContainer = document.createElement('div');
                toolModeContainer.style.display = 'flex';
                toolModeContainer.style.gap = '5px';

                const modes = [
                    { id: 'MASK', label: 'Select (Mask)' },
                    { id: 'SKETCH', label: 'Draw (Canny)' },
                    { id: 'STACK', label: 'Gen Stack' }
                ];

                modes.forEach(mode => {
                    const btn = document.createElement('button');
                    btn.innerText = mode.label;
                    btn.style.flex = '1';
                    btn.style.padding = '5px';
                    btn.style.fontSize = '11px';
                    btn.style.cursor = 'pointer';
                    btn.style.border = '1px solid #666';
                    btn.style.borderRadius = '4px';
                    btn.style.background = mode.id === 'MASK' ? '#2196F3' : '#333';
                    btn.style.color = '#fff';

                    btn.addEventListener('click', () => {
                        currentToolMode = mode.id;
                        Array.from(toolModeContainer.children).forEach(c => {
                            c.style.background = '#333';
                        });
                        btn.style.background = '#2196F3';
                        
                        // Update cursor
                        if (currentToolMode === 'SKETCH' || currentToolMode === 'PATCH') {
                            drawingCanvas.style.cursor = 'none';
                            canvas2d.style.cursor = 'none';
                            brushUI.style.display = 'flex';
                        } else {
                            drawingCanvas.style.cursor = 'default';
                            canvas2d.style.cursor = 'default';
                            if (typeof brushCursor !== 'undefined') brushCursor.style.display = 'none';
                            brushUI.style.display = 'none';
                        }
                        
                        // Handle panel visibility
                        if (currentToolMode === 'STACK') {
                            promptStackContainer.style.display = 'none';
                            genStackContainer.style.display = 'flex';
                            renderGenerationStack();
                        } else {
                            genStackContainer.style.display = 'none';
                            promptStackContainer.style.display = 'flex';
                        }
                        
                        // Clear any active selections/highlights when switching modes
                        if (currentToolMode !== 'MASK') {
                            handleHover(null);
                        }
                        
                        if (currentToolMode === 'SKETCH') {
                            if (typeof updateLiveCannyPreview === 'function') updateLiveCannyPreview();
                            if (currentMesh) {
                                currentMesh.traverse((child) => {
                                    if (child.isMesh) {
                                        if (!child.userData.originalMat) {
                                            child.userData.originalMat = child.material;
                                        }
                                        child.material = new THREE.MeshBasicMaterial({ map: liveCannyTexture });
                                        if (child.userData.wireframeHelper) {
                                            child.userData.wireframeHelper.visible = false;
                                        }
                                    }
                                });
                            }
                        } else {
                            if (currentMesh) {
                                currentMesh.traverse((child) => {
                                    if (child.isMesh) {
                                        if (child.userData.originalMat) {
                                            child.material = child.userData.originalMat;
                                            child.userData.originalMat = null;
                                        }
                                        if (child.userData.wireframeHelper) {
                                            child.userData.wireframeHelper.visible = toggleWireframe.checked;
                                        }
                                    }
                                });
                            }
                        }
                        
                        // Redraw strokes to toggle visibility
                        if (typeof redrawStrokes === 'function') redrawStrokes();
                    });
                    toolModeContainer.appendChild(btn);
                });

                topBar.appendChild(toolModeContainer);

                // Save / Load Project buttons
                const projectBtnContainer = document.createElement('div');
                projectBtnContainer.style.display = 'flex';
                projectBtnContainer.style.gap = '5px';

                const saveProjectBtn = document.createElement('button');
                saveProjectBtn.innerText = '💾 Save Project';
                saveProjectBtn.style.padding = '5px 10px';
                saveProjectBtn.style.fontSize = '11px';
                saveProjectBtn.style.cursor = 'pointer';
                saveProjectBtn.style.border = '1px solid #2e7d32';
                saveProjectBtn.style.borderRadius = '4px';
                saveProjectBtn.style.background = '#388E3C';
                saveProjectBtn.style.color = '#fff';
                saveProjectBtn.style.fontWeight = 'bold';
                saveProjectBtn.style.whiteSpace = 'nowrap';
                saveProjectBtn.addEventListener('mouseenter', () => { saveProjectBtn.style.background = '#43A047'; });
                saveProjectBtn.addEventListener('mouseleave', () => { saveProjectBtn.style.background = '#388E3C'; });

                const loadProjectBtn = document.createElement('button');
                loadProjectBtn.innerText = '📂 Load Project';
                loadProjectBtn.style.padding = '5px 10px';
                loadProjectBtn.style.fontSize = '11px';
                loadProjectBtn.style.cursor = 'pointer';
                loadProjectBtn.style.border = '1px solid #1565C0';
                loadProjectBtn.style.borderRadius = '4px';
                loadProjectBtn.style.background = '#1976D2';
                loadProjectBtn.style.color = '#fff';
                loadProjectBtn.style.fontWeight = 'bold';
                loadProjectBtn.style.whiteSpace = 'nowrap';
                loadProjectBtn.addEventListener('mouseenter', () => { loadProjectBtn.style.background = '#1E88E5'; });
                loadProjectBtn.addEventListener('mouseleave', () => { loadProjectBtn.style.background = '#1976D2'; });

                // Save Project Logic
                saveProjectBtn.addEventListener('click', () => {
                    console.log("💾 Packaging raw project data...");
                    const projectLayers = [];
                    Object.values(maskState).forEach(layer => {
                        // BUG FIX: Do not compress! Save full arrays and images to retain multi-mesh support!
                        projectLayers.push({
                            id: layer.id,
                            prompt: layer.prompt,
                            name: layer.inputRow.querySelectorAll('input[type="text"]')[0].value,
                            faces: layer.faces, 
                            strokes: layer.strokes || [],
                            mask: layer.savedMask || "",
                            sketch: layer.savedSketch || ""
                        });
                    });
                    const projectPayload = {
                        version: 1,
                        layers: projectLayers,
                        cavity: currentBakedCavity,
                        generationStack: generationStack
                    };
                    const jsonStr = JSON.stringify(projectPayload, null, 2);
                    const blob = new Blob([jsonStr], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'uv_painter_project.json';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                });

                // Load Project Logic
                loadProjectBtn.addEventListener('click', () => {
                    const fileInputProject = document.createElement('input');
                    fileInputProject.type = 'file';
                    fileInputProject.accept = '.json';
                    fileInputProject.style.display = 'none';
                    document.body.appendChild(fileInputProject);

                    fileInputProject.addEventListener('change', (evt) => {
                        const file = evt.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (readerEvt) => {
                            try {
                                const data = JSON.parse(readerEvt.target.result);
                                if (!data.layers || !Array.isArray(data.layers)) {
                                    console.error('UV Painter: Invalid project file — no layers array found.');
                                    return;
                                }

                                // Clear existing state
                                Object.keys(maskState).forEach(k => delete maskState[k]);
                                promptStack.innerHTML = '';
                                layerCount = 0;
                                activeLayerId = null;

                                // Set loading guard to prevent intermediate redraws/syncs
                                isLoadingProject = true;

                                // Rebuild layers
                                data.layers.forEach(l => {
                                    createNewLayer();
                                    const layerId = activeLayerId;
                                    const layerObj = maskState[layerId];

                                    layerObj.prompt = l.prompt || '';
                                    layerObj.inputRow.querySelector('.prompt-input').value = layerObj.prompt;

                                    const nameInput = layerObj.inputRow.querySelectorAll('input[type="text"]')[0];
                                    if (l.name && nameInput) {
                                        nameInput.value = l.name;
                                    }

                                    // BUG FIX: Restore full face arrays and re-instantiate Three.js Vectors
                                    if (l.faces && l.faces.length > 0) {
                                        layerObj.faces = l.faces;
                                        layerObj.faces.forEach(f => {
                                            if (f.vA) f.vA = new THREE.Vector3(f.vA.x, f.vA.y, f.vA.z);
                                            if (f.vB) f.vB = new THREE.Vector3(f.vB.x, f.vB.y, f.vB.z);
                                            if (f.vC) f.vC = new THREE.Vector3(f.vC.x, f.vC.y, f.vC.z);
                                        });
                                    } else {
                                        layerObj.faces = [];
                                    }

                                    layerObj.strokes = l.strokes || [];
                                    layerObj.savedMask = l.mask || "";
                                    layerObj.savedSketch = l.sketch || "";
                                });

                                if (data.cavity) {
                                    currentBakedCavity = data.cavity;
                                }

                                // Clear loading guard BEFORE redraw
                                isLoadingProject = false;
                                console.log("📂 Project parsing complete. Redrawing...");

                                redrawMasks();
                                syncData();
                                console.log('UV Painter: Project loaded successfully.');
                            } catch (err) {
                                isLoadingProject = false;
                                console.error('UV Painter: Failed to parse project file.', err);
                            }
                        };
                        reader.readAsText(file);
                        document.body.removeChild(fileInputProject);
                    });

                    fileInputProject.click();
                });

                projectBtnContainer.appendChild(saveProjectBtn);
                projectBtnContainer.appendChild(loadProjectBtn);
                leftControlsContainer.appendChild(projectBtnContainer);

                promptStackContainer.appendChild(newLayerBtn);
                promptStackContainer.appendChild(promptStack);

                toggleWireframe.addEventListener('change', (e) => {
                    if (currentMesh) {
                        currentMesh.traverse((child) => {
                            if (child.isMesh && child.userData.wireframeHelper) {
                                child.userData.wireframeHelper.visible = e.target.checked;
                            }
                        });
                    }
                });

                wireframeColor.addEventListener('input', (e) => {
                    if (currentMesh) {
                        currentMesh.traverse((child) => {
                            if (child.isMesh && child.userData.wireframeHelper) {
                                child.userData.wireframeHelper.material.color.set(e.target.value);
                            }
                        });
                    }
                });

                let layerCount = 0;
                let activeLayerId = null;
                const maskState = {};
                let generationStack = [];
                let currentMesh = null;
                let lastGeneratedImage = null;
                let isLoadingProject = false;
                let isSyncingData = false;
                let lastSyncTime = 0;

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

                function reconstructLayerObjects(rootObject) {
                    if (!rootObject) return;
                    let mesh = null;
                    rootObject.traverse((child) => {
                        if (child.isMesh && !mesh) mesh = child;
                    });
                    if (!mesh || !mesh.geometry) return;
                    
                    const uvAttr = mesh.geometry.attributes.uv;
                    const posAttr = mesh.geometry.attributes.position;
                    const index = mesh.geometry.index;
                    let needsSync = false;

                    Object.values(maskState).forEach(layer => {
                        if (layer.pendingFaceIndices) {
                            layer.faces = [];
                            layer.pendingFaceIndices.forEach(fIdx => {
                                let a, b, c;
                                if (index) {
                                    a = index.getX(fIdx * 3); b = index.getX(fIdx * 3 + 1); c = index.getX(fIdx * 3 + 2);
                                } else {
                                    a = fIdx * 3; b = fIdx * 3 + 1; c = fIdx * 3 + 2;
                                }

                                const uvA = { x: uvAttr.getX(a), y: uvAttr.getY(a) };
                                const uvB = { x: uvAttr.getX(b), y: uvAttr.getY(b) };
                                const uvC = { x: uvAttr.getX(c), y: uvAttr.getY(c) };

                                const vA = new THREE.Vector3(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a)).applyMatrix4(mesh.matrixWorld);
                                const vB = new THREE.Vector3(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b)).applyMatrix4(mesh.matrixWorld);
                                const vC = new THREE.Vector3(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c)).applyMatrix4(mesh.matrixWorld);

                                layer.faces.push({ meshUuid: mesh.uuid, faceIndex: fIdx, uvA, uvB, uvC, vA, vB, vC });
                            });
                            delete layer.pendingFaceIndices;
                            needsSync = true;
                        }
                    });

                    if (needsSync) {
                        redrawMasks();
                        syncData();
                    }
                }

                const hiddenCanvas = document.createElement('canvas');
                hiddenCanvas.width = 1024;
                hiddenCanvas.height = 1024;

                mainArea.appendChild(leftPane);
                mainArea.appendChild(rightPane);
                mainArea.appendChild(promptStackContainer);
                mainArea.appendChild(genStackContainer);
                this.domContainer.appendChild(topBar);
                this.domContainer.appendChild(mainArea);

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

                // Render the painter INLINE inside the node via ComfyUI's DOM-widget
                // layer. The widget wrapper owns position/transform/size and hides the
                // element when the node is collapsed or removed.
                this.uvWidget = this.addDOMWidget("uv_painter", "div", this.domContainer, {
                    serialize: false,
                    hideOnZoom: false,
                });

                let currentBakedCavity = null;

                // --- BULLETPROOF ALPHA-COMPOSITED TEXTURE COMPOSITOR ---
                // Loads all visible generation stack layers, masks each to its UV polygon
                // region using canvas compositing, and applies the result to the 3D mesh.
                // IMPORTANT: Defined at onNodeCreated scope so onNodeExecuted can access it.
                async function compositeFinalTexture() {
                    if (!currentMesh) return null;

                    const TEX_SIZE = 1024;

                    // ── 1. Collect visible layers (bottom-to-top order) ──
                    const visibleLayers = generationStack.filter(
                        entry => entry.isVisible && entry.generatedImage
                    );

                    // ── 2. If nothing is visible, clear the mesh and 2D preview ──
                    if (visibleLayers.length === 0) {
                        lastGeneratedImage = null;
                        redrawMasks();
                        currentMesh.traverse((child) => {
                            if (child.isMesh) {
                                const emptyMaterial = new THREE.MeshStandardMaterial({
                                    color: 0xffffff, roughness: 0.5
                                });
                                if (currentToolMode === 'SKETCH') {
                                    if (child.userData.originalMat) {
                                        if (child.userData.originalMat.map) child.userData.originalMat.map.dispose();
                                        child.userData.originalMat.dispose();
                                    }
                                    child.userData.originalMat = emptyMaterial;
                                } else {
                                    if (child.material) {
                                        if (child.material.map) child.material.map.dispose();
                                        child.material.dispose();
                                    }
                                    child.material = emptyMaterial;
                                    child.material.needsUpdate = true;
                                }
                            }
                        });
                        return null;
                    }

                    // ── Helper: CORS-safe image loader via fetch + Blob + ObjectURL ──
                    // This completely bypasses CORS taint on the canvas because we
                    // create a local blob:// URL from the raw bytes. The canvas never
                    // sees the original cross-origin URL, so getImageData / toDataURL
                    // will always succeed.
                    function loadImageSafe(url) {
                        return new Promise((resolve, reject) => {
                            // First try the fetch+blob approach (works for same-origin & CORS-enabled)
                            fetch(url, { credentials: 'same-origin' })
                                .then(response => {
                                    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
                                    return response.blob();
                                })
                                .then(blob => {
                                    const objectUrl = URL.createObjectURL(blob);
                                    const img = new Image();
                                    img.onload = () => {
                                        // Revoke the object URL after the image is fully decoded
                                        // to prevent memory leaks. The pixel data is now in the
                                        // Image element's internal bitmap, safe to use on canvas.
                                        URL.revokeObjectURL(objectUrl);
                                        resolve(img);
                                    };
                                    img.onerror = () => {
                                        URL.revokeObjectURL(objectUrl);
                                        reject(new Error(`Image decode failed for blob from ${url}`));
                                    };
                                    img.src = objectUrl;
                                })
                                .catch(fetchErr => {
                                    // Fallback: try direct Image load with crossOrigin
                                    // This handles edge cases where fetch might be blocked
                                    // but <img> loading still works (e.g., file:// protocol).
                                    console.warn(`⚠️ fetch failed for "${url}", trying direct Image load:`, fetchErr);
                                    const img = new Image();
                                    img.crossOrigin = 'anonymous';
                                    img.onload = () => resolve(img);
                                    img.onerror = () => reject(new Error(`All image loading methods failed for ${url}`));
                                    img.src = url;
                                });
                        });
                    }

                    // ── Helper: Draw UV polygon mask for a given linkedUvGroupId ──
                    // Renders pure white filled triangles for every face belonging to
                    // the mask layer that this generation entry is linked to.
                    function drawUvMask(ctx, layerId, w, h) {
                        ctx.clearRect(0, 0, w, h);
                        const layer = maskState[layerId];
                        if (!layer || !layer.faces || layer.faces.length === 0) {
                            // No mask data → fill entire canvas white (full coverage)
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, w, h);
                            return;
                        }
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
                    }

                    try {
                        // ── 3. Load all visible layer images in parallel ──
                        const imagePromises = visibleLayers.map(entry =>
                            loadImageSafe(entry.generatedImage)
                                .catch(err => {
                                    console.error(`❌ Failed to load layer "${entry.layerName}":`, err);
                                    return null; // Skip broken layers gracefully
                                })
                        );
                        const loadedImages = await Promise.all(imagePromises);

                        // ── 4. Create the master compositing canvas ──
                        const masterCanvas = document.createElement('canvas');
                        masterCanvas.width = TEX_SIZE;
                        masterCanvas.height = TEX_SIZE;
                        const masterCtx = masterCanvas.getContext('2d');
                        // Start fully transparent
                        masterCtx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

                        // Offscreen canvas for per-layer mask+cut operations
                        const cutCanvas = document.createElement('canvas');
                        cutCanvas.width = TEX_SIZE;
                        cutCanvas.height = TEX_SIZE;
                        const cutCtx = cutCanvas.getContext('2d');

                        // Dedicated mask canvas — keeps mask rendering isolated
                        // so clearRect never destroys texture data
                        const maskCanvas = document.createElement('canvas');
                        maskCanvas.width = TEX_SIZE;
                        maskCanvas.height = TEX_SIZE;
                        const maskCtx = maskCanvas.getContext('2d');

                        // ── 5. Composite each layer bottom-to-top ──
                        for (let i = 0; i < visibleLayers.length; i++) {
                            const entry = visibleLayers[i];
                            const img = loadedImages[i];
                            if (!img) continue; // Skip layers that failed to load

                            // Step A: Render the UV polygon mask onto its own canvas
                            drawUvMask(maskCtx, entry.linkedUvGroupId, TEX_SIZE, TEX_SIZE);

                            // Step B: Draw the AI-generated texture onto the cut canvas
                            cutCtx.globalCompositeOperation = 'source-over';
                            cutCtx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
                            cutCtx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);

                            // Step C: Use 'destination-in' with the mask to cut the texture.
                            // 'destination-in': keeps EXISTING pixels (the texture) only where
                            // the NEW drawing (the mask) has alpha > 0. The mask canvas has
                            // white polygons with alpha=1, so only texture pixels overlapping
                            // those UV polygons survive. Everything else becomes transparent.
                            cutCtx.globalCompositeOperation = 'destination-in';
                            cutCtx.drawImage(maskCanvas, 0, 0);

                            // Step D: Composite the masked cutout onto the master canvas.
                            // 'source-over' means later layers paint on top of earlier ones,
                            // which is the correct bottom-to-top stacking behavior.
                            masterCtx.globalCompositeOperation = 'source-over';
                            masterCtx.drawImage(cutCanvas, 0, 0);
                        }

                        // ── 6. Update the 2D Viewport preview ──
                        // Create an Image from the composited canvas for the 2D view
                        const previewImg = new Image();
                        previewImg.onload = () => {
                            lastGeneratedImage = previewImg;
                            redrawMasks();
                        };
                        previewImg.onerror = () => {
                            console.error('❌ Failed to create 2D preview from composited canvas');
                        };
                        previewImg.src = masterCanvas.toDataURL('image/png');

                        // ── 7. Apply composited texture to the 3D mesh ──
                        const canvasTexture = new THREE.CanvasTexture(masterCanvas);
                        canvasTexture.colorSpace = THREE.SRGBColorSpace;
                        canvasTexture.flipY = true;
                        // Force GPU upload of the texture data
                        canvasTexture.needsUpdate = true;

                        currentMesh.traverse((child) => {
                            if (child.isMesh) {
                                const newMat = new THREE.MeshBasicMaterial({
                                    map: canvasTexture,
                                    color: 0xffffff,
                                    side: THREE.DoubleSide,
                                    transparent: true,
                                });
                                
                                if (currentToolMode === 'SKETCH') {
                                    if (child.userData.originalMat) {
                                        if (child.userData.originalMat.map) child.userData.originalMat.map.dispose();
                                        child.userData.originalMat.dispose();
                                    }
                                    child.userData.originalMat = newMat;
                                } else {
                                    if (child.material) {
                                        if (child.material.map) child.material.map.dispose();
                                        child.material.dispose();
                                    }
                                    child.material = newMat;
                                    child.material.needsUpdate = true;
                                }
                            }
                        });

                        console.log(`✅ compositeFinalTexture: composited ${visibleLayers.length} layer(s) successfully`);

                        // Return a data URL for the export button to use
                        return masterCanvas.toDataURL('image/png');

                    } catch (err) {
                        console.error('❌ compositeFinalTexture fatal error:', err);
                        return null;
                    }
                }

                const syncData = () => {

                    if (!this.painterDataWidget) return;
                    if (isLoadingProject) return;

                    const layers = [];
                    const w = canvas2d.width;
                    const h = canvas2d.height;
                    
                    const ctx = hiddenCanvas.getContext('2d');
                    
                    // Create dedicated offscreen canvas for Sketch output
                    const sketchCanvas = document.createElement('canvas');
                    sketchCanvas.width = w; sketchCanvas.height = h;
                    const sketchCtx = sketchCanvas.getContext('2d');

                    const isObjLoaded = currentMesh !== null;

                    Object.values(maskState).forEach(layer => {
                        // Fallback to the loaded images if the OBJ isn't loaded yet
                        let maskBase64 = layer.savedMask || "";
                        let sketchBase64 = layer.savedSketch || "";

                        // If not visible, return an empty/black layer to preserve prompt indexing
                        if (layer.isVisible === false) {
                            maskBase64 = "";
                            sketchBase64 = "";
                        } else if (isObjLoaded || (layer.strokes && layer.strokes.length > 0)) {
                            ctx.clearRect(0, 0, w, h);
                            
                            // ControlNet maps require a pure black background
                            sketchCtx.fillStyle = '#000000';
                            sketchCtx.fillRect(0, 0, w, h);

                            ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
                            sketchCtx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;

                            // 1. Draw Geometry Masks (Blue/Green Polygons)
                            ctx.fillStyle = '#ffffff';
                            ctx.strokeStyle = '#ffffff';
                            ctx.lineWidth = 1;

                            if (isObjLoaded && layer.faces) {
                                layer.faces.forEach(f => {
                                    ctx.beginPath();
                                    ctx.moveTo(f.uvA.x * w, (1 - f.uvA.y) * h);
                                    ctx.lineTo(f.uvB.x * w, (1 - f.uvB.y) * h);
                                    ctx.lineTo(f.uvC.x * w, (1 - f.uvC.y) * h);
                                    ctx.closePath();
                                    ctx.fill();
                                    ctx.stroke();
                                });
                                // Only overwrite the saved geometry mask if the 3D model is actually loaded!
                                maskBase64 = hiddenCanvas.toDataURL("image/png");
                                layer.savedMask = maskBase64;
                            }

                            // 2. Draw Strokes to their respective separate canvases
                            if (layer.strokes && layer.strokes.length > 0) {
                                layer.strokes.forEach(stroke => {
                                    const activeCtx = sketchCtx;
                                    
                                    activeCtx.lineWidth = stroke.size;
                                    activeCtx.lineCap = 'round';
                                    activeCtx.lineJoin = 'round';
                                    
                                    if (stroke.isEraser) {
                                        activeCtx.globalCompositeOperation = 'destination-out';
                                        activeCtx.shadowBlur = 0;
                                        activeCtx.strokeStyle = 'rgba(0,0,0,1)';
                                    } else {
                                        activeCtx.globalCompositeOperation = 'source-over';
                                        activeCtx.strokeStyle = '#ffffff'; // Canny uses white strokes
                                        activeCtx.shadowBlur = 0; // Hard edge for Canny
                                    }

                                    const pts = stroke.points;
                                    if (pts.length > 1) {
                                        activeCtx.beginPath();
                                        activeCtx.moveTo(pts[0][0], pts[0][1]);
                                        for (let i = 1; i < pts.length; i++) {
                                            activeCtx.lineTo(pts[i][0], pts[i][1]);
                                        }
                                        activeCtx.stroke();
                                    } else if (pts.length === 1) {
                                        activeCtx.beginPath();
                                        activeCtx.arc(pts[0][0], pts[0][1], stroke.size / 2, 0, Math.PI * 2);
                                        activeCtx.fillStyle = activeCtx.strokeStyle;
                                        activeCtx.fill();
                                    }
                                });
                                
                                sketchBase64 = sketchCanvas.toDataURL("image/png");
                                layer.savedSketch = sketchBase64;
                            }
                            
                            ctx.globalAlpha = 1.0;
                            sketchCtx.globalAlpha = 1.0;
                        }

                        const rawIndices = layer.pendingFaceIndices || (layer.faces ? layer.faces.map(f => f.faceIndex) : []);

                        layers.push({
                            prompt: layer.prompt,
                            name: layer.inputRow.querySelectorAll('input[type="text"]')[0].value,
                            mask: maskBase64,
                            sketch: sketchBase64,
                            faces: compressIndices(rawIndices),
                            strokes: layer.strokes || []
                        });
                    });

                    const payload = {
                        layers: layers,
                        cavity: currentBakedCavity,
                        activeLayerId: activeLayerId,
                        generationStack: generationStack
                    };

                    isSyncingData = true;
                    lastSyncTime = Date.now();
                    this.painterDataWidget.value = JSON.stringify(payload);
                    isSyncingData = false;
                    
                    // SAFE AUTO-SAVE: Fired only at the completion of actions (clicks, keypresses, mouseup)
                    if (app.graph) {
                        app.graph.setDirtyCanvas(true, false);
                    }
                };

                // --- Three.js Initialization ---
                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0x222222);

                const liveCannyCanvas = document.createElement('canvas');
                liveCannyCanvas.width = 1024;
                liveCannyCanvas.height = 1024;
                const liveCannyTexture = new THREE.CanvasTexture(liveCannyCanvas);
                liveCannyTexture.colorSpace = THREE.SRGBColorSpace;

                function updateLiveCannyPreview() {
                    const ctx = liveCannyCanvas.getContext('2d');
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, 1024, 1024);
                    
                    Object.values(maskState).forEach(layer => {
                        if (layer.strokes && layer.strokes.length > 0) {
                            layer.strokes.forEach(stroke => {
                                if (stroke.mode === 'SKETCH') {
                                    ctx.lineWidth = stroke.size;
                                    ctx.lineCap = 'round';
                                    ctx.lineJoin = 'round';
                                    
                                    if (stroke.isEraser) {
                                        ctx.globalCompositeOperation = 'destination-out';
                                        ctx.strokeStyle = 'rgba(0,0,0,1)';
                                    } else {
                                        ctx.globalCompositeOperation = 'source-over';
                                        ctx.strokeStyle = '#ffffff';
                                    }
                                    
                                    const pts = stroke.points;
                                    if (pts.length > 1) {
                                        ctx.beginPath();
                                        ctx.moveTo(pts[0][0], pts[0][1]);
                                        for (let i = 1; i < pts.length; i++) {
                                            ctx.lineTo(pts[i][0], pts[i][1]);
                                        }
                                        ctx.stroke();
                                    } else if (pts.length === 1) {
                                        ctx.beginPath();
                                        ctx.arc(pts[0][0], pts[0][1], stroke.size / 2, 0, Math.PI * 2);
                                        ctx.fillStyle = ctx.strokeStyle;
                                        ctx.fill();
                                    }
                                }
                            });
                        }
                    });
                    liveCannyTexture.needsUpdate = true;
                }

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

                        // Do not hard reset maskState here to allow hydrated persistence to survive reloading the obj file.
                        
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
                                const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false, opacity: 0.5, transparent: true });
                                const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
                                child.add(wireframe);
                                child.userData.wireframeHelper = wireframe;
                                
                                // Sync initial state with UI
                                wireframe.visible = toggleWireframe.checked;
                                wireframeMaterial.color.set(wireframeColor.value);

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
                                reconstructLayerObjects(currentMesh);
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
                    if (currentToolMode !== 'MASK') return;
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
                    if (currentToolMode !== 'MASK') return;
                    if (!hit || !hit.object || !hit.object.userData) return;
                    
                    const isIslandMode = islandRadio.checked;
                    const startFaceIndex = hit.faceIndex;

                    if (!activeLayerId || !maskState[activeLayerId]) {
                        createNewLayer();
                    }
                    const layerId = activeLayerId;

                    const uvAttr = hit.object.geometry.attributes.uv;
                    const posAttr = hit.object.geometry.attributes.position;
                    const index = hit.object.geometry.index;

                    let facesToProcess = [startFaceIndex];
                    
                    if (symmetryCheckbox.checked) {
                        let a, b, c;
                        if (index) {
                            a = index.getX(startFaceIndex * 3); b = index.getX(startFaceIndex * 3 + 1); c = index.getX(startFaceIndex * 3 + 2);
                        } else {
                            a = startFaceIndex * 3; b = startFaceIndex * 3 + 1; c = startFaceIndex * 3 + 2;
                        }
                        
                        const cx = (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3;
                        const cy = (posAttr.getY(a) + posAttr.getY(b) + posAttr.getY(c)) / 3;
                        const cz = (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3;
                        
                        const centerLocal = new THREE.Vector3(cx, cy, cz);
                        const axis = symmetrySelect.value;
                        if (axis === 'X') centerLocal.x *= -1;
                        if (axis === 'Y') centerLocal.y *= -1;
                        if (axis === 'Z') centerLocal.z *= -1;
                        
                        const mirroredCenterWorld = centerLocal.applyMatrix4(hit.object.matrixWorld);
                        
                        let closestFaceIndex = -1;
                        let minDistanceSq = Infinity;
                        const faceCount = index ? index.count / 3 : posAttr.count / 3;
                        const vTemp = new THREE.Vector3();
                        
                        for (let i = 0; i < faceCount; i++) {
                            let ma, mb, mc;
                            if (index) {
                                ma = index.getX(i * 3); mb = index.getX(i * 3 + 1); mc = index.getX(i * 3 + 2);
                            } else {
                                ma = i * 3; mb = i * 3 + 1; mc = i * 3 + 2;
                            }
                            const mcx = (posAttr.getX(ma) + posAttr.getX(mb) + posAttr.getX(mc)) / 3;
                            const mcy = (posAttr.getY(ma) + posAttr.getY(mb) + posAttr.getY(mc)) / 3;
                            const mcz = (posAttr.getZ(ma) + posAttr.getZ(mb) + posAttr.getZ(mc)) / 3;
                            
                            vTemp.set(mcx, mcy, mcz).applyMatrix4(hit.object.matrixWorld);
                            const distSq = vTemp.distanceToSquared(mirroredCenterWorld);
                            if (distSq < minDistanceSq) {
                                minDistanceSq = distSq;
                                closestFaceIndex = i;
                            }
                        }
                        
                        if (closestFaceIndex !== -1 && Math.sqrt(minDistanceSq) < 0.05) {
                            facesToProcess.push(closestFaceIndex);
                        }
                    }

                    if (isIslandMode) {
                        if (!hit.object.userData.faceToIslandId) return;
                        const finalFaces = new Set();
                        facesToProcess.forEach(fIdx => {
                            getUVIslandFaces(hit.object, fIdx).forEach(fi => finalFaces.add(fi));
                        });
                        facesToProcess = Array.from(finalFaces);
                    }

                    const faceDataArray = [];
                    let hasChanges = false;
                    
                    const startFaceExists = maskState[layerId].faces.some(f => f.faceIndex === startFaceIndex && f.meshUuid === hit.object.uuid);

                    if (startFaceExists) {
                        // DESELECT: Remove entirely from the active layer
                        facesToProcess.forEach(fIdx => {
                            const existingIndex = maskState[layerId].faces.findIndex(f => f.faceIndex === fIdx && f.meshUuid === hit.object.uuid);
                            if (existingIndex !== -1) {
                                maskState[layerId].faces.splice(existingIndex, 1);
                                hasChanges = true;
                            }
                        });
                    } else {
                        // SELECT: Steal from other layers, then add to active layer
                        facesToProcess.forEach(fIdx => {
                            // 1. Enforce Mutual Exclusivity (Steal from all other layers)
                            Object.entries(maskState).forEach(([otherLayerId, otherLayer]) => {
                                if (otherLayerId !== layerId) {
                                    const otherIndex = otherLayer.faces.findIndex(f => f.faceIndex === fIdx && f.meshUuid === hit.object.uuid);
                                    if (otherIndex !== -1) {
                                        otherLayer.faces.splice(otherIndex, 1);
                                        hasChanges = true;
                                    }
                                }
                            });

                            // 2. Add to active layer if it isn't already present
                            const existingIndex = maskState[layerId].faces.findIndex(f => f.faceIndex === fIdx && f.meshUuid === hit.object.uuid);
                            if (existingIndex === -1) {
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
                                hasChanges = true;
                            }
                        });
                    }

                    if (faceDataArray.length > 0) {
                        maskState[layerId].faces.push(...faceDataArray);
                    }

                    if (hasChanges) {
                        redrawMasks();
                        syncData();
                        currentHoverKey = 'none';
                        handleHover(hit);
                    }
                }

                function redrawStrokes() {
                    if (typeof drawingCanvas === 'undefined') return;
                    const dCtx = drawingCanvas.getContext('2d');
                    dCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
                    Object.values(maskState).forEach(layer => {
                        if (layer.isVisible === false) return;
                        dCtx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
                        if (layer.strokes && layer.strokes.length > 0) {
                            layer.strokes.forEach(stroke => {
                                if (stroke.mode !== currentToolMode) return;
                                
                                dCtx.lineWidth = stroke.size;
                                dCtx.lineCap = 'round';
                                dCtx.lineJoin = 'round';

                                if (stroke.isEraser) {
                                    dCtx.globalCompositeOperation = 'destination-out';
                                    dCtx.shadowBlur = 0;
                                    dCtx.strokeStyle = 'rgba(0,0,0,1)';
                                } else {
                                    dCtx.globalCompositeOperation = 'source-over';
                                    if (stroke.mode === 'SKETCH') {
                                        dCtx.strokeStyle = '#ffffff';
                                        dCtx.shadowBlur = 0;
                                    } else if (stroke.mode === 'PATCH') {
                                        dCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                                        dCtx.shadowColor = '#ffffff';
                                        dCtx.shadowBlur = 10;
                                    }
                                }

                                const pts = stroke.points;
                                if (pts.length > 1) {
                                    dCtx.beginPath();
                                    dCtx.moveTo(pts[0][0], pts[0][1]);
                                    for (let i = 1; i < pts.length; i++) {
                                        dCtx.lineTo(pts[i][0], pts[i][1]);
                                    }
                                    dCtx.stroke();
                                } else if (pts.length === 1) {
                                    dCtx.beginPath();
                                    dCtx.arc(pts[0][0], pts[0][1], stroke.size / 2, 0, Math.PI * 2);
                                    dCtx.fillStyle = dCtx.strokeStyle;
                                    dCtx.fill();
                                }
                            });
                        }
                        dCtx.globalAlpha = 1.0;
                    });
                }

                function redrawMasks() {
                    if (isLoadingProject) return;
                    const w = canvas2d.width;
                    const h = canvas2d.height;

                    const drawOnCtx = (canvas, isHidden) => {
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, w, h);

                        // Draw the base generated texture preview on the 2D canvas
                        if (!isHidden && lastGeneratedImage) {
                            ctx.drawImage(lastGeneratedImage, 0, 0, w, h);
                        }

                        if (!isHidden && currentMesh) {
                            currentMesh.traverse((child) => {
                                if (child.isMesh && child.geometry) {
                                    drawFullUVWireframe(child.geometry, ctx);
                                }
                            });
                        }

                        const showMasks = typeof toggleMasks !== 'undefined' ? toggleMasks.checked : true;

                        Object.entries(maskState).forEach(([layerId, layer]) => {
                            if (layer.isVisible === false) return;
                            ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
                            const isActive = (layerId === activeLayerId);
                            
                            if (isHidden) {
                                ctx.fillStyle = '#ffffff';
                                ctx.strokeStyle = '#ffffff';
                            } else {
                                if (!showMasks) return; // Skip drawing masks if toggle is off
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
                            ctx.globalAlpha = 1.0;
                        });
                    };

                    drawOnCtx(canvas2d, false);
                    redrawStrokes();

                    if (recordedHighlightMesh) {
                        scene.remove(recordedHighlightMesh);
                        recordedHighlightMesh = null;
                    }

                    let totalRecordedFaces = 0;
                    Object.values(maskState).forEach(m => { totalRecordedFaces += m.faces.length; });
                    const showMasks = typeof toggleMasks !== 'undefined' ? toggleMasks.checked : true;
                    if (totalRecordedFaces > 0 && showMasks) {
                        const vertices = new Float32Array(totalRecordedFaces * 9);
                        const colors = new Float32Array(totalRecordedFaces * 9);
                        let i = 0;
                        Object.entries(maskState).forEach(([layerId, m]) => {
                            if (m.isVisible === false) return;
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
                    if (currentToolMode !== 'MASK') hit = null;
                    // Strict defensive null-checking for the raycast intersection results
                    if (!hit || !hit.object || !hit.object.userData || !currentMesh) {
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
                        if (!hit.object.userData.faceToIslandId) return;
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
                        hoverInputRow = maskState[existingStateId].inputRow;
                        hoverInputRow.style.background = 'rgba(0,170,255,0.4)';
                    } else if (isIslandMode) {
                        facesToProcess = getUVIslandFaces(hit.object, hitFaceIndex);
                    }

                    const vertices = new Float32Array((existingStateId ? maskState[existingStateId].faces.length : facesToProcess.length) * 9);
                    ctx.fillStyle = highlightColor;

                    if (existingStateId) {
                        // BUG FIX: Skip recalculation! Draw the exact cached multi-mesh coordinates.
                        maskState[existingStateId].faces.forEach((f, i) => {
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
                    } else {
                        // LIVE RENDER: Calculate fresh coordinates for new unselected islands
                        const uvAttr = hit.object.geometry.attributes.uv;
                        const posAttr = hit.object.geometry.attributes.position;
                        const index = hit.object.geometry.index;

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
                    }
                    

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

                    const label = document.createElement('input');
                    label.type = 'text';
                    label.value = `Layer ${id}`;
                    label.style.fontSize = '12px';
                    label.style.color = '#fff';
                    label.style.background = 'transparent';
                    label.style.border = '1px solid transparent';
                    label.style.outline = 'none';
                    label.style.width = '100px';
                    label.style.cursor = 'text';
                    label.title = 'Click to rename layer';
                    
                    label.addEventListener('mouseenter', () => {
                        label.style.borderBottom = '1px solid #888';
                    });
                    label.addEventListener('mouseleave', () => {
                        label.style.borderBottom = '1px solid transparent';
                    });
                    label.addEventListener('focus', () => {
                        label.style.borderBottom = '1px solid #4CAF50';
                    });
                    label.addEventListener('blur', () => {
                        label.style.borderBottom = '1px solid transparent';
                    });
                    label.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') label.blur();
                    });

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

                    const rightHeader = document.createElement('div');
                    rightHeader.style.display = 'flex';
                    rightHeader.style.alignItems = 'center';
                    rightHeader.style.gap = '5px';

                    const eyeIcon = document.createElement('button');
                    eyeIcon.innerText = '👁️';
                    eyeIcon.style.background = 'none';
                    eyeIcon.style.border = 'none';
                    eyeIcon.style.cursor = 'pointer';
                    eyeIcon.style.padding = '0';
                    eyeIcon.title = 'Toggle Visibility';
                    
                    const opacitySlider = document.createElement('input');
                    opacitySlider.type = 'range';
                    opacitySlider.min = '0';
                    opacitySlider.max = '1';
                    opacitySlider.step = '0.05';
                    opacitySlider.value = '1';
                    opacitySlider.style.width = '60px';
                    
                    eyeIcon.addEventListener('click', () => {
                        maskState[stateId].isVisible = !maskState[stateId].isVisible;
                        eyeIcon.style.opacity = maskState[stateId].isVisible ? '1' : '0.3';
                        syncData();
                        redrawMasks();
                        if (typeof redrawStrokes === 'function') redrawStrokes();
                    });
                    
                    opacitySlider.addEventListener('input', (e) => {
                        maskState[stateId].opacity = parseFloat(e.target.value);
                        syncData();
                        redrawMasks();
                        if (typeof redrawStrokes === 'function') redrawStrokes();
                    });

                    rightHeader.appendChild(opacitySlider);
                    rightHeader.appendChild(eyeIcon);
                    rightHeader.appendChild(delBtn);

                    header.appendChild(leftHeader);
                    header.appendChild(rightHeader);

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

                    maskState[stateId] = { id, prompt: '', faces: [], strokes: [], inputRow: row, isVisible: true, opacity: 1.0 };
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

                const originalOnConfigure = this.onConfigure;
                this.onConfigure = function(info) {
                    if (originalOnConfigure) originalOnConfigure.apply(this, arguments);
                    
                    if (this.painterDataWidget && this.painterDataWidget.value) {
                        try {
                            const data = JSON.parse(this.painterDataWidget.value);
                            if (data.layers && data.layers.length > 0) {
                                Object.keys(maskState).forEach(k => delete maskState[k]);
                                promptStack.innerHTML = '';
                                layerCount = 0;
                                activeLayerId = null;
                                
                                // Restore the Generation Stack from F5 refresh
                                if (data.generationStack) {
                                    generationStack = data.generationStack;
                                } else {
                                    generationStack = [];
                                }

                                // CRITICAL FIX: Lock drawing and syncing while hydrating the saved state
                                isLoadingProject = true;

                                data.layers.forEach(l => {
                                    createNewLayer();
                                    const layerId = activeLayerId;
                                    const layerObj = maskState[layerId];

                                    layerObj.prompt = l.prompt || '';
                                    layerObj.inputRow.querySelector('.prompt-input').value = layerObj.prompt;
                                    
                                    const nameInput = layerObj.inputRow.querySelectorAll('input[type="text"]')[0];
                                    if (l.name && nameInput) {
                                        nameInput.value = l.name;
                                    }

                                    if (l.faces) {
                                        if (l.faces.length > 0 && l.faces[0].meshUuid) {
                                            // Old backward compatible format
                                            layerObj.faces = l.faces;
                                            layerObj.faces.forEach(f => {
                                                if (f.vA) f.vA = new THREE.Vector3(f.vA.x, f.vA.y, f.vA.z);
                                                if (f.vB) f.vB = new THREE.Vector3(f.vB.x, f.vB.y, f.vB.z);
                                                if (f.vC) f.vC = new THREE.Vector3(f.vC.x, f.vC.y, f.vC.z);
                                            });
                                        } else {
                                            // New compressed format
                                            layerObj.pendingFaceIndices = decompressIndices(l.faces || []);
                                            layerObj.faces = []; // Clear to prevent crashes before mesh load
                                       }
                                    }
                                    
                                    layerObj.strokes = l.strokes || [];
                                    // Hydrate the saved images so they survive an F5 refresh
                                    layerObj.savedMask = l.mask || "";
                                    layerObj.savedSketch = l.sketch || "";
                                    layerObj.savedPatch = l.patch || "";
                                });

                                if (data.cavity) {
                                    currentBakedCavity = data.cavity;
                                }

                                // CRITICAL FIX: Unlock the UI, safely reconstruct, and run a single unified sync
                                isLoadingProject = false;
                                
                                if (currentMesh) {
                                    reconstructLayerObjects(currentMesh);
                                }
                                
                                redrawMasks();
                                syncData();
                            }
                        } catch(e) {
                            // Ensure the UI unlocks even if JSON parsing fails
                            isLoadingProject = false;
                        }
                    }
                };

                // Animation loop
                let animationId;
                const animate = function () {
                    animationId = requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                };
                animate();

                // Clean up on remove
                const parentOnRemoved = nodeType.prototype.onRemoved;
                this.onRemoved = function () {
                    cancelAnimationFrame(animationId);
                    // domContainer is auto-removed by addDOMWidget's lifecycle.
                    if (parentOnRemoved) parentOnRemoved.apply(this, arguments);
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

                function getHitFace2D(clientX, clientY) {
                    if (!currentMesh) return null;
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
                    if (px < 0 || px > renderWidth || py < 0 || py > renderHeight) return null;

                    const u = px / renderWidth; const v = 1.0 - (py / renderHeight);

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

                    let result = null;
                    currentMesh.traverse((child) => {
                        if (result) return;
                        if (child.isMesh && child.geometry && child.geometry.attributes.uv) {
                            const uvAttr = child.geometry.attributes.uv;
                            const index = child.geometry.index;
                            const numFaces = index ? index.count / 3 : uvAttr.count / 3;
                            const uvArr = uvAttr.array;
                            const idxArr = index ? index.array : null;

                            for (let i = 0; i < numFaces; i++) {
                                let a, b, c;
                                if (idxArr) { a = idxArr[i * 3]; b = idxArr[i * 3 + 1]; c = idxArr[i * 3 + 2]; }
                                else { a = i * 3; b = i * 3 + 1; c = i * 3 + 2; }

                                if (pointInTriangle(u, v, uvArr[a * 2], uvArr[a * 2 + 1], uvArr[b * 2], uvArr[b * 2 + 1], uvArr[c * 2], uvArr[c * 2 + 1])) {
                                    result = { faceIndex: i, object: child };
                                    break;
                                }
                            }
                        }
                    });
                    return result;
                }

                // Add click and hover listeners to the UV canvas
                canvas2d.addEventListener('click', (e) => {
                    if (currentToolMode === 'SKETCH' || currentToolMode === 'PATCH') return;
                    const hit = getHitFace2D(e.clientX, e.clientY);
                    if (hit) {
                        handleFaceClick(hit);
                    }
                });

                let isDrawing = false;
                let currentStroke = null;

                // Helper: convert mouse event to internal 1024x1024 canvas coords,
                // accounting for CSS transforms (LiteGraph zoom) AND objectFit:contain letterboxing.
                function getCanvasDrawCoords(e) {
                    const rect = canvas2d.getBoundingClientRect();
                    const canvasAspect = canvas2d.width / canvas2d.height; // 1.0 for 1024x1024
                    const elemAspect = rect.width / rect.height;
                    let renderW, renderH, padLeft, padTop;
                    if (elemAspect > canvasAspect) {
                        renderH = rect.height;
                        renderW = rect.height * canvasAspect;
                        padLeft = (rect.width - renderW) / 2;
                        padTop = 0;
                    } else {
                        renderW = rect.width;
                        renderH = rect.width / canvasAspect;
                        padLeft = 0;
                        padTop = (rect.height - renderH) / 2;
                    }
                    const x = ((e.clientX - rect.left - padLeft) / renderW) * canvas2d.width;
                    const y = ((e.clientY - rect.top - padTop) / renderH) * canvas2d.height;
                    return { x, y, renderW, renderH };
                }

                canvas2d.addEventListener('mousedown', (e) => {
                    if (currentToolMode !== 'SKETCH' && currentToolMode !== 'PATCH') return;
                    if (!activeLayerId || !maskState[activeLayerId]) return;

                    isDrawing = true;
                    const { x: canvasX, y: canvasY } = getCanvasDrawCoords(e);

                    if (!maskState[activeLayerId].strokes) maskState[activeLayerId].strokes = [];
                    currentStroke = { mode: currentToolMode, size: currentBrushSize, isEraser: isEraserMode, points: [[canvasX, canvasY]] };
                    maskState[activeLayerId].strokes.push(currentStroke);
                    
                    redrawStrokes();
                });

                let lastCanvasMoveTime = 0;
                canvas2d.addEventListener('mousemove', (e) => {
                    // Update dynamic brush cursor
                    if (currentToolMode === 'SKETCH' || currentToolMode === 'PATCH') {
                        const { renderW } = getCanvasDrawCoords(e);
                        const visualBrushSize = currentBrushSize * (renderW / canvas2d.width);
                        brushCursor.style.display = 'block';
                        brushCursor.style.left = e.clientX + 'px';
                        brushCursor.style.top = e.clientY + 'px';
                        brushCursor.style.width = visualBrushSize + 'px';
                        brushCursor.style.height = visualBrushSize + 'px';
                    } else {
                        brushCursor.style.display = 'none';
                    }

                    if (isDrawing && currentStroke) {
                        const { x: canvasX, y: canvasY } = getCanvasDrawCoords(e);
                        currentStroke.points.push([canvasX, canvasY]);

                        redrawStrokes();
                        if (typeof updateLiveCannyPreview === 'function') updateLiveCannyPreview();
                        return;
                    }

                    if (currentToolMode !== 'MASK') return;
                    if (isDragging) return;
                    
                    const now = Date.now();
                    if (now - lastCanvasMoveTime < 32) return; // limit to ~30fps
                    lastCanvasMoveTime = now;

                    const hit = getHitFace2D(e.clientX, e.clientY);
                    handleHover(hit);
                });

                canvas2d.addEventListener('mouseup', () => {
                    if (isDrawing) {
                        isDrawing = false;
                        currentStroke = null;
                        syncData();
                    }
                });

                canvas2d.addEventListener('mouseleave', () => {
                    if (typeof brushCursor !== 'undefined') brushCursor.style.display = 'none';
                    if (isDrawing) {
                        isDrawing = false;
                        currentStroke = null;
                        syncData();
                    }
                    if (currentToolMode === 'MASK') handleHover(null);
                });

                // Texture Hot-Reload Listener
                const onNodeExecuted = (e) => {
                    const detail = e.detail;
                    console.log("🟢 ComfyUI Node Executed:", detail);
                    
                    if (detail && detail.output && detail.output.images && detail.output.images.length > 0) {
                        const img = detail.output.images[0];
                        
                        if (img.type !== 'output') return; // Ignore temp previews
                        
                        const query = new URLSearchParams({
                            filename: img.filename,
                            type: img.type,
                            subfolder: img.subfolder || ''
                        }).toString();
                        
                        const textureUrl = api.apiURL('/view?' + query);
                        
                        console.log("🖼️ Texture Found, loading:", textureUrl);
                        
                        // Add to Generation Stack
                        let lName = 'Unknown Layer';
                        if (activeLayerId && maskState[activeLayerId]) {
                            const inputElem = maskState[activeLayerId].inputRow.querySelector('input[type="text"]');
                            if (inputElem) lName = inputElem.value;
                        }

                        generationStack.push({
                            id: Date.now().toString(),
                            layerName: lName,
                            linkedUvGroupId: activeLayerId,
                            generatedImage: textureUrl,
                            isVisible: true,
                            isLocked: false
                        });

                        // Refresh UI
                        if (typeof renderGenerationStack === 'function') {
                            renderGenerationStack();
                        }
                        
                        // Trigger the compositor to build the stack and handle the 2D/3D previews
                        if (typeof compositeFinalTexture === 'function') {
                            compositeFinalTexture();
                        }
                    }
                };
                api.addEventListener("executed", onNodeExecuted);
                
                const originalOnRemoved = this.onRemoved;
                this.onRemoved = function() {
                    api.removeEventListener("executed", onNodeExecuted);
                    if (originalOnRemoved) originalOnRemoved.apply(this, arguments);
                };
            };

            // NOTE: the manual onDrawBackground positioning/scaling override was
            // removed. ComfyUI's addDOMWidget layer now owns positioning, scaling,
            // sizing and collapse-hiding of the painter container every frame.
        }
    }
});
