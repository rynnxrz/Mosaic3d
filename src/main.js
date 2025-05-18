import './style.css'
import * as THREE from 'three';
import { initDB, savePinnedItem, loadPinnedItems } from './database.js';

window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed');
  console.log('Direct getElementById("canvas-container"):', document.getElementById('canvas-container'));
  // --- UI Element Lookups with Null Checks ---
  function getEl(id) {
    const el = document.getElementById(id);
    console.log(`getEl called for id='${id}', found:`, el);
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
  const MOVE_SENSITIVITY = 0.1; // Faster movement (was 0.05)
  const LOOK_SENSITIVITY = 0.3; // Increased look speed multiplier (was 0.15)
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
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, {
        scope: import.meta.env.BASE_URL
      })
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
  let pinningMode = false;
  let tempPreviewPlane = null;
  let pinnedPhotoCounter = 0;
  let selectedPinningPosition = null;
  let confirmPinButton = null;

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
      addContentBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
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
      addContentBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
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

  // Helper function to enable/disable the Pin Photo button based on image availability
  function updatePinButtonState() {
    if (pinPhotoBtn) {
      pinPhotoBtn.disabled = !processedImageBlob;
    }
  }

  // Raycast helper function
  function createRaycastFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const pointer = new THREE.Vector2(x, y);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    return raycaster;
  }

  // Initialize the IndexedDB database
  initDB().then(() => {
    console.log('Database initialized, loading saved photos...');
    // Load pinned photos from database
    loadPinnedItems(scene, recreatePhotoMeshFromDB);
  }).catch(error => {
    console.error('Failed to initialize database:', error);
  });
  
  // Function to recreate a photo mesh from database data
  function recreatePhotoMeshFromDB(imageBlob, metadata) {
    if (!imageBlob) {
      console.error(`Cannot recreate photo mesh: imageBlob is null for imageId: ${metadata.imageId}`);
      return;
    }
    
    console.log(`Recreating photo mesh for imageId: ${metadata.imageId}, blob size: ${imageBlob.size} bytes`);
    
    const img = new Image();
    const blobUrl = URL.createObjectURL(imageBlob);
    img.src = blobUrl;
    
    img.onload = () => {
      console.log(`Image loaded successfully for imageId: ${metadata.imageId}, dimensions: ${img.width}x${img.height}`);
      
      const aspectRatio = img.width / img.height;
      const planeWidth = 5;
      const planeHeight = planeWidth / aspectRatio;
      
      // Create geometry with the correct aspect ratio
      const planeGeo = new THREE.PlaneGeometry(planeWidth, planeHeight);
      
      // Create texture from the blob
      const texture = new THREE.TextureLoader().load(blobUrl, 
        // onLoad callback
        () => console.log(`Texture loaded successfully for imageId: ${metadata.imageId}`),
        // onProgress callback (not used)
        undefined,
        // onError callback
        (error) => console.error(`Error loading texture for imageId: ${metadata.imageId}`, error)
      );
      
      // Use MeshBasicMaterial for correct brightness, ignoring scene lighting
      const planeMat = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true
      });
      // Slightly tone down the brightness if needed
      planeMat.color.multiplyScalar(0.9);
      
      // Create and position the photo mesh
      const pinnedPhotoMesh = new THREE.Mesh(planeGeo, planeMat);
      
      // Set position from metadata
      pinnedPhotoMesh.position.set(
        metadata.position.x,
        metadata.position.y,
        metadata.position.z
      );
      
      // Set orientation from metadata
      pinnedPhotoMesh.quaternion.set(
        metadata.orientation.x,
        metadata.orientation.y,
        metadata.orientation.z,
        metadata.orientation.w
      );
      
      // Set scale from metadata
      pinnedPhotoMesh.scale.set(
        metadata.scale.x,
        metadata.scale.y,
        metadata.scale.z
      );
      
      // Store metadata in the mesh for potential later use
      pinnedPhotoMesh.userData = {
        imageId: metadata.imageId,
        timestamp: metadata.timestamp,
        position: metadata.position,
        orientation: metadata.orientation,
        scale: metadata.scale
      };
      
      // Add to scene
      scene.add(pinnedPhotoMesh);
      console.log(`Photo mesh added to scene for imageId: ${metadata.imageId}`);
      
      // Clean up blob URL
      URL.revokeObjectURL(blobUrl);
    };
    
    img.onerror = (error) => {
      console.error(`Failed to load image from blob for imageId: ${metadata.imageId}`, error);
      URL.revokeObjectURL(blobUrl);
    };
  }

  // Update the existing createPhotoPlane function to save to DB
  function createPhotoPlane(intersection) {
    // Validation and logging
    if (!processedImageBlob) {
      console.error('Cannot create photo plane: processedImageBlob is null');
      return;
    }
    
    console.log(`Creating photo plane with image blob, size: ${processedImageBlob.size} bytes, type: ${processedImageBlob.type}`);
    
    // Create a local copy of the blob to prevent issues with global state changes
    const localImageBlob = processedImageBlob.slice(0, processedImageBlob.size, processedImageBlob.type);
    console.log('Created local copy of blob in createPhotoPlane:', localImageBlob);
    
    // Get the image aspect ratio to create a properly sized plane
    const img = new Image();
    const blobUrl = URL.createObjectURL(localImageBlob);
    img.src = blobUrl;
    
    const onImageLoad = () => {
      console.log(`Image loaded successfully, dimensions: ${img.width}x${img.height}`);
      console.log('Inside onImageLoad, global processedImageBlob is:', processedImageBlob);
      console.log('Inside onImageLoad, using local copy localImageBlob:', localImageBlob);
      
      const aspectRatio = img.width / img.height;
      const planeWidth = 5;
      const planeHeight = planeWidth / aspectRatio;
      
      // Create geometry with the correct aspect ratio
      const planeGeo = new THREE.PlaneGeometry(planeWidth, planeHeight);
      
      // Create texture from the blob
      const texture = new THREE.TextureLoader().load(blobUrl, 
        // onLoad callback
        () => console.log('Texture loaded successfully'),
        // onProgress callback (not used)
        undefined,
        // onError callback
        (error) => console.error('Error loading texture:', error)
      );
      
      // Use MeshBasicMaterial for correct brightness, ignoring scene lighting
      const planeMat = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true
      });
      // Slightly tone down the brightness if needed
      planeMat.color.multiplyScalar(0.9);
      
      // Create and position the photo mesh
      const pinnedPhotoMesh = new THREE.Mesh(planeGeo, planeMat);
      
      // Position at intersection point
      pinnedPhotoMesh.position.copy(intersection.point);
      
      // Orient the mesh based on the surface normal
      if (Math.abs(intersection.face.normal.y) > 0.95) {
        // STEP 1: Make it lie flat (absolute orientation)
        // This makes the plane's normal align with world Y-axis
        pinnedPhotoMesh.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ'));
        
        // STEP 2: Rotate around world Y-axis to align with camera's horizontal view
        // Get camera direction projected onto XZ plane (horizontal plane)
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0; // Ignore vertical component
        cameraDirection.normalize();
        
        // Calculate Y rotation to align with camera's horizontal direction
        const alignWithCameraY = Math.atan2(cameraDirection.x, cameraDirection.z);
        
        // Apply Y rotation to the already flattened plane
        // Create a rotation quaternion around world Y axis
        const yRotationQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), 
          alignWithCameraY
        );
        
        // Apply the Y rotation after flattening
        pinnedPhotoMesh.quaternion.multiply(yRotationQuat);
      } else {
        // For walls and angled surfaces
        pinnedPhotoMesh.lookAt(
          intersection.point.clone().add(intersection.face.normal.clone().multiplyScalar(1.1))
        );
      }
      
      // Apply offset after orientation to prevent z-fighting
      pinnedPhotoMesh.position.addScaledVector(intersection.face.normal, 0.01);
      
      // Generate a unique image ID
      const imageId = `photo_${Date.now()}_${pinnedPhotoCounter++}`;
      console.log(`Generated imageId: ${imageId}`);
      
      // Store metadata
      pinnedPhotoMesh.userData = {
        imageId: imageId,
        timestamp: Date.now(),
        position: {
          x: pinnedPhotoMesh.position.x,
          y: pinnedPhotoMesh.position.y,
          z: pinnedPhotoMesh.position.z
        },
        orientation: {
          x: pinnedPhotoMesh.quaternion.x,
          y: pinnedPhotoMesh.quaternion.y,
          z: pinnedPhotoMesh.quaternion.z,
          w: pinnedPhotoMesh.quaternion.w
        },
        scale: {
          x: pinnedPhotoMesh.scale.x,
          y: pinnedPhotoMesh.scale.y,
          z: pinnedPhotoMesh.scale.z
        }
      };
      
      // Add to scene
      scene.add(pinnedPhotoMesh);
      console.log('Photo mesh added to scene');
      
      // Use the local copy we created earlier instead of the potentially cleared global variable
      // This ensures we have a valid blob even if processedImageBlob has been cleared
      console.log('Inside onImageLoad, using localImageBlob:', localImageBlob);
      const imageBlob = localImageBlob.slice(0, localImageBlob.size, localImageBlob.type);
      console.log('Created database-ready imageBlob:', imageBlob);
      
      // Save to database
      savePinnedItem(
        imageBlob, 
        imageId, 
        {
          position: pinnedPhotoMesh.userData.position,
          orientation: pinnedPhotoMesh.userData.orientation,
          scale: pinnedPhotoMesh.userData.scale
        }
      ).then(() => {
        console.log(`Photo saved to database successfully with imageId: ${imageId}`);
      }).catch(error => {
        console.error(`Failed to save photo to database with imageId: ${imageId}`, error);
      });
      
      // Clean up
      URL.revokeObjectURL(blobUrl);
    };
    
    img.onload = onImageLoad;
    
    img.onerror = (error) => {
      console.error('Failed to load image from blob:', error);
      URL.revokeObjectURL(blobUrl);
    };
  }

  // Handle showing/hiding preview plane during pinning mode
  function updatePreviewPlane(event) {
    if (!pinningMode) return;
    
    const raycaster = createRaycastFromEvent(event);
    const intersectableObjects = [ground, wall1, wall2, wall3];
    const intersects = raycaster.intersectObjects(intersectableObjects);
    
    if (intersects.length > 0) {
      const intersection = intersects[0];
      
      // Create preview plane if it doesn't exist
      if (!tempPreviewPlane) {
        const previewGeo = new THREE.PlaneGeometry(5, 3);
        // Use MeshBasicMaterial for consistent visualization with the final pinned image
        const previewMat = new THREE.MeshBasicMaterial({
          color: 0x00ff00,
          wireframe: true,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide
        });
        tempPreviewPlane = new THREE.Mesh(previewGeo, previewMat);
        scene.add(tempPreviewPlane);
      }
      
      // Position the preview plane
      tempPreviewPlane.position.copy(intersection.point);
      
      // Orient the preview plane - match createPhotoPlane exactly
      if (Math.abs(intersection.face.normal.y) > 0.95) {
        // STEP 1: Make it lie flat (absolute orientation)
        // This makes the plane's normal align with world Y-axis
        tempPreviewPlane.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ'));
        
        // STEP 2: Rotate around world Y-axis to align with camera's horizontal view
        // Get camera direction projected onto XZ plane (horizontal plane)
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0; // Ignore vertical component
        cameraDirection.normalize();
        
        // Calculate Y rotation to align with camera's horizontal direction
        const alignWithCameraY = Math.atan2(cameraDirection.x, cameraDirection.z);
        
        // Apply Y rotation to the already flattened plane
        // Create a rotation quaternion around world Y axis
        const yRotationQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), 
          alignWithCameraY
        );
        
        // Apply the Y rotation after flattening
        tempPreviewPlane.quaternion.multiply(yRotationQuat);
      } else {
        // For walls and angled surfaces
        tempPreviewPlane.lookAt(
          intersection.point.clone().add(intersection.face.normal.clone().multiplyScalar(1.1))
        );
      }
      
      // Add offset after orientation
      tempPreviewPlane.position.addScaledVector(intersection.face.normal, 0.01);
      tempPreviewPlane.visible = true;
    } else if (tempPreviewPlane) {
      tempPreviewPlane.visible = false;
    }
  }

  // Create or get confirm pin button
  function getConfirmPinButton() {
    if (!confirmPinButton) {
      confirmPinButton = document.createElement('button');
      confirmPinButton.id = 'confirmPinBtn';
      confirmPinButton.textContent = 'Confirm Pin';
      confirmPinButton.style.position = 'fixed';
      confirmPinButton.style.bottom = '100px';
      confirmPinButton.style.left = '50%';
      confirmPinButton.style.transform = 'translateX(-50%)';
      confirmPinButton.style.background = 'rgba(0, 180, 0, 0.8)';
      confirmPinButton.style.color = 'white';
      confirmPinButton.style.padding = '12px 24px';
      confirmPinButton.style.borderRadius = '24px';
      confirmPinButton.style.border = 'none';
      confirmPinButton.style.zIndex = '100';
      confirmPinButton.style.display = 'none';
      confirmPinButton.style.fontWeight = 'bold';
      confirmPinButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
      
      document.body.appendChild(confirmPinButton);
      
      confirmPinButton.addEventListener('click', () => {
        if (selectedPinningPosition) {
          console.log('Confirm button clicked, before createPhotoPlane processedImageBlob is:', processedImageBlob);
          
          // Create permanent photo using selected position
          createPhotoPlane(selectedPinningPosition);
          
          // Exit pinning mode
          togglePinningMode(false);
          
          // Store a reference to current image before clearing
          const currentBlob = processedImageBlob;
          console.log('After createPhotoPlane, about to set processedImageBlob to null. Current value:', currentBlob);
          
          // Disable pin button until a new photo is selected - SETTING NULL AFTER createPhotoPlane executed
          processedImageBlob = null;
          updatePinButtonState();
        }
      });
    }
    
    return confirmPinButton;
  }

  // Enter or exit pinning mode
  function togglePinningMode(enter) {
    pinningMode = enter;
    selectedPinningPosition = null;
    
    if (enter) {
      addContentBtn.innerHTML = '<span class="material-symbols-outlined">cancel</span>';
      addContentBtn.setAttribute('data-mode', 'pinning');
      
      // Hide confirm button initially
      const confirmBtn = getConfirmPinButton();
      confirmBtn.style.display = 'none';
      
      // Optionally show a helper message
      const helpMsg = document.createElement('div');
      helpMsg.id = 'pinning-helper';
      helpMsg.textContent = 'Tap on a surface to position your photo';
      helpMsg.style.position = 'fixed';
      helpMsg.style.top = '20px';
      helpMsg.style.left = '50%';
      helpMsg.style.transform = 'translateX(-50%)';
      helpMsg.style.background = 'rgba(0,0,0,0.7)';
      helpMsg.style.color = 'white';
      helpMsg.style.padding = '10px 20px';
      helpMsg.style.borderRadius = '20px';
      helpMsg.style.zIndex = '100';
      document.body.appendChild(helpMsg);
    } else {
      addContentBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
      addContentBtn.removeAttribute('data-mode');
      
      // Hide confirm button when exiting pinning mode
      if (confirmPinButton) {
        confirmPinButton.style.display = 'none';
      }
      
      // Remove the preview plane if it exists
      if (tempPreviewPlane) {
        scene.remove(tempPreviewPlane);
        tempPreviewPlane.geometry.dispose();
        tempPreviewPlane.material.dispose();
        tempPreviewPlane = null;
      }
      
      // Remove helper message if it exists
      const helpMsg = document.getElementById('pinning-helper');
      if (helpMsg) {
        document.body.removeChild(helpMsg);
      }
    }
  }

  // Process raycast hit and select position for pin
  function handlePinningClick(event) {
    if (!pinningMode || !processedImageBlob) return;
    
    const raycaster = createRaycastFromEvent(event);
    const intersectableObjects = [ground, wall1, wall2, wall3];
    const intersects = raycaster.intersectObjects(intersectableObjects);
    
    if (intersects.length > 0) {
      // Store the selected position for later use
      selectedPinningPosition = intersects[0];
      
      // Update helper message
      const helpMsg = document.getElementById('pinning-helper');
      if (helpMsg) {
        helpMsg.textContent = 'Position selected. Click "Confirm Pin" to place your photo.';
      }
      
      // Show confirm button
      const confirmBtn = getConfirmPinButton();
      confirmBtn.style.display = 'block';
    }
  }

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
          console.log('processedImageBlob set from gallery:', processedImageBlob);
          imagePreview.src = URL.createObjectURL(blob);
          showPanelView('imagePreviewView');
          stopCamera();
          // Enable the pin button since we have an image
          updatePinButtonState();
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
      console.log('processedImageBlob set from camera capture:', processedImageBlob);
      imagePreview.src = URL.createObjectURL(blob);
      showPanelView('imagePreviewView');
      stopCamera();
      // Enable the pin button since we have an image
      updatePinButtonState();
    }, 'image/jpeg', 0.8);
  });
  // Pin photo implementation
  if (pinPhotoBtn) pinPhotoBtn.addEventListener('click', () => {
    if (!processedImageBlob) {
      alert('Please capture or select an image first.');
      return;
    }
    
    // Enter pinning mode
    togglePinningMode(true);
    
    // Hide the content panel
    if (contentPanel) {
      contentPanel.classList.remove('panel-active');
      contentPanel.classList.remove('fullscreen-panel');
    }
  });
  // Choose different
  if (chooseDifferentBtn) chooseDifferentBtn.addEventListener('click', () => {
    processedImageBlob = null;
    imagePreview.src = '';
    showPanelView('contentTypeSelectView');
    // Disable pin button since we no longer have an image
    updatePinButtonState();
  });

  // Add content button can cancel pinning mode
  if (addContentBtn) {
    const originalClickHandler = addContentBtn.onclick;
    addContentBtn.addEventListener('click', () => {
      if (pinningMode) {
        togglePinningMode(false);
        return;
      }
      
      if (contentPanel && contentPanel.classList.contains('panel-active')) {
        closePanel();
      } else {
        openPanel();
      }
    });
  }

  // Add event listeners for pinning mode
  renderer.domElement.addEventListener('click', handlePinningClick);
  renderer.domElement.addEventListener('pointermove', updatePreviewPlane);

  // Initialize panel state
  closePanel();
  // Initial pin button state
  updatePinButtonState();

  // Joystick handle reset on touchend (ensure centering)
  if (joystickBase && joystickHandle) {
    joystickBase.addEventListener('touchend', e => {
      joystickDelta = { x: 0, y: 0 };
      joystickHandle.style.transform = 'translate(-50%, -50%)';
    });
  }
});
