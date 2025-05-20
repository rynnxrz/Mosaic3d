import './style.css'
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initDB, savePinnedItem, loadPinnedItems } from './database.js';

window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed');
  console.log('Direct getElementById("canvas-container"):', document.getElementById('canvas-container'));
  
  // Test if touch events are being recognized
  console.log('Touch events supported:', 'ontouchstart' in window);
  document.body.addEventListener('touchstart', () => {
    console.log('Body touchstart detected');
  }, { passive: true });
  
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
  const photoScaleSlider = getEl('photoScaleSlider');
  const photoScaleValue = getEl('photoScaleValue');

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
  const CAMERA_HEIGHT = 1.9; // Camera Y position (eye level in meters)
  const CAMERA_COLLISION_RADIUS = 0.01; // Camera collision radius (reduced from 2.5)

  // --- Three.js 3D Scene Setup ---
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / (window.innerHeight * 0.8),
    0.1,
    1000
  );
  camera.position.set(3, CAMERA_HEIGHT, 20); // Start at a sensible position inside the room
  camera.lookAt(0, CAMERA_HEIGHT, 0); // Look forward at eye level

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setClearColor(0xf0f0f0);
  renderer.colorSpace = THREE.SRGBColorSpace; // Set renderer color space for correct PBR material rendering
  resizeRenderer();
  canvasContainer.appendChild(renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.7);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  dirLight.castShadow = true; // Enable shadows for directional light
  scene.add(dirLight);

  // Declare global variable to store the loaded model
  let loadedRoomModel;
  
  // Initialize empty arrays for collidables and intersectableObjects
  let collidables = [];
  let intersectableObjects = [];

  // Load RoomPlan model
  const loader = new GLTFLoader();
  loader.load(
    `${import.meta.env.BASE_URL}assets/room_model.glb`,
    function (gltf) {
      // Assign the loaded model to the global variable
      loadedRoomModel = gltf.scene;
      
      // Add the model to the scene
      scene.add(loadedRoomModel);
      
      // Log for inspection
      console.log('Loaded RoomPlan model:', gltf);
      console.log('RoomPlan model scene structure:', loadedRoomModel);
      
      // Enable shadows on model meshes and identify Wall2
      loadedRoomModel.traverse(function (child) {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          // TEMPORARY: Identify "Wall2"
          if (child.name === 'Wall2' || child.name.includes('Wall2')) {
            console.log('Found Wall2 for visual test:', child);
            console.log('Wall2 UUID:', child.uuid);
            console.log('Wall2 Bounding Box:', new THREE.Box3().setFromObject(child));
            
            // Option A: Make it bright red
            child.material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
            
            // Option B: Make it invisible (uncomment to see if you can pass through its space)
            // child.visible = false;
          }
        }
      });
      
      // Clear and populate collidables
      collidables = []; // Clear previous
      if (loadedRoomModel) {
        loadedRoomModel.traverse(function (child) {
          if (child.isMesh) {
            // Filter out Wall2 from collidables to allow movement through the glass wall
            if (child.name !== 'Wall2' && !child.name.includes('Wall2')) {
              collidables.push(child);
            } else {
              console.log('Excluding mesh from collidables:', child.name, child.uuid);
            }
          }
        });
      }
      console.log('Updated collidables (Wall2 excluded):', collidables);
      console.log('Updated collidables for navigation:', collidables);
      
      // Clear and populate intersectableObjects
      intersectableObjects = []; // Clear previous
      if (loadedRoomModel) {
        intersectableObjects.push(loadedRoomModel); // Add the whole model group
      }
      console.log('Updated intersectableObjects for photo-pinning:', intersectableObjects);
    },
    undefined, // onProgress callback
    function (error) {
      console.error('Error loading GLTF model:', error);
    }
  );

  // --- Virtual Joystick State ---
  let joystickActive = false;
  let joystickCenter = { x: 0, y: 0 };
  let joystickDelta = { x: 0, y: 0 };

  joystickBase.addEventListener('touchstart', e => {
    console.log('Joystick touchstart');
    joystickActive = true;
    const rect = joystickBase.getBoundingClientRect();
    joystickCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    console.log('Joystick center:', joystickCenter);
    if (e.touches.length > 0) {
      console.log('Joystick touchstart position:', { 
        x: e.touches[0].clientX, 
        y: e.touches[0].clientY 
      });
      updateJoystick(e.touches[0]);
    }
  }, { passive: false });
  joystickBase.addEventListener('touchmove', e => {
    console.log('Joystick touchmove');
    if (joystickActive && e.touches.length > 0) {
      console.log('Joystick touchmove position:', { 
        x: e.touches[0].clientX, 
        y: e.touches[0].clientY 
      });
      updateJoystick(e.touches[0]);
    }
    e.preventDefault();
  }, { passive: false });
  joystickBase.addEventListener('touchend', e => {
    console.log('Joystick touchend');
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
    
    console.log('updateJoystick values:', { dx, dy, dist, angle, normX, normY });
    joystickDelta = { x: normX, y: normY };
    console.log('Updated joystickDelta:', joystickDelta);
    
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
  yaw = Math.atan2(camera.position.x, camera.position.z); // Calculate initial yaw based on camera position
  pitch = 0; // Start with level look
  camera.position.y = CAMERA_HEIGHT;

  function tryMoveCamera(newPos) {
    // Simple collision: check against collidables
    const isJoystickActiveAndMoving = joystickActive && (joystickDelta.x !== 0 || joystickDelta.y !== 0);
    
    for (const mesh of collidables) {
      const rawBox = new THREE.Box3().setFromObject(mesh); // Get raw box first
      const expandedBox = rawBox.clone().expandByScalar(CAMERA_COLLISION_RADIUS); // Then expanded
      
      const checkPoint = new THREE.Vector3(newPos.x, CAMERA_HEIGHT, newPos.z);
      
      if (expandedBox.containsPoint(checkPoint)) {
        if (isJoystickActiveAndMoving) { // Only log details if joystick is trying to move
          console.log(
            'COLLISION! Mesh Name:', mesh.name || mesh.uuid,
            '| Raw Box Y: [', rawBox.min.y.toFixed(3), ',', rawBox.max.y.toFixed(3), ']',
            '| Expanded Box Y: [', expandedBox.min.y.toFixed(3), ',', expandedBox.max.y.toFixed(3), ']',
            '| Camera Check Point Y:', checkPoint.y.toFixed(3),
            '| Collision Radius:', CAMERA_COLLISION_RADIUS
          );
          // Temporarily comment out these more verbose logs
          // console.log('Colliding Mesh Object:', mesh);
          // console.log('Raw BBox:', rawBox);
          // console.log('Expanded BBox:', expandedBox);
          // console.log('Camera Check Point:', checkPoint);
        }
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
    // Enhanced debugging for joystick movement
    console.log('updateCamera: joystick state:', { 
      active: joystickActive, 
      delta: { x: joystickDelta.x, y: joystickDelta.y },
      sensitivity: MOVE_SENSITIVITY
    });
    
    move.addScaledVector(forward, -joystickDelta.y * MOVE_SENSITIVITY);
    move.addScaledVector(right, -joystickDelta.x * MOVE_SENSITIVITY);
    console.log('updateCamera: move vector:', { x: move.x, y: move.y, z: move.z });
    
    // Try to move, check collision
    const newPos = camera.position.clone().add(move);
    newPos.y = CAMERA_HEIGHT;
    
    const canMove = tryMoveCamera(newPos);
    
    if (!canMove && (joystickActive && (joystickDelta.x !== 0 || joystickDelta.y !== 0))) {
      console.log('updateCamera: Movement blocked by collision.');
    }
    
    if (canMove) {
      console.log('updateCamera: Moving to new position:', { 
        x: newPos.x, 
        y: newPos.y, 
        z: newPos.z 
      });
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

  // --- Photo Scaling Variables ---
  let currentPhotoScale = 1.0;
  let currentPreviewImageAspectRatio = 16/9; // Default fallback
  const BASE_PHOTO_WIDTH = 1.0; // Base width for photos

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
    
    // If showing image preview, ensure the scale slider reflects the current scale
    if (viewId === 'imagePreviewView' && photoScaleSlider && photoScaleValue) {
      photoScaleSlider.value = currentPhotoScale;
      photoScaleValue.textContent = currentPhotoScale.toFixed(1) + 'x';
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

  // Event listener for photo scale slider
  if (photoScaleSlider && photoScaleValue) {
    photoScaleSlider.value = currentPhotoScale; // Initialize slider position
    photoScaleValue.textContent = currentPhotoScale.toFixed(1) + 'x'; // Initialize text
    
    photoScaleSlider.addEventListener('input', (e) => {
      currentPhotoScale = parseFloat(e.target.value);
      photoScaleValue.textContent = currentPhotoScale.toFixed(1) + 'x';

      // If tempPreviewPlane is active and we know the aspect ratio, update its geometry
      if (tempPreviewPlane && currentPreviewImageAspectRatio > 0) {
        const previewWidth = BASE_PHOTO_WIDTH * currentPhotoScale;
        const previewHeight = previewWidth / currentPreviewImageAspectRatio;
        if (tempPreviewPlane.geometry.parameters.width !== previewWidth || 
            tempPreviewPlane.geometry.parameters.height !== previewHeight) {
          tempPreviewPlane.geometry.dispose();
          tempPreviewPlane.geometry = new THREE.PlaneGeometry(previewWidth, previewHeight);
          
          // Force update preview position if in pinning mode
          if (pinningMode && tempPreviewPlane.visible) {
            // Create a synthetic event to trigger updatePreviewPlane
            const dummyEvent = new MouseEvent('pointermove', {
              clientX: window.innerWidth / 2,
              clientY: window.innerHeight / 2
            });
            updatePreviewPlane(dummyEvent);
          }
        }
      }
    });
  } else {
    console.error('Photo scale slider UI elements not found!'); // Help debug visibility
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
      
      // Get user scale if available, otherwise default to 1.0
      const userScale = metadata.userScale || 1.0;
      
      // Get saved aspect ratio or calculate from image
      const imageAspectRatio = img.width / img.height;
      const finalAspectRatio = metadata.aspectRatio || imageAspectRatio;
      
      console.log(`Recreating photo with scale: ${userScale}, aspect ratio: ${finalAspectRatio}`);
      
      // Calculate plane dimensions based on scale
      const planeWidth = BASE_PHOTO_WIDTH * userScale;
      const planeHeight = planeWidth / finalAspectRatio;
      
      // Create geometry with the correct aspect ratio and scale
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
        scale: metadata.scale,
        userScale: userScale,
        aspectRatio: finalAspectRatio
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
    console.log(`Using photo scale: ${currentPhotoScale}, aspect ratio: ${currentPreviewImageAspectRatio}`);
    
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
      
      // Use the aspect ratio from the image or fall back to stored preview aspect ratio
      const aspectRatio = img.width / img.height;
      console.log(`Using aspect ratio: ${aspectRatio}, with scale: ${currentPhotoScale}`);
      
      // Calculate plane dimensions based on scale
      const actualPlaneWidth = BASE_PHOTO_WIDTH * currentPhotoScale;
      const actualPlaneHeight = actualPlaneWidth / aspectRatio;
      
      // Create geometry with the correct aspect ratio and scale
      const planeGeo = new THREE.PlaneGeometry(actualPlaneWidth, actualPlaneHeight);
      
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
      
      // Transform local normal to world normal
      const worldNormal = new THREE.Vector3();
      worldNormal.copy(intersection.face.normal);
      worldNormal.transformDirection(intersection.object.matrixWorld);
      worldNormal.normalize();
      
      // Orient the mesh based on the surface normal
      if (Math.abs(worldNormal.y) > 0.95) {
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
        // For walls and angled surfaces, use worldNormal instead of local normal
        const lookAtTarget = intersection.point.clone().add(worldNormal);
        pinnedPhotoMesh.lookAt(lookAtTarget);
      }
      
      // Apply offset after orientation to prevent z-fighting, using worldNormal
      pinnedPhotoMesh.position.addScaledVector(worldNormal, 0.01);
      
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
        },
        userScale: currentPhotoScale,
        aspectRatio: aspectRatio
      };
      
      // Add to scene
      scene.add(pinnedPhotoMesh);
      console.log('Photo mesh added to scene');
      
      // Use the local copy we created earlier instead of the potentially cleared global variable
      // This ensures we have a valid blob even if processedImageBlob has been cleared
      console.log('Inside onImageLoad, using localImageBlob:', localImageBlob);
      const imageBlob = localImageBlob.slice(0, localImageBlob.size, localImageBlob.type);
      console.log('Created database-ready imageBlob:', imageBlob);
      
      // Save to database with scale information
      savePinnedItem(
        imageBlob, 
        imageId, 
        {
          position: pinnedPhotoMesh.userData.position,
          orientation: pinnedPhotoMesh.userData.orientation,
          scale: pinnedPhotoMesh.userData.scale,
          userScale: currentPhotoScale,
          aspectRatio: aspectRatio
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
    const intersects = raycaster.intersectObjects(intersectableObjects);
    
    if (intersects.length > 0) {
      const intersection = intersects[0];
      
      // Calculate preview dimensions based on scale and current aspect ratio
      const previewWidth = BASE_PHOTO_WIDTH * currentPhotoScale;
      const previewHeight = previewWidth / currentPreviewImageAspectRatio;
      
      // Check if we need to create a new preview plane or update an existing one
      if (tempPreviewPlane) {
        // If dimensions have changed, dispose of the old preview plane
        const currentGeo = tempPreviewPlane.geometry;
        if (currentGeo.parameters.width !== previewWidth || 
            currentGeo.parameters.height !== previewHeight) {
          console.log(`Recreating preview with new dimensions: ${previewWidth} x ${previewHeight}`);
          scene.remove(tempPreviewPlane);
          tempPreviewPlane.geometry.dispose();
          tempPreviewPlane.material.dispose();
          tempPreviewPlane = null;
        }
      }
      
      // Create preview plane if it doesn't exist
      if (!tempPreviewPlane) {
        const previewGeo = new THREE.PlaneGeometry(previewWidth, previewHeight);
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
        console.log(`Created preview plane with dimensions: ${previewWidth} x ${previewHeight}`);
      }
      
      // Position the preview plane
      tempPreviewPlane.position.copy(intersection.point);
      
      // Transform local normal to world normal
      const worldNormal = new THREE.Vector3();
      worldNormal.copy(intersection.face.normal);
      worldNormal.transformDirection(intersection.object.matrixWorld);
      worldNormal.normalize();
      
      // Orient the preview plane - match createPhotoPlane exactly
      if (Math.abs(worldNormal.y) > 0.95) {
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
        // For walls and angled surfaces, use worldNormal instead of local normal
        const lookAtTarget = intersection.point.clone().add(worldNormal);
        tempPreviewPlane.lookAt(lookAtTarget);
      }
      
      // Add offset after orientation using worldNormal
      tempPreviewPlane.position.addScaledVector(worldNormal, 0.01);
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
        
        // Store the aspect ratio for later use
        currentPreviewImageAspectRatio = img.naturalWidth / img.naturalHeight;
        console.log(`Image loaded with aspect ratio: ${currentPreviewImageAspectRatio}`);
        
        // Reset photo scale to default when loading a new image
        currentPhotoScale = 1.0;
        if (photoScaleSlider && photoScaleValue) {
          photoScaleSlider.value = currentPhotoScale;
          photoScaleValue.textContent = currentPhotoScale.toFixed(1) + 'x';
        }
        
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
    
    // Store the aspect ratio for later use
    currentPreviewImageAspectRatio = canvas.width / canvas.height;
    console.log(`Camera capture with aspect ratio: ${currentPreviewImageAspectRatio}`);
    
    // Reset photo scale to default when capturing a new image
    currentPhotoScale = 1.0;
    if (photoScaleSlider && photoScaleValue) {
      photoScaleSlider.value = currentPhotoScale;
      photoScaleValue.textContent = currentPhotoScale.toFixed(1) + 'x';
    }
    
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
    
    // Reset photo scale to default
    currentPhotoScale = 1.0;
    currentPreviewImageAspectRatio = 16/9;
    if (photoScaleSlider && photoScaleValue) {
      photoScaleSlider.value = currentPhotoScale;
      photoScaleValue.textContent = currentPhotoScale.toFixed(1) + 'x';
    }
    
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

  // Prevent context menu on long press for relevant elements
  const elementsToBlockContextMenu = [canvasContainer, lookArea, joystickBase, contentPanel, imagePreviewView];
  elementsToBlockContextMenu.forEach(el => {
    if (el) {
      el.addEventListener('contextmenu', function(e) {
        // e.preventDefault(); // Temporarily comment this out to re-enable inspect
      });
    }
  });

  // Joystick handle reset on touchend (ensure centering)
  if (joystickBase && joystickHandle) {
    joystickBase.addEventListener('touchend', e => {
      joystickDelta = { x: 0, y: 0 };
      joystickHandle.style.transform = 'translate(-50%, -50%)';
    });
  }
});
