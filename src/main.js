import './style.css'
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initDB, savePinnedItem, loadPinnedItems, getAllPinnedPhotoMetadata } from './database.js';

window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed');
  console.log('Direct getElementById("canvas-container"):', document.getElementById('canvas-container'));
  
  // Test if touch events are being recognized
  console.log('Touch events supported:', 'ontouchstart' in window);
  document.body.addEventListener('touchstart', () => {
    console.log('Body touchstart detected');
  }, { passive: true });
  
  // --- State Variables for UI and 3D Scene ---
  // Photo pinning variables
  let processedImageBlob = null;
  let cameraStream = null;
  let cameraFacingMode = 'environment';
  let pinningMode = false;
  let tempPreviewPlane = null;
  let pinnedPhotoCounter = 0;
  
  // Photo scaling variables
  let currentPhotoScale = 1.0;
  let currentPreviewImageAspectRatio = 16/9; // Default fallback
  const BASE_PHOTO_WIDTH = 1.0; // Base width for photos
  
  // Three-stage photo placement variables
  let currentPlacementStage = 'none'; // 'none', 'initialPreview', 'fineAdjustment', 'setViewpoint'
  let lockedInitialPosition = null;
  let lockedInitialQuaternion = null;
  let lockedInitialScale = null;
  const FIXED_PREVIEW_DISTANCE = 2.5; // Distance in front of camera for initial preview
  let confirmInitialPosBtn = null;
  let stageIndicator = null;
  let finalPhotoTransform = null;

  // Viewpoint review mode variables
  let isReviewingViewpoints = false;
  let viewablePinsQueue = [];
  let currentViewpointIndex = -1;
  
  // Camera animation variables for view mode
  let isTransitioningCamera = false;
  let startPosition = null;
  let startQuaternion = null;
  let targetPosition = null;
  let targetQuaternion = null;
  const LERP_FACTOR = 0.05; // Position interpolation factor
  const SLERP_FACTOR = 0.05; // Rotation interpolation factor
  let allPinnedPhotosData = [];
  let currentViewedPinIndex = -1;
  let currentPinInfoElement = null;
  let transitionFrameCounter = 0;
  const MAX_TRANSITION_FRAMES = 300; // 5 seconds at 60fps

  // Stage 3 variables
  let recordedCreatorPosition = null;
  let recordedCreatorQuaternion = null;
  let recordViewpointBtn = null;
  let skipViewpointBtn = null;
  let completePlacementBtn = null;
  let viewpointInstructionsElement = null;
  
  // Fine adjustment constants and variables
  const ADJUST_STEP = 0.05; // Position adjustment step (in meters/units)
  const ROTATION_STEP = Math.PI / 36; // Rotation adjustment step (5 degrees)
  let fineAdjustmentPanel = null;
  let tabButtons = null;
  let tabContents = null;
  
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
  const reviewCreatorViewpointsBtn = getEl('reviewCreatorViewpointsBtn');

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
            
            // Apply glass-like material
            child.visible = true; // Ensure it's visible
            
            // Create and apply the new glass material
            const glassMaterial = new THREE.MeshPhysicalMaterial({
                color: 0xcccccc,          // A light grey/white base color for glass
                transmission: 1.0,        // Full light transmission for glass effect
                opacity: 0.2,             // Adjust opacity for subtle glass
                transparent: true,
                roughness: 0.05,          // Smooth surface
                metalness: 0.1,           // Low metalness
                thickness: 0.1,           // Affects transmission
                side: THREE.DoubleSide,   // Render both sides, important for thin planes
                clearcoat: 0.5,           // Extra glossy layer
                clearcoatRoughness: 0.03,
                ior: 1.5                  // Index of Refraction (glass is around 1.45-1.55)
            });
            child.material = glassMaterial;
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
  yaw = Math.atan2(camera.position.x, camera.position.z); // Calculate initial yaw based on camera position
  pitch = 0; // Start with level look
  camera.position.y = CAMERA_HEIGHT;

  function tryMoveCamera(newPos) {
    console.log('tryMoveCamera: Collisions temporarily disabled. Allowing all movement.');
    return true; // <-- This makes all objects passable

    /* --- Original collision logic commented out ---
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
    */
  }

  function updateCamera() {
    // Skip user controls if camera is transitioning
    if (isTransitioningCamera) {
      return;
    }
    
    // If we are in review mode AND no new look input,
    // let the camera's quaternion remain as set by the transition's end
    if (isReviewingViewpoints && lookDelta.x === 0 && lookDelta.y === 0) {
      // We are at a creator viewpoint, and the user isn't actively trying to look around.
      // The camera's quaternion is already correctly set from the transition's end.
      // We might still want to handle joystick movement if applicable, but skip lookAt based on yaw/pitch.
      
      // Handle joystick movement (copied from existing logic, but without lookAt)
      const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // Use current yaw for forward
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // Use current yaw for right
      let move = new THREE.Vector3();
      move.addScaledVector(forward, -joystickDelta.y * MOVE_SENSITIVITY);
      move.addScaledVector(right, -joystickDelta.x * MOVE_SENSITIVITY);
      
      const newPos = camera.position.clone().add(move);
      // IMPORTANT: When at a creator viewpoint, camera.position.y should be targetPosition.y
      // For simplicity in MVP, if joystick is used here, it might revert to CAMERA_HEIGHT.
      // For now, let's keep it simple: allow movement but it might change height.
      newPos.y = CAMERA_HEIGHT; 
      
      const canMove = tryMoveCamera(newPos);
      if (canMove) {
        camera.position.copy(newPos);
      }
      // DO NOT CALL camera.lookAt() here if no new look input.
      // The camera.quaternion is already set.
      return; 
    }
    
    // --- Default Look (yaw/pitch) update logic for user control ---
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
    
    const canMove = tryMoveCamera(newPos);
    
    if (!canMove && (joystickActive && (joystickDelta.x !== 0 || joystickDelta.y !== 0))) {
      console.log('updateCamera: Movement blocked by collision.');
    }
    
    if (canMove) {
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
    
    // Update preview plane position in initialPreview stage
    if (pinningMode && currentPlacementStage === 'initialPreview' && tempPreviewPlane) {
      // Get camera's forward direction
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      
      // Position the preview plane in front of the camera
      tempPreviewPlane.position.copy(camera.position).add(direction.multiplyScalar(FIXED_PREVIEW_DISTANCE));
      
      // Make the preview plane face the camera
      tempPreviewPlane.quaternion.copy(camera.quaternion);
    }
    
    // Handle camera transition for view mode
    if (isTransitioningCamera && targetPosition && targetQuaternion) {
      // Increment the transition frame counter
      transitionFrameCounter++;
      
      // Interpolate position
      camera.position.lerp(targetPosition, LERP_FACTOR);
      
      // Interpolate rotation using spherical interpolation
      camera.quaternion.slerp(targetQuaternion, SLERP_FACTOR);
      
      // Check if we're close enough to the target to end the transition
      const positionDistance = camera.position.distanceTo(targetPosition);
      const quaternionDot = camera.quaternion.dot(targetQuaternion);
      
      // Condition for completion:
      // Position is close OR rotation is very close OR max frames reached.
      // Made position check slightly more lenient, dot product check also.
      if ((positionDistance < 0.02 && Math.abs(quaternionDot) > 0.999) || // Natural completion
          transitionFrameCounter > MAX_TRANSITION_FRAMES)                 // Forced completion
      {
        camera.position.copy(targetPosition);
        camera.quaternion.copy(targetQuaternion);
        
        isTransitioningCamera = false; // CRITICAL: Ensure this is set
        transitionFrameCounter = 0;
        console.log('Camera transition ended (distance: ' + positionDistance.toFixed(3) + ', dot: ' + quaternionDot.toFixed(5) + ')');

        // Synchronize yaw and pitch with the new camera quaternion
        // Get the forward vector from the camera's new quaternion
        const forwardVector = new THREE.Vector3(0, 0, -1);
        forwardVector.applyQuaternion(camera.quaternion);
        
        // Calculate yaw (around Y axis)
        yaw = Math.atan2(forwardVector.x, forwardVector.z);
        
        // Calculate pitch (angle with XZ plane)
        // Ensure forwardVector.y is clamped between -1 and 1 for asin
        const clampedY = Math.max(-1, Math.min(1, forwardVector.y));
        pitch = Math.asin(-clampedY); // Pitch is often negated depending on convention

        console.log('Synchronized yaw:', yaw.toFixed(3), 'pitch:', pitch.toFixed(3));

        const event = new CustomEvent('cameraTransitionComplete', {
          detail: { index: currentViewpointIndex }
        });
        document.dispatchEvent(event);
      }
    }
    
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

  // Service worker registration is handled by vite-plugin-pwa
  // No manual registration needed

  // --- New Add Content Panel UI Logic ---
  // Remove duplicate declarations - these are now at the top of DOMContentLoaded
  
  // --- Animation loop ---

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
      
      // Add creator viewpoint data if available
      if (metadata.creatorViewpointPosition_x !== undefined) {
        pinnedPhotoMesh.userData.creatorViewpoint = {
          position: {
            x: metadata.creatorViewpointPosition_x,
            y: metadata.creatorViewpointPosition_y,
            z: metadata.creatorViewpointPosition_z
          }
        };
        
        if (metadata.creatorViewpointQuaternion_x !== undefined) {
          pinnedPhotoMesh.userData.creatorViewpoint.quaternion = {
            x: metadata.creatorViewpointQuaternion_x,
            y: metadata.creatorViewpointQuaternion_y,
            z: metadata.creatorViewpointQuaternion_z,
            w: metadata.creatorViewpointQuaternion_w
          };
        }
        
        console.log(`Restored creator viewpoint for imageId: ${metadata.imageId}`, pinnedPhotoMesh.userData.creatorViewpoint);
      }
      
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
  function createPhotoPlane(imageBlobToSave, photoTransform, creatorViewpoint, photoScale, photoAspectRatio) {
    // Validation and logging
    if (!imageBlobToSave) {
      console.error('Cannot create photo plane: imageBlobToSave is null');
      return;
    }
    
    console.log(`Creating photo plane with image blob, size: ${imageBlobToSave.size} bytes, type: ${imageBlobToSave.type}`);
    console.log(`Using photo scale: ${photoScale}, aspect ratio: ${photoAspectRatio}`);
    
    if (creatorViewpoint) {
      console.log('Using creator viewpoint:', creatorViewpoint);
    } else {
      console.log('No creator viewpoint provided, photo will be created without viewpoint data');
    }
    
    // Create a local copy of the blob to prevent issues with global state changes
    const localImageBlob = imageBlobToSave.slice(0, imageBlobToSave.size, imageBlobToSave.type);
    console.log('Created local copy of blob in createPhotoPlane:', localImageBlob);
    
    // Get the image aspect ratio to create a properly sized plane
    const img = new Image();
    const blobUrl = URL.createObjectURL(localImageBlob);
    img.src = blobUrl;
    
    const onImageLoad = () => {
      console.log(`Image loaded successfully, dimensions: ${img.width}x${img.height}`);
      
      // Use the provided aspect ratio or calculate from the image
      const aspectRatio = photoAspectRatio || img.width / img.height;
      console.log(`Using aspect ratio: ${aspectRatio}, with scale: ${photoScale}`);
      
      // Calculate plane dimensions based on scale
      const actualPlaneWidth = BASE_PHOTO_WIDTH * photoScale;
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
      
      // Set position, orientation, and scale from photoTransform
      pinnedPhotoMesh.position.copy(photoTransform.position);
      pinnedPhotoMesh.quaternion.copy(photoTransform.quaternion);
      pinnedPhotoMesh.scale.copy(photoTransform.scale);
      
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
        userScale: photoScale,
        aspectRatio: aspectRatio
      };
      
      // Add creator viewpoint data if available
      if (creatorViewpoint && creatorViewpoint.position) {
        pinnedPhotoMesh.userData.creatorViewpoint = {
          position: {
            x: creatorViewpoint.position.x,
            y: creatorViewpoint.position.y,
            z: creatorViewpoint.position.z
          }
        };
        
        if (creatorViewpoint.quaternion) {
          pinnedPhotoMesh.userData.creatorViewpoint.quaternion = {
            x: creatorViewpoint.quaternion.x,
            y: creatorViewpoint.quaternion.y,
            z: creatorViewpoint.quaternion.z,
            w: creatorViewpoint.quaternion.w
          };
        }
        
        console.log(`Added creator viewpoint to userData for imageId: ${imageId}`);
      }
      
      // Add to scene
      scene.add(pinnedPhotoMesh);
      console.log('Photo mesh added to scene');
      
      // Use the local copy we created earlier instead of the potentially cleared global variable
      // This ensures we have a valid blob even if processedImageBlob has been cleared
      console.log('Inside onImageLoad, using localImageBlob:', localImageBlob);
      const imageBlob = localImageBlob.slice(0, localImageBlob.size, localImageBlob.type);
      console.log('Created database-ready imageBlob:', imageBlob);
      
      // Prepare transform data for database saving
      const transformDataForDB = {
        position: pinnedPhotoMesh.userData.position,
        orientation: pinnedPhotoMesh.userData.orientation,
        scale: pinnedPhotoMesh.userData.scale,
        userScale: photoScale,
        aspectRatio: aspectRatio
      };
      
      // Add creator viewpoint if available
      if (creatorViewpoint && creatorViewpoint.position) {
        let qData = null;
        if (creatorViewpoint.quaternion) { // Ensure the THREE.Quaternion object itself exists
          const ثلاثية_الابعاد_كواتيرنيون = creatorViewpoint.quaternion; // Use a distinct variable name for clarity
          console.log('[DEBUG main.js createPhotoPlane] Original THREE.Quaternion for viewpoint: ', 
            {x: ثلاثية_الابعاد_كواتيرنيون.x, y: ثلاثية_الابعاد_كواتيرنيون.y, z: ثلاثية_الابعاد_كواتيرنيون.z, w: ثلاثية_الابعاد_كواتيرنيون.w});
          
          qData = {
            x: Number(ثلاثية_الابعاد_كواتيرنيون.x),
            y: Number(ثلاثية_الابعاد_كواتيرنيون.y),
            z: Number(ثلاثية_الابعاد_كواتيرنيون.z),
            w: Number(ثلاثية_الابعاد_كواتيرنيون.w)
          };
          console.log('[DEBUG main.js createPhotoPlane] Prepared qData for DB: ', qData);
        }
        
        transformDataForDB.creatorViewpoint = {
          position: {
            x: creatorViewpoint.position.x,
            y: creatorViewpoint.position.y,
            z: creatorViewpoint.position.z
          },
          quaternion: qData // Assign the explicitly created plain object or null
        };
      }
      
      // Save to database with scale information and viewpoint
      savePinnedItem(
        imageBlob, 
        imageId, 
        transformDataForDB
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
    // This function is now only used for Stage 1 dynamic preview updates when the user is looking around
    // The fixed positioning logic is handled in the animate() function
    if (!pinningMode || currentPlacementStage !== 'initialPreview') return;
    
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
    
    // The rest of the preview positioning is handled in the animate() loop
    // which positions the preview plane in front of the camera
  }

  // Create confirm initial position button for stage 1
  function getConfirmInitialPosButton() {
    if (!confirmInitialPosBtn) {
      confirmInitialPosBtn = document.createElement('button');
      confirmInitialPosBtn.id = 'confirmInitialPosBtn';
      confirmInitialPosBtn.textContent = 'Move to the desired position and click to confirm';
      confirmInitialPosBtn.style.position = 'fixed';
      confirmInitialPosBtn.style.bottom = '100px';
      confirmInitialPosBtn.style.left = '50%';
      confirmInitialPosBtn.style.transform = 'translateX(-50%)';
      confirmInitialPosBtn.style.background = 'rgba(0, 180, 0, 0.8)';
      confirmInitialPosBtn.style.color = 'white';
      confirmInitialPosBtn.style.padding = '12px 24px';
      confirmInitialPosBtn.style.borderRadius = '24px';
      confirmInitialPosBtn.style.border = 'none';
      confirmInitialPosBtn.style.zIndex = '100';
      confirmInitialPosBtn.style.display = 'none';
      confirmInitialPosBtn.style.fontWeight = 'bold';
      confirmInitialPosBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
      
      document.body.appendChild(confirmInitialPosBtn);
      
      confirmInitialPosBtn.addEventListener('click', () => {
        if (currentPlacementStage === 'initialPreview' && tempPreviewPlane) {
          // Store the current transform
          lockedInitialPosition = tempPreviewPlane.position.clone();
          lockedInitialQuaternion = tempPreviewPlane.quaternion.clone();
          lockedInitialScale = tempPreviewPlane.scale.clone();
          
          // Move to stage 2
          currentPlacementStage = 'fineAdjustment';
          
          // Log the stored transform and stage change
          console.log('Initial position locked:', lockedInitialPosition);
          console.log('Initial rotation locked:', lockedInitialQuaternion);
          console.log('Initial scale locked:', lockedInitialScale);
          console.log('Transitioning to stage 2: fineAdjustment');
          
          // Update the stage indicator
          updateStageIndicator();
          
          // Hide stage 1 button
          confirmInitialPosBtn.style.display = 'none';
          
          // Enter stage 2
          enterFineAdjustmentStage();
        }
      });
    }
    
    return confirmInitialPosBtn;
  }

  // Create stage indicator
  function getStageIndicator() {
    if (!stageIndicator) {
      stageIndicator = document.createElement('div');
      stageIndicator.id = 'stageIndicator';
      stageIndicator.style.position = 'fixed';
      stageIndicator.style.top = '20px';
      stageIndicator.style.left = '50%';
      stageIndicator.style.transform = 'translateX(-50%)';
      stageIndicator.style.background = 'rgba(0, 0, 0, 0.7)';
      stageIndicator.style.color = 'white';
      stageIndicator.style.padding = '8px 16px';
      stageIndicator.style.borderRadius = '16px';
      stageIndicator.style.zIndex = '100';
      stageIndicator.style.fontWeight = 'bold';
      stageIndicator.style.display = 'none';
      
      document.body.appendChild(stageIndicator);
    }
    
    return stageIndicator;
  }

  // Update stage indicator based on current stage
  function updateStageIndicator() {
    const indicator = getStageIndicator();
    
    switch (currentPlacementStage) {
      case 'initialPreview':
        indicator.textContent = 'Step 1/3: Initial Positioning';
        indicator.style.display = 'block';
        break;
      case 'fineAdjustment':
        indicator.textContent = 'Step 2/3: Fine Adjustments';
        indicator.style.display = 'block';
        break;
      case 'setViewpoint':
        indicator.textContent = 'Step 3/3: Set Creator Viewpoint';
        indicator.style.display = 'block';
        break;
      default:
        indicator.style.display = 'none';
    }
  }

  // Function to setup tabs for the fine adjustment panel
  function setupTabs() {
    // Get all tab buttons and content panes
    tabButtons = document.querySelectorAll('.tab-button');
    tabContents = document.querySelectorAll('.tab-content');
    
    if (!tabButtons.length || !tabContents.length) {
      console.error('Tab buttons or content elements not found');
      return;
    }
    
    // Add click event listeners to tab buttons
    tabButtons.forEach(button => {
      button.addEventListener('click', (event) => {
        const tabId = event.target.dataset.tab;
        
        // Remove active class from all buttons and content panes
        tabButtons.forEach(btn => btn.classList.remove('active-tab'));
        tabContents.forEach(content => content.classList.remove('active-tab-content'));
        
        // Add active class to clicked button and corresponding content
        event.target.classList.add('active-tab');
        document.getElementById('tab' + tabId.charAt(0).toUpperCase() + tabId.slice(1)).classList.add('active-tab-content');
      });
    });
  }

  // Function to enter fine adjustment stage (Stage 2)
  function enterFineAdjustmentStage() {
    console.log('Entering fine adjustment stage');
    
    // Ensure tempPreviewPlane is correctly positioned from Stage 1
    if (tempPreviewPlane && lockedInitialPosition && lockedInitialQuaternion && lockedInitialScale) {
      tempPreviewPlane.position.copy(lockedInitialPosition);
      tempPreviewPlane.quaternion.copy(lockedInitialQuaternion);
      tempPreviewPlane.scale.copy(lockedInitialScale);
    } else {
      console.error('Missing required objects for fine adjustment stage');
      return;
    }
    
    // Get panel and its elements
    fineAdjustmentPanel = document.getElementById('fineAdjustmentPanel');
    
    if (!fineAdjustmentPanel) {
      console.error('Fine adjustment panel not found');
      return;
    }
    
    // Setup the tabbed interface
    setupTabs();
    
    // Get references to all adjustment buttons
    const adjustNegPitchBtn = document.getElementById('adjustNegPitchBtn');
    const adjustPosPitchBtn = document.getElementById('adjustPosPitchBtn');
    const adjustNegYawBtn = document.getElementById('adjustNegYawBtn');
    const adjustPosYawBtn = document.getElementById('adjustPosYawBtn');
    const adjustNegRollBtn = document.getElementById('adjustNegRollBtn');
    const adjustPosRollBtn = document.getElementById('adjustPosRollBtn');
    
    const adjustScaleSlider = document.getElementById('adjustScaleSlider');
    const adjustScaleValue = document.getElementById('adjustScaleValue');
    
    const alignToWallBtn = document.getElementById('alignToWallBtn');
    const placeHorizontallyBtn = document.getElementById('placeHorizontallyBtn');
    const goToSetViewpointBtn = document.getElementById('goToSetViewpointBtn');
    
    // Initialize scale slider with current scale
    if (adjustScaleSlider && adjustScaleValue) {
      adjustScaleSlider.value = currentPhotoScale;
      adjustScaleValue.textContent = currentPhotoScale.toFixed(1) + 'x';
    }
    
    // Add event listeners for rotation adjustment
    if (adjustPosPitchBtn) adjustPosPitchBtn.addEventListener('click', () => {
      tempPreviewPlane.rotateX(ROTATION_STEP);
    });
    if (adjustNegPitchBtn) adjustNegPitchBtn.addEventListener('click', () => {
      tempPreviewPlane.rotateX(-ROTATION_STEP);
    });
    
    // For Yaw, rotate around world Y axis
    const worldY = new THREE.Vector3(0, 1, 0);
    if (adjustPosYawBtn) adjustPosYawBtn.addEventListener('click', () => {
      tempPreviewPlane.rotateOnWorldAxis(worldY, ROTATION_STEP);
    });
    if (adjustNegYawBtn) adjustNegYawBtn.addEventListener('click', () => {
      tempPreviewPlane.rotateOnWorldAxis(worldY, -ROTATION_STEP);
    });
    
    if (adjustPosRollBtn) adjustPosRollBtn.addEventListener('click', () => {
      tempPreviewPlane.rotateZ(ROTATION_STEP);
    });
    if (adjustNegRollBtn) adjustNegRollBtn.addEventListener('click', () => {
      tempPreviewPlane.rotateZ(-ROTATION_STEP);
    });
    
    // Add event listener for scale adjustment
    if (adjustScaleSlider) adjustScaleSlider.addEventListener('input', (e) => {
      const newScale = parseFloat(e.target.value);
      tempPreviewPlane.scale.set(newScale, newScale, newScale);
      currentPhotoScale = newScale;
      if (adjustScaleValue) adjustScaleValue.textContent = newScale.toFixed(1) + 'x';
    });
    
    // Add event listeners for preset buttons
    if (alignToWallBtn) alignToWallBtn.addEventListener('click', () => {
      // Get camera's horizontal orientation (yaw) from its quaternion
      const cameraEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      // Reset pitch and roll, keep only yaw
      tempPreviewPlane.rotation.set(0, cameraEuler.y, 0);
    });
    
    if (placeHorizontallyBtn) placeHorizontallyBtn.addEventListener('click', () => {
      // Set orientation to lay flat horizontally
      tempPreviewPlane.rotation.set(-Math.PI / 2, 0, 0);
    });
    
    // Add event listener for transition to Stage 3
    if (goToSetViewpointBtn) goToSetViewpointBtn.addEventListener('click', () => {
      if (currentPlacementStage === 'fineAdjustment' && tempPreviewPlane) {
        // Store the final transform
        finalPhotoTransform = {
          position: tempPreviewPlane.position.clone(),
          quaternion: tempPreviewPlane.quaternion.clone(),
          scale: tempPreviewPlane.scale.clone()
        };
        
        // Move to stage 3
        currentPlacementStage = 'setViewpoint';
        
        // Log the stored transform and stage change
        console.log('Final photo transform:', finalPhotoTransform);
        console.log('Transitioning to stage 3: setViewpoint');
        
        // Update the stage indicator
        updateStageIndicator();
        
        // Hide stage 2 panel
        fineAdjustmentPanel.style.display = 'none';
        
        // Enter Stage 3
        enterSetViewpointStage();
      }
    });
    
    // Show the fine adjustment panel
    fineAdjustmentPanel.style.display = 'flex';
    
    // Hide the old fine adjustment controls if they exist
    const oldControls = document.getElementById('fineAdjustmentControlsContainer');
    if (oldControls) {
      oldControls.style.display = 'none';
    }
  }

  // Enter or exit pinning mode
  function togglePinningMode(enter) {
    pinningMode = enter;
    
    if (enter) {
      addContentBtn.innerHTML = '<span class="material-symbols-outlined">cancel</span>';
      addContentBtn.setAttribute('data-mode', 'pinning');
      
      // Remove old helper message if it exists
      const oldHelpMsg = document.getElementById('pinning-helper');
      if (oldHelpMsg) {
        document.body.removeChild(oldHelpMsg);
      }
    } else {
      addContentBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
      addContentBtn.removeAttribute('data-mode');
      
      // Reset placement stage
      currentPlacementStage = 'none';
      
      // Hide all stage-related UI
      if (confirmInitialPosBtn) confirmInitialPosBtn.style.display = 'none';
      if (stageIndicator) stageIndicator.style.display = 'none';
      if (fineAdjustmentPanel) fineAdjustmentPanel.style.display = 'none';
      
      // Hide Stage 3 UI elements
      if (viewpointInstructionsElement) viewpointInstructionsElement.style.display = 'none';
      if (recordViewpointBtn) recordViewpointBtn.style.display = 'none';
      if (skipViewpointBtn) skipViewpointBtn.style.display = 'none';
      if (completePlacementBtn) completePlacementBtn.style.display = 'none';
      
      // Also hide old container if it exists
      const oldControls = document.getElementById('fineAdjustmentControlsContainer');
      if (oldControls) oldControls.style.display = 'none';
      
      // Remove the preview plane if it exists
      if (tempPreviewPlane) {
        scene.remove(tempPreviewPlane);
        tempPreviewPlane.geometry.dispose();
        tempPreviewPlane.material.dispose();
        tempPreviewPlane = null;
      }
      
      // Clear locked positions and transforms
      lockedInitialPosition = null;
      lockedInitialQuaternion = null;
      lockedInitialScale = null;
      finalPhotoTransform = null;
      
      // Clear Stage 3 variables
      recordedCreatorPosition = null;
      recordedCreatorQuaternion = null;
    }
  }

  // Pin photo implementation
  if (pinPhotoBtn) pinPhotoBtn.addEventListener('click', () => {
    if (!processedImageBlob) {
      alert('Please capture or select an image first.');
      return;
    }
    
    // Enter pinning mode with the new stage-based flow
    togglePinningMode(true);
    currentPlacementStage = 'initialPreview';
    
    // Remove any existing preview plane
    if (tempPreviewPlane) {
      scene.remove(tempPreviewPlane);
      tempPreviewPlane.geometry.dispose();
      tempPreviewPlane.material.dispose();
      tempPreviewPlane = null;
    }
    
    // Calculate dimensions based on scale and aspect ratio
    const previewWidth = BASE_PHOTO_WIDTH * currentPhotoScale;
    const previewHeight = previewWidth / currentPreviewImageAspectRatio;
    
    // Create a texture from the image blob
    const blobUrl = URL.createObjectURL(processedImageBlob);
    const texture = new THREE.TextureLoader().load(blobUrl, 
      // onLoad callback
      () => console.log('Preview texture loaded successfully'),
      // onProgress callback (not used)
      undefined,
      // onError callback
      (error) => console.error('Error loading preview texture:', error)
    );
    
    // Create a semi-transparent preview plane with the image texture
    const previewGeo = new THREE.PlaneGeometry(previewWidth, previewHeight);
    const previewMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });
    
    tempPreviewPlane = new THREE.Mesh(previewGeo, previewMat);
    scene.add(tempPreviewPlane);
    console.log(`Created preview plane with dimensions: ${previewWidth} x ${previewHeight}`);
    
    // Show the stage indicator
    updateStageIndicator();
    
    // Show the confirm initial position button
    const confirmInitialBtn = getConfirmInitialPosButton();
    confirmInitialBtn.style.display = 'block';
    
    // Hide the content panel
    if (contentPanel) {
      contentPanel.classList.remove('panel-active');
      contentPanel.classList.remove('fullscreen-panel');
    }
  });

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

  // Function to create and show Stage 3 UI
  function enterSetViewpointStage() {
    console.log('Entering Stage 3: Set Creator Viewpoint');
    
    // Create viewpoint instructions element if it doesn't exist
    if (!viewpointInstructionsElement) {
      viewpointInstructionsElement = document.createElement('div');
      viewpointInstructionsElement.id = 'viewpointInstructions';
      viewpointInstructionsElement.style.position = 'fixed';
      viewpointInstructionsElement.style.top = '70px'; // Below stage indicator
      viewpointInstructionsElement.style.left = '50%';
      viewpointInstructionsElement.style.transform = 'translateX(-50%)';
      viewpointInstructionsElement.style.background = 'rgba(0, 0, 0, 0.7)';
      viewpointInstructionsElement.style.color = 'white';
      viewpointInstructionsElement.style.padding = '10px 16px';
      viewpointInstructionsElement.style.borderRadius = '16px';
      viewpointInstructionsElement.style.zIndex = '100';
      viewpointInstructionsElement.style.maxWidth = '90%';
      viewpointInstructionsElement.style.textAlign = 'center';
      viewpointInstructionsElement.style.display = 'none';
      viewpointInstructionsElement.textContent = 'Please move to the best position you think to view this photo, then click "Record Viewpoint"';
      
      document.body.appendChild(viewpointInstructionsElement);
    }
    
    // Create Record Viewpoint button if it doesn't exist
    if (!recordViewpointBtn) {
      recordViewpointBtn = document.createElement('button');
      recordViewpointBtn.id = 'recordViewpointBtn';
      recordViewpointBtn.textContent = 'Record Viewpoint';
      recordViewpointBtn.style.position = 'fixed';
      recordViewpointBtn.style.bottom = '160px'; // Stack buttons vertically
      recordViewpointBtn.style.left = '50%';
      recordViewpointBtn.style.transform = 'translateX(-50%)';
      recordViewpointBtn.style.background = 'rgba(0, 120, 255, 0.8)';
      recordViewpointBtn.style.color = 'white';
      recordViewpointBtn.style.padding = '12px 24px';
      recordViewpointBtn.style.borderRadius = '24px';
      recordViewpointBtn.style.border = 'none';
      recordViewpointBtn.style.zIndex = '100';
      recordViewpointBtn.style.display = 'none';
      recordViewpointBtn.style.fontWeight = 'bold';
      recordViewpointBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
      
      document.body.appendChild(recordViewpointBtn);
      
      recordViewpointBtn.addEventListener('click', recordViewpoint);
    }
    
    // Create Skip Viewpoint button if it doesn't exist
    if (!skipViewpointBtn) {
      skipViewpointBtn = document.createElement('button');
      skipViewpointBtn.id = 'skipViewpointBtn';
      skipViewpointBtn.textContent = 'Skip Viewpoint Setup';
      skipViewpointBtn.style.position = 'fixed';
      skipViewpointBtn.style.bottom = '100px'; // Middle position
      skipViewpointBtn.style.left = '50%';
      skipViewpointBtn.style.transform = 'translateX(-50%)';
      skipViewpointBtn.style.background = 'rgba(120, 120, 120, 0.8)';
      skipViewpointBtn.style.color = 'white';
      skipViewpointBtn.style.padding = '12px 24px';
      skipViewpointBtn.style.borderRadius = '24px';
      skipViewpointBtn.style.border = 'none';
      skipViewpointBtn.style.zIndex = '100';
      skipViewpointBtn.style.display = 'none';
      skipViewpointBtn.style.fontWeight = 'bold';
      skipViewpointBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
      
      document.body.appendChild(skipViewpointBtn);
      
      skipViewpointBtn.addEventListener('click', skipViewpoint);
    }
    
    // Create Complete Placement button if it doesn't exist
    if (!completePlacementBtn) {
      completePlacementBtn = document.createElement('button');
      completePlacementBtn.id = 'completePlacementBtn';
      completePlacementBtn.textContent = 'Complete';
      completePlacementBtn.style.position = 'fixed';
      completePlacementBtn.style.bottom = '40px'; // Bottom position
      completePlacementBtn.style.left = '50%';
      completePlacementBtn.style.transform = 'translateX(-50%)';
      completePlacementBtn.style.background = 'rgba(0, 180, 0, 0.8)';
      completePlacementBtn.style.color = 'white';
      completePlacementBtn.style.padding = '12px 24px';
      completePlacementBtn.style.borderRadius = '24px';
      completePlacementBtn.style.border = 'none';
      completePlacementBtn.style.zIndex = '100';
      completePlacementBtn.style.display = 'none';
      completePlacementBtn.style.fontWeight = 'bold';
      completePlacementBtn.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
      completePlacementBtn.style.opacity = '0.5'; // Initially less prominent
      completePlacementBtn.disabled = true; // Initially disabled
      
      document.body.appendChild(completePlacementBtn);
      
      completePlacementBtn.addEventListener('click', completePlacement);
    }
    
    // --- START OF NEW RESET LOGIC ---
    // Reset viewpoint recording state variables
    recordedCreatorPosition = null;
    recordedCreatorQuaternion = null;

    // Reset "Record Viewpoint" button
    if (recordViewpointBtn) {
      recordViewpointBtn.textContent = 'Record Viewpoint';
      recordViewpointBtn.disabled = false;
      recordViewpointBtn.style.background = 'rgba(0, 120, 255, 0.8)'; // Original blue color
      recordViewpointBtn.style.opacity = '1';
    }

    // Reset "Skip Viewpoint" button
    if (skipViewpointBtn) {
      skipViewpointBtn.textContent = 'Skip Viewpoint Setup';
      skipViewpointBtn.disabled = false;
      skipViewpointBtn.style.background = 'rgba(120, 120, 120, 0.8)'; // Original gray color
      skipViewpointBtn.style.opacity = '1';
    }

    // Reset "Complete" button
    if (completePlacementBtn) {
      completePlacementBtn.disabled = true; // Should be disabled until viewpoint is recorded or skipped
      completePlacementBtn.style.opacity = '0.5'; // Less prominent
      // No need to change text content for "Complete"
    }

    // Reset instructions text
    if (viewpointInstructionsElement) {
      viewpointInstructionsElement.textContent = 'Please move to the best position you think to view this photo, then click "Record Viewpoint"';
    }
    // --- END OF NEW RESET LOGIC ---
    
    // Show the Stage 3 UI elements
    viewpointInstructionsElement.style.display = 'block';
    recordViewpointBtn.style.display = 'block';
    skipViewpointBtn.style.display = 'block';
    completePlacementBtn.style.display = 'block';
  }

  // Function to record viewpoint (camera position and orientation)
  function recordViewpoint() {
    console.log('Recording creator viewpoint');
    
    // Store camera position and orientation
    recordedCreatorPosition = camera.position.clone();
    recordedCreatorQuaternion = camera.quaternion.clone();
    
    console.log('Recorded position:', recordedCreatorPosition);
    console.log('Recorded quaternion:', recordedCreatorQuaternion);
    
    // Update UI
    recordViewpointBtn.textContent = 'Viewpoint Recorded';
    recordViewpointBtn.disabled = true;
    recordViewpointBtn.style.background = 'rgba(0, 180, 0, 0.8)'; // Success color
    
    skipViewpointBtn.disabled = true;
    skipViewpointBtn.style.opacity = '0.5';
    
    // Enable the complete button
    completePlacementBtn.disabled = false;
    completePlacementBtn.style.opacity = '1';
    
    // Update instructions
    viewpointInstructionsElement.textContent = 'Viewpoint recorded, click "Complete" to create photo';
  }

  // Function to skip viewpoint recording
  function skipViewpoint() {
    console.log('Skipping creator viewpoint');
    
    // Clear any recorded viewpoint
    recordedCreatorPosition = null;
    recordedCreatorQuaternion = null;
    
    // Update UI
    recordViewpointBtn.disabled = true;
    recordViewpointBtn.style.opacity = '0.5';
    
    skipViewpointBtn.textContent = 'Skipped Viewpoint Setup';
    skipViewpointBtn.disabled = true;
    skipViewpointBtn.style.background = 'rgba(0, 180, 0, 0.8)'; // Success color
    
    // Enable the complete button
    completePlacementBtn.disabled = false;
    completePlacementBtn.style.opacity = '1';
    
    // Update instructions
    viewpointInstructionsElement.textContent = 'Viewpoint skipped, click "Complete" to create photo';
  }

  // Function to complete the placement process
  function completePlacement() {
    console.log('Completing photo placement');
    
    if (!finalPhotoTransform) {
      console.error('finalPhotoTransform is null, cannot complete placement');
      return;
    }
    
    if (!processedImageBlob) {
      console.error('processedImageBlob is null, cannot complete placement');
      return;
    }
    
    // Create creator viewpoint object if viewpoint was recorded
    const creatorViewpoint = recordedCreatorPosition && recordedCreatorQuaternion ? 
      { position: recordedCreatorPosition, quaternion: recordedCreatorQuaternion } : null;
    
    // Call the refactored createPhotoPlane
    createPhotoPlane(
      processedImageBlob,
      finalPhotoTransform,
      creatorViewpoint,
      finalPhotoTransform.scale.x, // Use the scale from the transform
      currentPreviewImageAspectRatio
    );
    
    // Reset all state variables
    pinningMode = false;
    currentPlacementStage = 'none';
    
    // Clean up preview plane
    if (tempPreviewPlane) {
      scene.remove(tempPreviewPlane);
      tempPreviewPlane.geometry.dispose();
      tempPreviewPlane.material.dispose();
      tempPreviewPlane = null;
    }
    
    // Reset variables
    processedImageBlob = null;
    recordedCreatorPosition = null;
    recordedCreatorQuaternion = null;
    finalPhotoTransform = null;
    lockedInitialPosition = null;
    lockedInitialQuaternion = null;
    lockedInitialScale = null;
    
    // Reset addContentBtn
    if (addContentBtn) {
      addContentBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
      addContentBtn.removeAttribute('data-mode');
    }
    
    // Hide Stage 3 UI elements
    if (viewpointInstructionsElement) viewpointInstructionsElement.style.display = 'none';
    if (recordViewpointBtn) recordViewpointBtn.style.display = 'none';
    if (skipViewpointBtn) skipViewpointBtn.style.display = 'none';
    if (completePlacementBtn) completePlacementBtn.style.display = 'none';
    if (stageIndicator) stageIndicator.style.display = 'none';
    
    console.log('Photo placement completed and all state reset');
  }

  // Function to load and prepare viewpoints for review mode
  async function loadAndPrepareViewpoints() {
    console.log('Loading viewpoints...');
    
    try {
      // Get all metadata records using the new database function
      const metadataRecords = await getAllPinnedPhotoMetadata();
      console.log(`Found ${metadataRecords.length} total pinned photos`);
      
      // Add detailed console.table for debugging
      console.table(
        metadataRecords.map(r => ({
          id: r.id,
          imgId: r.imageId,
          hasViewpointPosObj: !!r.creatorViewpointPosition,
          px: r.creatorViewpointPosition?.x,
          py: r.creatorViewpointPosition?.y,
          pz: r.creatorViewpointPosition?.z,
          hasViewpointQuatObj: !!r.creatorViewpointQuaternion,
          qx: r.creatorViewpointQuaternion?.x,
          qy: r.creatorViewpointQuaternion?.y,
          qz: r.creatorViewpointQuaternion?.z,
          qw: r.creatorViewpointQuaternion?.w,
          types: {
            px: typeof r.creatorViewpointPosition?.x,
            py: typeof r.creatorViewpointPosition?.y,
            pz: typeof r.creatorViewpointPosition?.z,
            qx: typeof r.creatorViewpointQuaternion?.x,
            qy: typeof r.creatorViewpointQuaternion?.y,
            qz: typeof r.creatorViewpointQuaternion?.z,
            qw: typeof r.creatorViewpointQuaternion?.w,
          },
        }))
      );
      
      // Reset the global variable
      allPinnedPhotosData = metadataRecords;
      
      // Filter records to only include those with valid creator viewpoints
      const validViewpointRecords = metadataRecords.filter(pinData => {
        const p = pinData.creatorViewpointPosition;
        const q = pinData.creatorViewpointQuaternion;

        // Check if the position object and its components are valid numbers
        const hasValidPosition =
          p && // p (creatorViewpointPosition object) exists
          typeof p.x === 'number' && Number.isFinite(p.x) &&
          typeof p.y === 'number' && Number.isFinite(p.y) &&
          typeof p.z === 'number' && Number.isFinite(p.z);

        // Check if the quaternion object and its components are valid numbers
        const hasValidQuaternion =
          q && // q (creatorViewpointQuaternion object) exists
          typeof q.x === 'number' && Number.isFinite(q.x) &&
          typeof q.y === 'number' && Number.isFinite(q.y) &&
          typeof q.z === 'number' && Number.isFinite(q.z) &&
          typeof q.w === 'number' && Number.isFinite(q.w);

        return hasValidPosition && hasValidQuaternion;
      });
      
      console.log(`Found ${validViewpointRecords.length} photos with valid creator viewpoints`);
      
      // Transform the filtered records into the viewablePinsQueue format
      viewablePinsQueue = validViewpointRecords.map(record => {
        return {
          imageId: record.imageId,
          photoPosition: new THREE.Vector3(
            record.position.x,
            record.position.y,
            record.position.z
          ),
          photoQuaternion: new THREE.Quaternion(
            record.orientation.x,
            record.orientation.y,
            record.orientation.z,
            record.orientation.w
          ),
          creatorViewpointPosition: new THREE.Vector3(
            record.creatorViewpointPosition.x,
            record.creatorViewpointPosition.y,
            record.creatorViewpointPosition.z
          ),
          creatorViewpointQuaternion: new THREE.Quaternion(
            record.creatorViewpointQuaternion.x,
            record.creatorViewpointQuaternion.y,
            record.creatorViewpointQuaternion.z,
            record.creatorViewpointQuaternion.w
          ),
          metadata: record // Store the full metadata for reference
        };
      });
      
      console.log('Viewable pins queue prepared:', viewablePinsQueue);
      
      // Check if we have valid viewpoints to show
      if (viewablePinsQueue.length > 0) {
        // Start with the first viewpoint
        currentViewedPinIndex = 0;
        // Start the view mode by moving to the first pin
        moveToPhotoView(currentViewedPinIndex);
      } else {
        console.log('No pins with recorded viewpoints found.');
        isReviewingViewpoints = false;
        alert('No photos with creator viewpoints found.');
      }
    } catch (error) {
      console.error('Error loading viewpoints:', error);
      isReviewingViewpoints = false;
      alert('Error loading viewpoints. Please try again.');
    }
  }
  
  // Placeholder function for viewpoint transition (will be implemented in next step)
  function initiateViewpointTransition(index) {
    console.log(`Initiating transition to viewpoint at index ${index}`);
    // To be implemented in the next step
  }
  
  // Function to move camera to view a specific pinned photo
  function moveToPhotoView(index) {
    console.log(`Moving to photo view at index ${index}`);
    
    // Validate index
    if (index < 0 || index >= viewablePinsQueue.length) {
      console.error(`Invalid index: ${index}. Valid range is 0-${viewablePinsQueue.length - 1}`);
      return;
    }
    
    // Get pin data
    const pinData = viewablePinsQueue[index];
    
    // Update current viewpoint index
    currentViewpointIndex = index;
    
    // Update info text and UI elements
    updateViewModeUI(index);
    
    // Prepare for camera transition
    startPosition = camera.position.clone();
    startQuaternion = camera.quaternion.clone();
    
    // Set target position and orientation
    if (pinData.creatorViewpointPosition && pinData.creatorViewpointQuaternion) {
      // Use recorded creator viewpoint
      targetPosition = pinData.creatorViewpointPosition.clone();
      targetQuaternion = pinData.creatorViewpointQuaternion.clone();
      console.log('Using creator viewpoint for camera transition:', {
        position: targetPosition,
        quaternion: targetQuaternion
      });
    } else {
      // Fallback: Calculate a reasonable position looking at the photo
      console.log('No creator viewpoint available, using fallback positioning');
      
      // Get photo position and normal direction
      const photoPosition = pinData.photoPosition.clone();
      
      // Create a direction vector facing away from the photo (simplified approach)
      // We'll offset in the opposite direction of the photo's forward vector
      const photoForward = new THREE.Vector3(0, 0, -1);
      photoForward.applyQuaternion(pinData.photoQuaternion);
      
      // Position the camera at a reasonable distance from the photo
      const VIEWING_DISTANCE = 2.0;
      targetPosition = photoPosition.clone().add(photoForward.multiplyScalar(VIEWING_DISTANCE));
      
      // Make sure we maintain a reasonable eye level
      targetPosition.y = CAMERA_HEIGHT;
      
      // Create a quaternion that will make the camera look at the photo
      const lookAt = new THREE.Matrix4();
      lookAt.lookAt(targetPosition, photoPosition, new THREE.Vector3(0, 1, 0));
      targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(lookAt);
    }
    
    // Check if we're already very close to the target position/orientation
    // This is a special case where almost no transition would be needed
    const positionDistance = camera.position.distanceTo(targetPosition);
    const quaternionDot = camera.quaternion.dot(targetQuaternion);
    
    if (positionDistance < 0.001 && Math.abs(quaternionDot) > 0.9999) {
      // We're already at the target, no need for transition
      console.log('Already at target position/orientation, skipping transition');
      
      // Still need to synchronize yaw/pitch with the current quaternion
      const forwardVector = new THREE.Vector3(0, 0, -1);
      forwardVector.applyQuaternion(camera.quaternion);
      
      // Calculate yaw (around Y axis)
      yaw = Math.atan2(forwardVector.x, forwardVector.z);
      
      // Calculate pitch (angle with XZ plane)
      const clampedY = Math.max(-1, Math.min(1, forwardVector.y));
      pitch = Math.asin(-clampedY);
      
      console.log('Synchronized yaw/pitch without transition:', yaw.toFixed(3), pitch.toFixed(3));
      
      // Dispatch completion event immediately
      const event = new CustomEvent('cameraTransitionComplete', {
        detail: { index: currentViewpointIndex }
      });
      document.dispatchEvent(event);
    } else {
      // Normal case - start the transition
      isTransitioningCamera = true;
      transitionFrameCounter = 0;
    }
    
    // Highlight the current pin's mesh if it exists in the scene
    highlightCurrentPin(pinData.imageId);
  }
  
  // Function to highlight the current pin's mesh in the scene
  function highlightCurrentPin(imageId) {
    // Reset any previous highlights
    scene.traverse((object) => {
      if (object.isMesh && object.userData && object.userData.isHighlighted) {
        // Remove highlight effect
        if (object.material.emissive) {
          object.material.emissive.set(0x000000);
          object.material.emissiveIntensity = 0;
        }
        object.userData.isHighlighted = false;
      }
    });
    
    // Find and highlight the current pin
    scene.traverse((object) => {
      if (object.isMesh && object.userData && object.userData.imageId === imageId) {
        // Apply highlight effect
        if (object.material.emissive) {
          object.material.emissive.set(0x555555);
          object.material.emissiveIntensity = 0.5;
          object.userData.isHighlighted = true;
          console.log(`Highlighted pin with imageId: ${imageId}`);
        }
      }
    });
  }

  // Update UI elements for view mode
  function updateViewModeUI(index) {
    // If we have UI elements for showing current pin info, update them
    if (currentPinInfoElement) {
      currentPinInfoElement.textContent = `Viewing Photo ${index + 1} / ${viewablePinsQueue.length}`;
      currentPinInfoElement.style.display = 'block';
    }
    
    // Update button states
    const prevButton = document.getElementById('prevViewpointBtn');
    const nextButton = document.getElementById('nextViewpointBtn');
    
    if (prevButton && nextButton) {
      // First pin - disable previous button
      if (index <= 0) {
        prevButton.disabled = true;
        prevButton.style.opacity = '0.5';
        prevButton.style.cursor = 'not-allowed';
      } else {
        prevButton.disabled = false;
        prevButton.style.opacity = '1';
        prevButton.style.cursor = 'pointer';
      }
      
      // Last pin - disable next button
      if (index >= viewablePinsQueue.length - 1) {
        nextButton.disabled = true;
        nextButton.style.opacity = '0.5';
        nextButton.style.cursor = 'not-allowed';
      } else {
        nextButton.disabled = false;
        nextButton.style.opacity = '1';
        nextButton.style.cursor = 'pointer';
      }
      
      // Add visual indicator to show current button states
      if (index <= 0) {
        prevButton.innerHTML = '&#x25C0; First';
      } else {
        prevButton.innerHTML = '&#x25C0; Previous';
      }
      
      if (index >= viewablePinsQueue.length - 1) {
        nextButton.innerHTML = 'Last &#x25B6;';
      } else {
        nextButton.innerHTML = 'Next &#x25B6;';
      }
    }
    
    // Log the current pin info
    console.log(`Updated UI: Viewing pin ${index + 1} of ${viewablePinsQueue.length}`);
  }

  // Function to exit viewpoint review mode
  function exitViewMode() {
    console.log('Exiting viewpoint review mode (attempting)');
    
    isTransitioningCamera = false; // Forcibly stop transition checks/logic
    transitionFrameCounter = 0;
    
    // Only exit if we're actually in review mode
    if (!isReviewingViewpoints) {
      console.log('Not in viewpoint review mode, ignoring exit request');
      return;
    }
    
    // Reset flags and state
    isReviewingViewpoints = false;
    currentViewpointIndex = -1;
    
    // Clear any active pin highlights
    scene.traverse((object) => {
      if (object.isMesh && object.userData && object.userData.isHighlighted) {
        if (object.material.emissive) {
          object.material.emissive.set(0x000000);
          object.material.emissiveIntensity = 0;
        }
        object.userData.isHighlighted = false;
      }
    });
    
    // Hide UI elements
    if (currentPinInfoElement) {
      currentPinInfoElement.style.display = 'none';
    }
    
    // Remove navigation controls
    removeViewModeControls();
    
    // Show the add content button again
    if (addContentBtn) {
      addContentBtn.style.display = 'block';
    }
    
    // Clear viewpoint data
    viewablePinsQueue = [];
    allPinnedPhotosData = [];
    
    // Reset camera targets
    targetPosition = null;
    targetQuaternion = null;
    
    console.log('Viewpoint review mode exited successfully');
  }

  // Function to create UI controls for navigating viewpoints
  function createViewModeControls() {
    // Create container for controls
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'viewModeControls';
    controlsContainer.style.position = 'fixed';
    controlsContainer.style.bottom = '30px';
    controlsContainer.style.left = '50%';
    controlsContainer.style.transform = 'translateX(-50%)';
    controlsContainer.style.display = 'flex';
    controlsContainer.style.gap = '15px';
    controlsContainer.style.zIndex = '101';
    
    // Previous button
    const prevButton = document.createElement('button');
    prevButton.id = 'prevViewpointBtn';
    prevButton.textContent = 'Previous';
    prevButton.style.padding = '10px 20px';
    prevButton.style.backgroundColor = 'rgba(40, 40, 45, 0.85)';
    prevButton.style.color = 'white';
    prevButton.style.border = 'none';
    prevButton.style.borderRadius = '8px';
    prevButton.style.fontSize = '16px';
    prevButton.style.cursor = 'pointer';
    prevButton.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
    
    // Exit button
    const exitButton = document.createElement('button');
    exitButton.id = 'exitViewModeBtn';
    exitButton.textContent = 'Exit View Mode';
    exitButton.style.padding = '10px 20px';
    exitButton.style.backgroundColor = 'rgba(220, 53, 69, 0.85)';
    exitButton.style.color = 'white';
    exitButton.style.border = 'none';
    exitButton.style.borderRadius = '8px';
    exitButton.style.fontSize = '16px';
    exitButton.style.cursor = 'pointer';
    exitButton.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
    
    // Next button
    const nextButton = document.createElement('button');
    nextButton.id = 'nextViewpointBtn';
    nextButton.textContent = 'Next';
    nextButton.style.padding = '10px 20px';
    nextButton.style.backgroundColor = 'rgba(40, 40, 45, 0.85)';
    nextButton.style.color = 'white';
    nextButton.style.border = 'none';
    nextButton.style.borderRadius = '8px';
    nextButton.style.fontSize = '16px';
    nextButton.style.cursor = 'pointer';
    nextButton.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
    
    // Add buttons to container
    controlsContainer.appendChild(prevButton);
    controlsContainer.appendChild(exitButton);
    controlsContainer.appendChild(nextButton);
    
    // Add keyboard hint
    const keyboardHint = document.createElement('div');
    keyboardHint.id = 'keyboardHint';
    keyboardHint.textContent = 'Keyboard: ← → arrows or ESC to exit';
    keyboardHint.style.position = 'fixed';
    keyboardHint.style.bottom = '120px';
    keyboardHint.style.left = '50%';
    keyboardHint.style.transform = 'translateX(-50%)';
    keyboardHint.style.fontSize = '14px';
    keyboardHint.style.color = 'rgba(255, 255, 255, 0.7)';
    keyboardHint.style.padding = '5px 10px';
    keyboardHint.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    keyboardHint.style.borderRadius = '5px';
    keyboardHint.style.zIndex = '101';
    document.body.appendChild(keyboardHint);
    
    // Add container to document
    document.body.appendChild(controlsContainer);
    
    
    // Add event listeners
    prevButton.addEventListener('click', navigateToPreviousPin);
    nextButton.addEventListener('click', navigateToNextPin);
    exitButton.addEventListener('click', exitViewMode);
    
    // Add keyboard navigation
    document.addEventListener('keydown', handleViewModeKeyDown);
    
    // Return the container element
    return controlsContainer;
  }
  
  // Function to remove view mode controls
  function removeViewModeControls() {
    const controlsContainer = document.getElementById('viewModeControls');
    if (controlsContainer) {
      document.body.removeChild(controlsContainer);
    }
    
    // Also remove keyboard hint
    const keyboardHint = document.getElementById('keyboardHint');
    if (keyboardHint) {
      document.body.removeChild(keyboardHint);
    }
    
    // Remove keyboard navigation listener
    document.removeEventListener('keydown', handleViewModeKeyDown);
  }
  
  // Function to handle keyboard navigation in view mode
  function handleViewModeKeyDown(event) {
    // Only process if in review mode and not during transitions
    if (!isReviewingViewpoints || isTransitioningCamera) return;
    
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'n':
      case 'N':
        navigateToNextPin();
        event.preventDefault();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'p':
      case 'P':
        navigateToPreviousPin();
        event.preventDefault();
        break;
      case 'Escape':
        exitViewMode();
        event.preventDefault();
        break;
    }
  }
  
  // Function to navigate to the next pin
  function navigateToNextPin() {
    if (isTransitioningCamera) {
      console.log('Camera is already transitioning, ignoring navigation request');
      return;
    }
    
    if (currentViewpointIndex < viewablePinsQueue.length - 1) {
      moveToPhotoView(currentViewpointIndex + 1);
    } else {
      console.log('Already at the last viewpoint');
      // Visual feedback that we're at the last pin
      const nextButton = document.getElementById('nextViewpointBtn');
      if (nextButton) {
        nextButton.classList.add('button-flash');
        setTimeout(() => {
          nextButton.classList.remove('button-flash');
        }, 300);
      }
    }
  }
  
  // Function to navigate to the previous pin
  function navigateToPreviousPin() {
    if (isTransitioningCamera) {
      console.log('Camera is already transitioning, ignoring navigation request');
      return;
    }
    
    if (currentViewpointIndex > 0) {
      moveToPhotoView(currentViewpointIndex - 1);
    } else {
      console.log('Already at the first viewpoint');
      // Visual feedback that we're at the first pin
      const prevButton = document.getElementById('prevViewpointBtn');
      if (prevButton) {
        prevButton.classList.add('button-flash');
        setTimeout(() => {
          prevButton.classList.remove('button-flash');
        }, 300);
      }
    }
  }

  // Add event listener for review creator viewpoints button
  if (reviewCreatorViewpointsBtn) {
    reviewCreatorViewpointsBtn.addEventListener('click', () => {
      console.log('Entering viewpoint review mode.');
      isReviewingViewpoints = true;
      
      // Create a pin info element if it doesn't exist yet
      if (!currentPinInfoElement) {
        currentPinInfoElement = document.createElement('div');
        currentPinInfoElement.id = 'currentPinInfo';
        currentPinInfoElement.style.position = 'fixed';
        currentPinInfoElement.style.top = '20px';
        currentPinInfoElement.style.left = '50%';
        currentPinInfoElement.style.transform = 'translateX(-50%)';
        currentPinInfoElement.style.background = 'rgba(0, 0, 0, 0.75)';
        currentPinInfoElement.style.color = 'white';
        currentPinInfoElement.style.padding = '10px 18px';
        currentPinInfoElement.style.borderRadius = '16px';
        currentPinInfoElement.style.zIndex = '100';
        currentPinInfoElement.style.fontWeight = '600';
        currentPinInfoElement.style.fontSize = '16px';
        currentPinInfoElement.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.2)';
        currentPinInfoElement.style.textAlign = 'center';
        currentPinInfoElement.style.display = 'none';
        document.body.appendChild(currentPinInfoElement);
      }
      
      // Show the pin info element
      if (currentPinInfoElement) {
        currentPinInfoElement.style.display = 'block';
      }
      
      // Create navigation controls
      createViewModeControls();
      
      // Hide the main add content button while in view mode
      if (addContentBtn) {
        addContentBtn.style.display = 'none';
      }
      
      // Load viewpoint data and begin camera transitions
      loadAndPrepareViewpoints();
      
      // Hide the content panel for a more focused experience
      closePanel();
    });
  }
});
