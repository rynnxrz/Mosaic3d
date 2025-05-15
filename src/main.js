import './style.css'
import * as THREE from 'three';

window.addEventListener('DOMContentLoaded', () => {
  // --- UI Element Lookups with Null Checks ---
  function getEl(id) {
    const el = document.getElementById(id);
    if (!el) console.error(`Element with id='${id}' not found!`);
    return el;
  }
  const canvasContainer = getEl('canvas-container');
  const joystickBase = getEl('joystick-base');
  const joystickHandle = getEl('joystick-handle');
  const lookArea = getEl('look-area');
  const addContentBtn = getEl('addContentBtn');
  const contentPanel = getEl('contentPanel');
  const contentTypeSelectView = getEl('contentTypeSelectView');
  const cameraModeView = getEl('cameraModeView');
  const imagePreviewView = getEl('imagePreviewView');
  const selectPhotoTypeBtn = getEl('selectPhotoTypeBtn');
  const selectTextTypeBtn = getEl('selectTextTypeBtn');
  const closePanelBtn = getEl('closePanelBtn');
  const cameraPreview = getEl('cameraPreview');
  const galleryInput = getEl('galleryInput');
  const galleryFromCamBtn = getEl('galleryFromCamBtn');
  const captureFromCamBtn = getEl('captureFromCamBtn');
  const flipCameraBtn = getEl('flipCameraBtn');
  const backToTypesBtn = getEl('backToTypesBtn');
  const imagePreview = getEl('imagePreview');
  const pinPhotoBtn = getEl('pinPhotoBtn');
  const chooseDifferentBtn = getEl('chooseDifferentBtn');

  if (!canvasContainer) {
    console.error('Error: #canvas-container not found in DOM.');
    return;
  }
  if (!joystickBase) {
    console.error('Error: #joystick-base not found in DOM.');
    return;
  }
  if (!joystickHandle) {
    console.error('Error: #joystick-handle not found in DOM.');
    return;
  }
  if (!lookArea) {
    console.error('Error: #look-area not found in DOM.');
    return;
  }

  // --- Configurable Sensitivity ---
  const MOVE_SENSITIVITY = 0.05; // Slower movement
  const LOOK_SENSITIVITY = 0.15; // Look speed multiplier
  const CAMERA_HEIGHT = 5.5; // Camera Y position (eye level)
  const CAMERA_COLLISION_RADIUS = 2.5; // Camera collision radius

  // --- Three.js 3D Scene Setup ---
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / (window.innerHeight * 0.8),
    0.1,
    1000
  );
  camera.position.set(0, 15, 30);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(0xf0f0f0);
  resizeRenderer();
  canvasContainer.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.7);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Ground (whitebox)
  const groundGeo = new THREE.PlaneGeometry(100, 100);
  const groundMat = new THREE.MeshPhongMaterial({ color: 0xffffff });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // Walls/Obstacles (3 cubes)
  const wallMat = new THREE.MeshPhongMaterial({ color: 0xb0b0b0 });
  const cubeGeo = new THREE.BoxGeometry(5, 10, 1);
  const wall1 = new THREE.Mesh(cubeGeo, wallMat);
  wall1.position.set(-20, 5, 0);
  scene.add(wall1);
  const wall2 = new THREE.Mesh(cubeGeo, wallMat);
  wall2.position.set(0, 5, -20);
  wall2.rotation.y = Math.PI / 2;
  scene.add(wall2);
  const wall3 = new THREE.Mesh(cubeGeo, wallMat);
  wall3.position.set(20, 5, 10);
  scene.add(wall3);

  // --- Virtual Joystick State ---
  let joystickActive = false;
  let joystickCenter = { x: 0, y: 0 };
  let joystickDelta = { x: 0, y: 0 };

  joystickBase.addEventListener('touchstart', e => {
    joystickActive = true;
    const rect = joystickBase.getBoundingClientRect();
    joystickCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    if (e.touches.length > 0) {
      updateJoystick(e.touches[0]);
    }
  }, { passive: false });
  joystickBase.addEventListener('touchmove', e => {
    if (joystickActive && e.touches.length > 0) {
      updateJoystick(e.touches[0]);
    }
    e.preventDefault();
  }, { passive: false });
  joystickBase.addEventListener('touchend', e => {
    joystickActive = false;
    joystickDelta = { x: 0, y: 0 };
    joystickHandle.style.transform = 'translate(-50%, -50%)';
  }, { passive: false });

  function updateJoystick(touch) {
    const dx = touch.clientX - joystickCenter.x;
    const dy = touch.clientY - joystickCenter.y;
    const maxDist = 50; // px, max handle movement
    let dist = Math.sqrt(dx * dx + dy * dy);
    let angle = Math.atan2(dy, dx);
    if (dist > maxDist) dist = maxDist;
    const normX = Math.cos(angle) * dist / maxDist;
    const normY = Math.sin(angle) * dist / maxDist;
    joystickDelta = { x: normX, y: normY };
    joystickHandle.style.transform = `translate(-50%, -50%) translate(${normX * maxDist}px, ${normY * maxDist}px)`;
  }

  // --- Drag-to-Look State ---
  let lookActive = false;
  let lastLook = { x: 0, y: 0 };
  let lookDelta = { x: 0, y: 0 };
  let yaw = 0;
  let pitch = 0;

  lookArea.addEventListener('touchstart', e => {
    lookActive = true;
    if (e.touches.length > 0) {
      lastLook.x = e.touches[0].clientX;
      lastLook.y = e.touches[0].clientY;
    }
  }, { passive: false });
  lookArea.addEventListener('touchmove', e => {
    if (lookActive && e.touches.length > 0) {
      const dx = e.touches[0].clientX - lastLook.x;
      const dy = e.touches[0].clientY - lastLook.y;
      lookDelta.x += dx;
      lookDelta.y += dy;
      lastLook.x = e.touches[0].clientX;
      lastLook.y = e.touches[0].clientY;
    }
    e.preventDefault();
  }, { passive: false });
  lookArea.addEventListener('touchend', e => {
    lookActive = false;
  }, { passive: false });

  // --- Camera Movement & Look Integration ---
  yaw = Math.atan2(camera.position.x, camera.position.z);
  pitch = 0;
  camera.position.y = CAMERA_HEIGHT;

  function tryMoveCamera(newPos) {
    // Simple collision: check against wall bounding boxes
    const collidables = [wall1, wall2, wall3];
    for (const mesh of collidables) {
      const box = new THREE.Box3().setFromObject(mesh);
      // Expand box by camera collision radius
      box.expandByScalar(CAMERA_COLLISION_RADIUS);
      if (box.containsPoint(new THREE.Vector3(newPos.x, CAMERA_HEIGHT, newPos.z))) {
        return false; // Collision!
      }
    }
    // No collision
    return true;
  }

  function updateCamera() {
    // --- Look (yaw/pitch) ---
    yaw -= lookDelta.x * LOOK_SENSITIVITY * 0.01;
    pitch -= lookDelta.y * LOOK_SENSITIVITY * 0.01;
    pitch = Math.max(-Math.PI/2 + 0.1, Math.min(Math.PI/2 - 0.1, pitch));
    lookDelta.x = 0;
    lookDelta.y = 0;

    // Calculate forward and right vectors
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    // --- Movement ---
    let move = new THREE.Vector3();
    move.addScaledVector(forward, -joystickDelta.y * MOVE_SENSITIVITY);
    move.addScaledVector(right, -joystickDelta.x * MOVE_SENSITIVITY);
    // Try to move, check collision
    const newPos = camera.position.clone().add(move);
    newPos.y = CAMERA_HEIGHT;
    if (tryMoveCamera(newPos)) {
      camera.position.copy(newPos);
    }

    // Update camera orientation
    camera.position.y = CAMERA_HEIGHT;
    camera.lookAt(
      camera.position.x + Math.sin(yaw),
      CAMERA_HEIGHT + Math.sin(pitch),
      camera.position.z + Math.cos(yaw)
    );
  }

  // --- Animation loop ---
  function animate() {
    updateCamera();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  // Responsive resize
  window.addEventListener('resize', resizeRenderer);
  function resizeRenderer() {
    const width = window.innerWidth;
    const height = window.innerHeight; // Fullscreen
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  // Register service worker for PWA (keep this outside DOMContentLoaded if needed)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then(reg => {
          console.log('Service worker registered.', reg);
        })
        .catch(err => {
          console.error('Service worker registration failed:', err);
        });
    });
  }

  // --- New Add Content Panel UI Logic ---
  let processedImageBlob = null;
  let cameraStream = null;
  let cameraFacingMode = 'environment';

  // Helper: show only one view in the panel
  function showPanelView(viewId) {
    [contentTypeSelectView, cameraModeView, imagePreviewView].forEach(v => v && v.classList.remove('active'));
    const view = getEl(viewId);
    if (view) view.classList.add('active');
    // Fullscreen for camera or preview
    if (contentPanel) {
      if (viewId === 'cameraModeView' || viewId === 'imagePreviewView') {
        contentPanel.classList.add('fullscreen-panel');
      } else {
        contentPanel.classList.remove('fullscreen-panel');
      }
    }
  }
  function openPanel() {
    if (contentPanel) contentPanel.classList.add('panel-active');
    if (addContentBtn) {
      addContentBtn.classList.add('is-close-icon');
      addContentBtn.textContent = '\u00D7';
    }
    showPanelView('contentTypeSelectView');
  }
  function closePanel() {
    if (contentPanel) {
      contentPanel.classList.remove('panel-active');
      contentPanel.classList.remove('fullscreen-panel');
    }
    if (addContentBtn) {
      addContentBtn.classList.remove('is-close-icon');
      addContentBtn.textContent = '+';
    }
    showPanelView('contentTypeSelectView');
    stopCamera();
    processedImageBlob = null;
    imagePreview.src = '';
  }
  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    cameraPreview.srcObject = null;
  }

  // + button toggles panel
  if (addContentBtn) {
    addContentBtn.addEventListener('click', () => {
      if (contentPanel && contentPanel.classList.contains('panel-active')) {
        closePanel();
      } else {
        openPanel();
      }
    });
  }
  if (closePanelBtn) closePanelBtn.addEventListener('click', closePanel);

  // Photo type
  if (selectPhotoTypeBtn) selectPhotoTypeBtn.addEventListener('click', async () => {
    showPanelView('cameraModeView');
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode } });
      cameraPreview.srcObject = cameraStream;
    } catch (err) {
      alert('Camera access denied or unavailable.');
      showPanelView('contentTypeSelectView');
    }
  });
  // Text type (future)
  if (selectTextTypeBtn) selectTextTypeBtn.addEventListener('click', () => {
    console.log('Text mode selected (not implemented)');
    alert('Text mode not implemented yet.');
  });
  // Back to type select
  if (backToTypesBtn) backToTypesBtn.addEventListener('click', () => {
    stopCamera();
    showPanelView('contentTypeSelectView');
  });
  // Flip camera
  if (flipCameraBtn) flipCameraBtn.addEventListener('click', () => {
    // TODO: Implement camera facingMode toggle
    cameraFacingMode = (cameraFacingMode === 'environment') ? 'user' : 'environment';
    stopCamera();
    // Re-init camera with new facingMode
    selectPhotoTypeBtn.click();
  });
  // Gallery from camera mode
  if (galleryFromCamBtn) galleryFromCamBtn.addEventListener('click', () => {
    galleryInput.value = '';
    galleryInput.click();
  });
  // Gallery input change
  if (galleryInput) {
    galleryInput.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const img = new window.Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          processedImageBlob = blob;
          imagePreview.src = URL.createObjectURL(blob);
          showPanelView('imagePreviewView');
          stopCamera();
        }, 'image/jpeg', 0.8);
      };
      img.src = URL.createObjectURL(file);
    });
  }
  // Capture from camera
  if (captureFromCamBtn) captureFromCamBtn.addEventListener('click', () => {
    if (!cameraPreview.srcObject) return;
    const video = cameraPreview;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      processedImageBlob = blob;
      imagePreview.src = URL.createObjectURL(blob);
      showPanelView('imagePreviewView');
      stopCamera();
    }, 'image/jpeg', 0.8);
  });
  // Pin photo (placeholder)
  if (pinPhotoBtn) pinPhotoBtn.addEventListener('click', () => {
    alert('Pinning not implemented yet.');
  });
  // Choose different
  if (chooseDifferentBtn) chooseDifferentBtn.addEventListener('click', () => {
    processedImageBlob = null;
    imagePreview.src = '';
    showPanelView('contentTypeSelectView');
  });

  // Initialize panel state
  closePanel();

  // Joystick handle reset on touchend (ensure centering)
  if (joystickBase && joystickHandle) {
    joystickBase.addEventListener('touchend', e => {
      joystickDelta = { x: 0, y: 0 };
      joystickHandle.style.transform = 'translate(-50%, -50%)';
    });
  }
});
