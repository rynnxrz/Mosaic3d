import './style.css'
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initDB, savePinnedItem, loadPinnedItems, getAllPinnedPhotoMetadata, getUserId } from './database.js';
import { 
  addSharedPin, 
  loadSharedPins, 
  getSharedPins, 
  initFirebase, 
  isCurrentUserAdmin, 
  signInWithEmail, 
  signOutUser, 
  getAllSharedPinsForAdmin,
  getCurrentFirebaseUserId,
  uploadPhotoToStorage,
  deleteSharedPinDoc,
  deleteImageFromStorage
} from './firebase.js';

window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded and parsed');
  console.log('Direct getElementById("canvas-container"):', document.getElementById('canvas-container'));
  
  // Initialize Firebase and database
  Promise.all([
    initFirebase().catch(error => {
      console.error('Error initializing Firebase:', error);
      return null;
    }),
    initDB().catch(error => {
      console.error('Error initializing database:', error);
      return null;
    })
  ]).then(([firebaseUser, _]) => {
    if (firebaseUser) {
      console.log('Firebase initialized with user ID:', firebaseUser.uid);
      
      // Check if the current user has admin privileges
      isCurrentUserAdmin().then(isAdmin => {
        console.log('Current user admin status:', isAdmin);
        
        // Store admin status in a global variable for use throughout the app
        window.isAdmin = isAdmin;
        
        // If admin, show admin UI elements
        if (isAdmin) {
          showAdminUI();
        }
      });
    }
    
    const userId = getUserId();
    console.log('IndexedDB User ID:', userId);
    
    // Load shared pins after initialization
    loadSharedPinsForCurrentSection();
  });
  
  // Test if touch events are being recognized
  console.log('Touch events supported:', 'ontouchstart' in window);
  document.body.addEventListener('touchstart', () => {
    console.log('Body touchstart detected');
  }, { passive: true });
  
  // ---- Prevent Double-Tap Zoom on iOS Safari ----
  // If two touchend events occur within 300ms, block the second's default zoom.
  let _lastTouchEnd = 0;
  document.addEventListener('touchend', function(e) {
    const now = Date.now();
    if (now - _lastTouchEnd <= 300) {
      // Only prevent default on double-tap for joystick elements
      const joystickBase = document.getElementById('joystick-base');
      const joystickHandle = document.getElementById('joystick-handle');
      
      if (e.target === joystickBase || 
          (joystickBase && joystickBase.contains(e.target)) || 
          e.target === joystickHandle || 
          (joystickHandle && joystickHandle.contains(e.target))) {
        e.preventDefault();
        console.log('Double-tap prevented on joystick element');
      }
    }
    _lastTouchEnd = now;
  }, false);
  
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
  const settingsView = getEl('settingsView');
  const adminLoginView = getEl('adminLoginView');
  const adminPinsListView = getEl('adminPinsListView');
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
  camera.position.set(0, CAMERA_HEIGHT, 1); // Start at a sensible position inside the room
  camera.lookAt(10, CAMERA_HEIGHT, 0); // Look forward at eye level

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

  // Define constant array of all panel view IDs for consistent management
  const ALL_PANEL_VIEW_IDS = [
    'contentTypeSelectView', 'cameraModeView', 'imagePreviewView',
    'settingsView', 'adminLoginView', 'adminPinsListView'
  ];
  let currentActivePanelViewId = null;

  // Helper: show only one view in the panel
  function showPanelView(viewIdToShow) {
    const panel = contentPanel;
    if (!panel) {
      console.error("#contentPanel is not found in showPanelView");
      return;
    }

    // Optimization: If the view is already active, do nothing.
    if (currentActivePanelViewId === viewIdToShow) {
      console.log(`View ${viewIdToShow} is already active.`);
      // Still ensure fullscreen class is correct if called directly
      const isFullscreen = ['cameraModeView', 'imagePreviewView', 'settingsView', 'adminLoginView', 'adminPinsListView'].includes(viewIdToShow);
      panel.classList.toggle('fullscreen-panel', isFullscreen);
      return;
    }
    
    console.log(`Changing panel view from ${currentActivePanelViewId} to: ${viewIdToShow}`);

    ALL_PANEL_VIEW_IDS.forEach(id => {
      const viewElement = getEl(id); // Using getEl utility
      if (viewElement) {
        if (id === viewIdToShow) {
          viewElement.classList.add('active');
          // Explicitly set display to ensure it shows, matching .view.active CSS
          viewElement.style.display = 'flex'; 
        } else {
          viewElement.classList.remove('active');
          // CRITICAL: Explicitly hide inactive views with inline style
          viewElement.style.display = 'none';
        }
      }
    });

    currentActivePanelViewId = viewIdToShow;

    const isFullscreen = ['cameraModeView', 'imagePreviewView', 'settingsView', 'adminLoginView', 'adminPinsListView'].includes(viewIdToShow);

    if (isFullscreen) {
      panel.classList.add('fullscreen-panel');
    } else {
      panel.classList.remove('fullscreen-panel');
    }

    panel.classList.remove('returning-to-bubble');
    panel.classList.remove('fullscreen-transition');

    if (viewIdToShow === 'imagePreviewView' && photoScaleSlider && photoScaleValue) {
      photoScaleSlider.value = currentPhotoScale;
      photoScaleValue.textContent = currentPhotoScale.toFixed(1) + 'x';
    }
    console.log(`Panel view set to: ${viewIdToShow}, Fullscreen: ${isFullscreen}`);
  }
  
  function openPanel() {
    console.log('Opening panel...');
    
    if (contentPanel) {
      // More aggressively clear all inline styles that might interfere
      contentPanel.removeAttribute('style');
      
      // Ensure panel is reset to bubble state
      contentPanel.classList.remove('fullscreen-panel');
      contentPanel.classList.remove('fullscreen-transition');
      contentPanel.classList.remove('returning-to-bubble');
      
      // Set correct transform-origin for bubble animation
      contentPanel.style.transformOrigin = 'bottom center';
      
      // Force a browser reflow to ensure styles are applied before animation starts
      contentPanel.offsetHeight;
      
      // Add panel-active to trigger the appearance animation
      contentPanel.classList.add('panel-active');
    }
    
    if (addContentBtn) {
      addContentBtn.classList.add('is-close-icon');
    }
    
    // Show the content type selection view
    showPanelView('contentTypeSelectView');
  }
  
  function closePanel() {
    console.log('Closing panel...');
    
    // IMPORTANT: Reset to the default view INTERNALLY FIRST.
    // showPanelView will set settingsView etc. to style.display = 'none'.
    showPanelView('contentTypeSelectView');
    
    if (contentPanel) {
      // Remove all panel state classes
      contentPanel.classList.remove('panel-active');
      contentPanel.classList.remove('fullscreen-panel');
      contentPanel.classList.remove('returning-to-bubble');
      contentPanel.classList.remove('fullscreen-transition');
      
      // Reset relevant inline styles
      contentPanel.style.opacity = '';
      contentPanel.style.visibility = '';
      contentPanel.style.transition = '';
      
      // Optional: Clean up inline styles after the CSS close animation completes.
      // The duration should match your CSS transition for closing.
      setTimeout(() => {
        if (contentPanel && !contentPanel.classList.contains('panel-active')) {
          // Check if it wasn't reopened
          contentPanel.style.transform = ''; // Let CSS define the default hidden transform
        }
      }, 400); // Adjust time to match panel close animation duration
    }
    
    if (addContentBtn) {
      addContentBtn.classList.remove('is-close-icon');
    }
    
    // Clean up resources
    stopCamera();
    processedImageBlob = null;
    if (imagePreview) imagePreview.src = '';
    
    console.log('Panel closed. Internal view reset to contentTypeSelectView.');
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
  function createPhotoPlane(imageBlobToSave, photoTransform, creatorViewpoint, photoScale, photoAspectRatio, customImageId = null) {
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
      
      // Generate a unique image ID or use provided one
      const imageId = customImageId || `photo_${Date.now()}_${pinnedPhotoCounter++}`;
      console.log(`Using imageId: ${imageId} ${customImageId ? '(custom provided)' : '(auto-generated)'}`);
      
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
      
      // Add creator viewpoint if available AND valid
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
        } else {
          console.warn("[createPhotoPlane] Creator viewpoint exists but quaternion is missing.");
        }
        
        // Create the position object first
        transformDataForDB.creatorViewpoint = {
          position: {
            x: creatorViewpoint.position.x,
            y: creatorViewpoint.position.y,
            z: creatorViewpoint.position.z
          }
        };
        
        // Only add quaternion if it exists
        if (qData) {
          transformDataForDB.creatorViewpoint.quaternion = qData;
        }
      } else {
        console.log('[createPhotoPlane] No valid creator viewpoint data available for database.');
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
      addContentBtn.setAttribute('data-mode', 'pinning');
      
      // Remove old helper message if it exists
      const oldHelpMsg = document.getElementById('pinning-helper');
      if (oldHelpMsg) {
        document.body.removeChild(oldHelpMsg);
      }
      
      // Create a cancel pinning mode button
      createCancelPinningButton();
    } else {
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
      
      // Remove the cancel pinning button if it exists
      const cancelPinBtn = document.getElementById('cancelPinningBtn');
      if (cancelPinBtn) {
        document.body.removeChild(cancelPinBtn);
      }
    }
  }

  // Create a cancel button for pinning mode
  function createCancelPinningButton() {
    // Check if button already exists
    let cancelBtn = document.getElementById('cancelPinningBtn');
    if (cancelBtn) {
      return cancelBtn;
    }
    
    // Create new button
    cancelBtn = document.createElement('button');
    cancelBtn.id = 'cancelPinningBtn';
    cancelBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
    cancelBtn.style.position = 'fixed';
    cancelBtn.style.top = '20px';
    cancelBtn.style.right = '20px';
    cancelBtn.style.width = '48px';
    cancelBtn.style.height = '48px';
    cancelBtn.style.borderRadius = '50%';
    cancelBtn.style.background = 'rgba(220, 53, 69, 0.85)';
    cancelBtn.style.color = 'white';
    cancelBtn.style.border = 'none';
    cancelBtn.style.display = 'flex';
    cancelBtn.style.alignItems = 'center';
    cancelBtn.style.justifyContent = 'center';
    cancelBtn.style.zIndex = '200';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    
    // Add click event
    cancelBtn.addEventListener('click', () => {
      togglePinningMode(false);
    });
    
    // Add to document
    document.body.appendChild(cancelBtn);
    
    return cancelBtn;
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
    addContentBtn.addEventListener('click', () => {
      // Decoupled from pinning mode - button now only controls panel
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
  async function completePlacement() {
    console.log('Completing photo placement');
    
    // Initial checks (using the outer scope finalPhotoTransform for now)
    if (!finalPhotoTransform) {
      console.error('finalPhotoTransform is null at the start of completePlacement. Aborting.');
      showNotification('Error: Pin transform data is missing.', 'error');
      togglePinningMode(false); // Reset UI
      return;
    }
    
    if (!processedImageBlob) {
      console.error('processedImageBlob is null at the start of completePlacement. Aborting.');
      showNotification('Error: Pin image data is missing.', 'error');
      togglePinningMode(false); // Reset UI
      return;
    }
    
    // --- Snapshot critical variables ----
    const capturedTransform = { // Deep clone to be safe
      position: finalPhotoTransform.position.clone(),
      quaternion: finalPhotoTransform.quaternion.clone(),
      scale: finalPhotoTransform.scale.clone()
    };
    
    // Create creator viewpoint object if viewpoint was recorded
    const creatorViewpoint = recordedCreatorPosition && recordedCreatorQuaternion ? 
      { position: recordedCreatorPosition, quaternion: recordedCreatorQuaternion } : null;
    
    const capturedCreatorViewpoint = creatorViewpoint ? { // Deep clone
      position: creatorViewpoint.position.clone(),
      // Only clone quaternion if it exists
      quaternion: creatorViewpoint.quaternion ? creatorViewpoint.quaternion.clone() : null 
    } : null;
    
    const capturedProcessedImageBlob = processedImageBlob;
    const capturedPreviewAspectRatio = currentPreviewImageAspectRatio;
    const imageIdForPin = `photo_${Date.now()}_${pinnedPhotoCounter++}`; // Generate ID once

    console.log('Initial capturedCreatorViewpoint:', capturedCreatorViewpoint ? 
      { position: capturedCreatorViewpoint.position.toArray(), 
        quaternion: capturedCreatorViewpoint.quaternion ? capturedCreatorViewpoint.quaternion.toArray() : null } : null);
    console.log('Initial recordedCreatorQuaternion (from outer scope, for reference):', 
      recordedCreatorQuaternion ? recordedCreatorQuaternion.toArray() : null);
    
    // Nested function for local save, using captured state
    function saveToLocalStorageLocal() {
      console.log("Attempting to save to local storage with captured state.");
      if (!capturedTransform) {
        console.error("saveToLocalStorageLocal: capturedTransform is null. Aborting.");
        showNotification('Error: Could not save pin locally (missing transform data).', 'error');
        return;
      }
      if (!capturedProcessedImageBlob) {
        console.error("saveToLocalStorageLocal: capturedProcessedImageBlob is null. Aborting.");
        showNotification('Error: Could not save pin locally (missing image data).', 'error');
        return;
      }

      createPhotoPlane(
        capturedProcessedImageBlob,
        capturedTransform,
        capturedCreatorViewpoint, // Pass the captured (potentially null) viewpoint
        capturedTransform.scale.x,
        capturedPreviewAspectRatio,
        imageIdForPin // Pass the pre-generated imageId
      );
    }
    
    if (useSharedSpace) {
      // Get the current Firebase user ID
      const firebaseUserId = getCurrentFirebaseUserId();
      
      if (!firebaseUserId) {
        console.error('User not signed in. Cannot save to shared space.');
        showNotification('User not signed in. Cannot save to shared space. Saving locally.', 'warning');
        saveToLocalStorageLocal();
        return;
      }
      
      if (!capturedProcessedImageBlob) {
        console.error('No image data to upload. Cannot save shared pin.');
        showNotification('No image data to upload. Cannot save shared pin.', 'error');
        return;
      }
      
      // Create a unique filename for the image
      const uniqueFileName = `pin_${imageIdForPin}_${Date.now()}.jpg`;
      
      // Show uploading notification
      showNotification('Uploading photo for shared pin...', 'info');
      
      try {
        // Upload the image to Firebase Storage
        const downloadURL = await uploadPhotoToStorage(firebaseUserId, capturedProcessedImageBlob, uniqueFileName);
        console.log('Photo uploaded to Firebase Storage. URL:', downloadURL);
        
        // Store the storage path for later deletion capability
        const storagePathForDB = `sharedPins_images/${firebaseUserId}/${uniqueFileName}`;
        console.log('Storage path for Firebase Storage:', storagePathForDB);
        
        // Extract Euler rotation from quaternion for better compatibility
        const euler = new THREE.Euler().setFromQuaternion(capturedTransform.quaternion, 'YXZ');
        
        // Prepare shared pin data with the Firebase Storage URL and path
        const sharedPinData = {
          photoURL: downloadURL, // Use the Firebase Storage URL instead of blob URL
          photoStoragePath: storagePathForDB, // Store the path for admin deletion capability
          position: {
            x: capturedTransform.position.x,
            y: capturedTransform.position.y,
            z: capturedTransform.position.z
          },
          rotation: {
            x: euler.x,
            y: euler.y,
            z: euler.z
          },
          sectionId: currentSectionId, // Use the current section ID
          scale: capturedTransform.scale.x, // Assuming uniform scale
          aspectRatio: capturedPreviewAspectRatio,
          userId: firebaseUserId // Store who created it
        };
        
        // Robustly add creator viewpoint data
        if (capturedCreatorViewpoint && capturedCreatorViewpoint.position) {
          const creatorPos = capturedCreatorViewpoint.position;
          sharedPinData.creatorViewpoint = {
            position: { x: creatorPos.x, y: creatorPos.y, z: creatorPos.z }
          };
          // Only add quaternion if it exists on the captured viewpoint
          if (capturedCreatorViewpoint.quaternion) {
            const viewpointEuler = new THREE.Euler().setFromQuaternion(capturedCreatorViewpoint.quaternion, 'YXZ');
            sharedPinData.creatorViewpoint.rotation = { 
              x: viewpointEuler.x, 
              y: viewpointEuler.y, 
              z: viewpointEuler.z 
            };
          } else {
            console.warn("[completePlacement] Captured creator viewpoint has position but no quaternion for shared pin.");
          }
        }
        
        // Save to Firestore shared pins collection
        const docId = await addSharedPin(sharedPinData);
        console.log(`Pin saved to shared space with ID: ${docId}`);
        
        // Show success notification to user
        showNotification('Pin saved to shared space', 'success');
        
        // Refresh the pins in the scene to include the new one
        loadSharedPinsForCurrentSection();
      } catch (error) {
        console.error('Failed to upload photo or save pin to shared space:', error);
        // Show error notification to user
        showNotification('Failed to save shared pin: ' + error.message, 'error');
        
        // Fallback to local storage if shared save fails
        saveToLocalStorageLocal();
      }
    } else {
      // Save to local storage using the existing method with captured state
      saveToLocalStorageLocal();
    }
    
    // Legacy saveToLocalStorage function kept for compatibility with any existing calls
    // but we primarily use saveToLocalStorageLocal() inside completePlacement
    function saveToLocalStorage(blobToSave, transformToSave, viewpointToSave, currentAspectRatio) {
      console.log("Attempting to save to local storage.");
      if (!transformToSave) {
        console.error("saveToLocalStorage called with null transformToSave. Aborting local save.");
        showNotification('Error: Could not save pin locally (missing transform data).', 'error');
        return;
      }
      if (!blobToSave) {
        console.error("saveToLocalStorage called with null blobToSave. Aborting local save.");
        showNotification('Error: Could not save pin locally (missing image data).', 'error');
        return;
      }

      createPhotoPlane(
        blobToSave,
        transformToSave,
        viewpointToSave,
        transformToSave.scale.x, // Access scale from the passed parameter
        currentAspectRatio
      );
    }
    
    // Reset all state variables AT THE VERY END
    pinningMode = false;
    currentPlacementStage = 'none';
    
    // Clean up preview plane
    if (tempPreviewPlane) {
      scene.remove(tempPreviewPlane);
      tempPreviewPlane.geometry.dispose();
      if (tempPreviewPlane.material.map) tempPreviewPlane.material.map.dispose();
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
      addContentBtn.removeAttribute('data-mode');
    }
    
    // Hide Stage 3 UI elements
    if (viewpointInstructionsElement) viewpointInstructionsElement.style.display = 'none';
    if (recordViewpointBtn) recordViewpointBtn.style.display = 'none';
    if (skipViewpointBtn) skipViewpointBtn.style.display = 'none';
    if (completePlacementBtn) completePlacementBtn.style.display = 'none';
    if (stageIndicator) stageIndicator.style.display = 'none';
    if (fineAdjustmentPanel) fineAdjustmentPanel.style.display = 'none';
    
    // Remove the cancel pinning button if it exists
    const cancelPinBtn = document.getElementById('cancelPinningBtn');
    if (cancelPinBtn && cancelPinBtn.parentNode) {
      cancelPinBtn.parentNode.removeChild(cancelPinBtn);
    }
    
    console.log('Photo placement completed and all state reset');
  }
  
  // Function to show notification to the user
  function showNotification(message, type = 'info') {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('notification');
    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'notification';
      document.body.appendChild(notification);
    }
    
    // Set content without icon (per UI refinement)
    notification.innerHTML = message;
    
    // Show notification
    notification.style.opacity = '1';
    
    // Hide notification after 3 seconds
    setTimeout(() => {
      notification.style.opacity = '0';
    }, 3000);
  }

  // Function to load and prepare viewpoints for review mode
  async function loadAndPrepareViewpoints() {
    console.log('Loading viewpoints...');
    
    try {
      // Get all metadata records from IndexedDB
      const metadataRecords = await getAllPinnedPhotoMetadata();
      console.log(`Found ${metadataRecords.length} total pinned photos in IndexedDB`);
      
      // Add detailed console logging for debugging
      console.log('IndexedDB records before filtering:');
      metadataRecords.forEach((r, index) => {
        console.log(`Record ${index}, ID: ${r.id}, imageId: ${r.imageId}`);
        console.log('  Position object exists:', !!r.creatorViewpointPosition);
        if (r.creatorViewpointPosition) {
          console.log('  Position values:', {
            x: r.creatorViewpointPosition.x,
            y: r.creatorViewpointPosition.y,
            z: r.creatorViewpointPosition.z,
            x_type: typeof r.creatorViewpointPosition.x,
            y_type: typeof r.creatorViewpointPosition.y,
            z_type: typeof r.creatorViewpointPosition.z
          });
        }
        console.log('  Quaternion object exists:', !!r.creatorViewpointQuaternion);
        if (r.creatorViewpointQuaternion) {
          console.log('  Quaternion values:', {
            x: r.creatorViewpointQuaternion.x,
            y: r.creatorViewpointQuaternion.y,
            z: r.creatorViewpointQuaternion.z,
            w: r.creatorViewpointQuaternion.w,
            x_type: typeof r.creatorViewpointQuaternion.x,
            y_type: typeof r.creatorViewpointQuaternion.y,
            z_type: typeof r.creatorViewpointQuaternion.z,
            w_type: typeof r.creatorViewpointQuaternion.w
          });
        }
      });
      
      // Reset the global variable
      allPinnedPhotosData = metadataRecords;
      
      // Get all shared pins that have creator viewpoints
      let sharedPins = [];
      if (currentSectionId) {
        try {
          console.log('Fetching shared pins with creator viewpoints for section:', currentSectionId);
          sharedPins = await getSharedPins(currentSectionId);
          console.log(`Found ${sharedPins.length} shared pins, checking for creator viewpoints`);
        } catch (e) {
          console.error('Error fetching shared pins:', e);
          sharedPins = [];
        }
      }
      
      // Combine local and shared pins for viewpoint review
      const allRecords = [...metadataRecords, ...sharedPins];
      console.log(`Combined ${metadataRecords.length} local pins and ${sharedPins.length} shared pins`);
      
      // Filter records to only include those with valid creator viewpoints
      const validViewpointRecords = allRecords.filter(pinData => {
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

        const isValid = hasValidPosition && hasValidQuaternion;
        
        // Log detailed filtering information for each record
        console.log(`Record ${pinData.id || pinData.imageId} filtering:`, {
          source: pinData.photoURL ? 'shared' : 'local',
          hasPosition: !!p,
          hasQuaternion: !!q,
          positionValid: hasValidPosition,
          quaternionValid: hasValidQuaternion,
          isValid: isValid
        });
        
        return isValid;
      });
      
      console.log(`Found ${validViewpointRecords.length} photos with valid creator viewpoints`);
      
      // Transform the filtered records into the viewablePinsQueue format
      viewablePinsQueue = validViewpointRecords.map(record => {
        // Determine if this is a local pin or a shared pin
        const isSharedPin = !!record.photoURL;
        
        if (isSharedPin) {
          // For shared pins
          return {
            imageId: record.id, // Use the Firestore document ID
            isShared: true,
            photoURL: record.photoURL,
            photoPosition: new THREE.Vector3(
              record.position.x,
              record.position.y,
              record.position.z
            ),
            photoQuaternion: record.pinQuaternion ? 
              new THREE.Quaternion(
                record.pinQuaternion.x,
                record.pinQuaternion.y,
                record.pinQuaternion.z,
                record.pinQuaternion.w
              ) : 
              (() => {
                const euler = new THREE.Euler(
                  record.rotation.x,
                  record.rotation.y,
                  record.rotation.z,
                  'YXZ'
                );
                return new THREE.Quaternion().setFromEuler(euler);
              })(),
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
        } else {
          // For local pins
          return {
            imageId: record.imageId,
            isShared: false,
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
        }
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
    console.log('Moving to pin:', pinData);
    
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
        quaternion: targetQuaternion,
        isShared: pinData.isShared
      });
      
      // For shared pins, highlight the corresponding pin in the scene
      if (pinData.isShared) {
        console.log('Highlighting shared pin:', pinData.imageId);
        // Find the mesh in the scene that corresponds to this shared pin
        scene.traverse((object) => {
          if (object.isMesh && object.userData && object.userData.isSharedPin && 
              object.userData.id === pinData.imageId) {
            // Highlight this mesh
            if (object.material && object.material.emissive) {
              object.material.emissiveIntensity = 0.5;
              object.material.emissive.set(0x00ff00); // Green highlight
              object.userData.isHighlighted = true;
            }
          }
        });
      } else {
        // For local pins, use the existing highlight function
        highlightCurrentPin(pinData.imageId);
      }
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
      // Get the pin data
      const pinData = viewablePinsQueue[index];
      
      // Format timestamp if available
      let timeStr = '';
      if (pinData.metadata && pinData.metadata.timestamp) {
        const date = new Date(pinData.metadata.timestamp);
        timeStr = `<div class="pin-timestamp">Created: ${date.toLocaleString()}</div>`;
      } else if (pinData.metadata && pinData.metadata.createdAt) {
        // Handle Firebase timestamp format
        const date = pinData.metadata.createdAt instanceof Date ? 
          pinData.metadata.createdAt : 
          new Date(pinData.metadata.createdAt);
        timeStr = `<div class="pin-timestamp">Created: ${date.toLocaleString()}</div>`;
      }
      
      // Determine pin type (local or shared)
      const pinTypeLabel = pinData.isShared ? 'Shared Pin' : 'Local Pin';
      const pinTypeClass = pinData.isShared ? 'shared-pin' : 'local-pin';
      
      // Set the HTML content with more detailed information
      currentPinInfoElement.innerHTML = `
        <div class="pin-info-header">
          <span class="pin-count">Photo ${index + 1} of ${viewablePinsQueue.length}</span>
          <span class="pin-type ${pinTypeClass}">${pinTypeLabel}</span>
        </div>
        ${timeStr}
        <div class="pin-info-id">ID: ${pinData.imageId}</div>
      `;
      
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
    
    // Immediately reset state variables to stop any ongoing camera transitions
    isReviewingViewpoints = false;
    isTransitioningCamera = false; // Forcibly stop transition checks/logic
    transitionFrameCounter = 0;
    
    // If we weren't actually in review mode, log and return
    if (!document.getElementById('viewModeControls')) {
      console.log('Not in viewpoint review mode, ignoring exit request');
      return;
    }
    
    // Reset index
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
    
    // Show the add content button again and reset its state
    if (addContentBtn) {
      addContentBtn.style.display = 'flex'; // Using flex to ensure proper centering of icons
      addContentBtn.classList.remove('is-close-icon'); // Ensure it's in the default "+" state
    }
    
    // Show the refresh button again
    const refreshBtn = document.getElementById('refreshSharedPinsBtn');
    if (refreshBtn) refreshBtn.style.display = 'flex';
    
    // Show the joystick container again
    const joystickContainer = document.getElementById('joystick-container');
    if (joystickContainer) joystickContainer.style.display = 'flex';
    
    // Show section selector if it exists
    const sectionSelector = document.getElementById('sectionSelector');
    if (sectionSelector) sectionSelector.style.display = 'block';
    
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
    // Check if controls already exist
    let controlsContainer = document.getElementById('viewModeControls');
    
    // If controls container doesn't exist, create it
    if (!controlsContainer) {
      controlsContainer = document.createElement('div');
      controlsContainer.id = 'viewModeControls';
      controlsContainer.style.position = 'fixed';
      controlsContainer.style.bottom = '30px';
      controlsContainer.style.left = '50%';
      controlsContainer.style.transform = 'translateX(-50%)';
      controlsContainer.style.display = 'flex';
      controlsContainer.style.gap = '15px';
      controlsContainer.style.zIndex = '101';
      
      // Add container to document
      document.body.appendChild(controlsContainer);
    } else {
      // Clear existing content if container already exists
      controlsContainer.innerHTML = '';
    }
    
    // Check for previous button
    let prevButton = document.getElementById('prevViewpointBtn');
    if (!prevButton) {
      prevButton = document.createElement('button');
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
      
      // Add to container
      controlsContainer.appendChild(prevButton);
    }
    
    // Check for exit button
    let exitButton = document.getElementById('exitViewModeBtn');
    if (!exitButton) {
      exitButton = document.createElement('button');
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
      
      // Add to container
      controlsContainer.appendChild(exitButton);
    }
    
    // Check for next button
    let nextButton = document.getElementById('nextViewpointBtn');
    if (!nextButton) {
      nextButton = document.createElement('button');
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
      
      // Add to container
      controlsContainer.appendChild(nextButton);
    }
    
    // Check for keyboard hint
    let keyboardHint = document.getElementById('keyboardHint');
    if (!keyboardHint) {
      keyboardHint = document.createElement('div');
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
    }
    
    // Remove any existing event listeners before adding new ones
    // This is a simplified approach - in a more complex app, you might use named functions
    prevButton.replaceWith(prevButton.cloneNode(true));
    exitButton.replaceWith(exitButton.cloneNode(true));
    nextButton.replaceWith(nextButton.cloneNode(true));
    
    // Re-select the buttons after replacing them
    prevButton = document.getElementById('prevViewpointBtn');
    exitButton = document.getElementById('exitViewModeBtn');
    nextButton = document.getElementById('nextViewpointBtn');
    
    // Add event listeners to the fresh elements
    prevButton.addEventListener('click', navigateToPreviousPin);
    nextButton.addEventListener('click', navigateToNextPin);
    exitButton.addEventListener('click', exitViewMode);
    
    // Remove existing keyboard listener if it exists
    document.removeEventListener('keydown', handleViewModeKeyDown);
    
    // Add keyboard navigation
    document.addEventListener('keydown', handleViewModeKeyDown);
    
    // Return the container element
    return controlsContainer;
  }
  
  // Function to remove view mode controls
  function removeViewModeControls() {
    // Remove the controls container
    const controlsContainer = document.getElementById('viewModeControls');
    if (controlsContainer) {
      document.body.removeChild(controlsContainer);
    }
    
    // Remove individual buttons in case they exist outside the container
    const prevButton = document.getElementById('prevViewpointBtn');
    if (prevButton && prevButton.parentNode) {
      prevButton.parentNode.removeChild(prevButton);
    }
    
    const exitButton = document.getElementById('exitViewModeBtn');
    if (exitButton && exitButton.parentNode) {
      exitButton.parentNode.removeChild(exitButton);
    }
    
    const nextButton = document.getElementById('nextViewpointBtn');
    if (nextButton && nextButton.parentNode) {
      nextButton.parentNode.removeChild(nextButton);
    }
    
    // Also remove keyboard hint
    const keyboardHint = document.getElementById('keyboardHint');
    if (keyboardHint && keyboardHint.parentNode) {
      keyboardHint.parentNode.removeChild(keyboardHint);
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
      
      // Hide UI elements
      // Hide the main add content button while in view mode
      if (addContentBtn) {
        addContentBtn.style.display = 'none';
      }
      
      // Hide refresh shared pins button
      const refreshBtn = document.getElementById('refreshSharedPinsBtn');
      if (refreshBtn) refreshBtn.style.display = 'none';
      
      // Hide joystick container
      const joystickContainer = document.getElementById('joystick-container');
      if (joystickContainer) joystickContainer.style.display = 'none';
      
      // Make sure any other UI elements that might interfere are hidden
      const sectionSelector = document.getElementById('sectionSelector');
      if (sectionSelector) sectionSelector.style.display = 'none';
      
      // Load viewpoint data and begin camera transitions
      loadAndPrepareViewpoints();
      
      // Hide the content panel for a more focused experience
      closePanel();
    });
  }

  // Define a variable for the current section ID
  // For testing, hardcode to "public_event_1"
  let currentSectionId = "public_event_1";
  
  // Available sections
  const availableSections = [
    { id: "public_event_1", name: "Public Event 1" },
    { id: "shared_room_2", name: "Shared Room 2" },
    { id: "team_space_3", name: "Team Space 3" }
  ];
  
  // Flag to determine if pins should be saved to shared space
  let useSharedSpace = true;

  // Array to track shared pins in the scene
  let sharedPinsInScene = [];
  
  /**
   * Create a section selector dropdown
   * This allows users to switch between different shared sections
   */
  function createSectionSelector() {
  // First, check if there's an existing selector to remove
  const existingSelector = document.getElementById('sectionSelector');
  if (existingSelector && existingSelector.parentNode) {
    existingSelector.parentNode.removeChild(existingSelector);
  }
  
  // Create container
  const container = document.createElement('div');
  container.id = 'sectionSelector';
  container.className = 'section-selector' + (!useSharedSpace ? ' disabled' : '');
  
  // Create label
  const label = document.createElement('div');
  label.className = 'section-selector-label';
  label.textContent = 'Section:';
  container.appendChild(label);
  
  // Create select element
  const select = document.createElement('select');
  select.id = 'sectionSelect';
  select.disabled = !useSharedSpace;
  
  // Add options for each available section
  availableSections.forEach(section => {
    const option = document.createElement('option');
    option.value = section.id;
    option.textContent = section.name;
    option.selected = section.id === currentSectionId;
    select.appendChild(option);
  });
  
  // Add event listener
  select.addEventListener('change', function() {
    if (!useSharedSpace) return; // Don't do anything if shared space is not enabled
    
    const newSectionId = this.value;
    if (newSectionId !== currentSectionId) {
      currentSectionId = newSectionId;
      showNotification(`Switched to section: ${availableSections.find(s => s.id === newSectionId).name}`, 'info');
      loadSharedPinsForCurrentSection();
    }
  });
  
  // Add select to container
  container.appendChild(select);
  
  return container;
}
  
  // Create the section selector
  createSectionSelector();
  
  /**
   * Load shared pins for the current section
   * This function fetches pins from Firestore and displays them in the scene
   */
  function loadSharedPinsForCurrentSection() {
    console.log(`Loading shared pins for section: ${currentSectionId}`);
    
    // Show loading indicator
    showNotification('Loading shared pins...', 'info');
    
    // Clear existing shared pins from the scene
    clearSharedPinsFromScene();
    
    // Fetch shared pins from Firestore
    getSharedPins(currentSectionId)
      .then(pins => {
        console.log(`Fetched ${pins.length} shared pins for section: ${currentSectionId}`);
        
        // Display pins in the scene
        pins.forEach(pin => {
          const pinMesh = createSharedPinMesh(pin);
          if (pinMesh) {
            sharedPinsInScene.push(pinMesh);
          }
        });
        
        // Show success notification
        if (pins.length > 0) {
          showNotification(`Loaded ${pins.length} shared pins`, 'success');
        } else {
          showNotification('No shared pins found in this section', 'info');
        }
      })
      .catch(error => {
        console.error('Error loading shared pins:', error);
        showNotification('Failed to load shared pins', 'error');
      });
  }
  
  /**
   * Clear shared pins from the scene
   * This function removes all shared pins from the Three.js scene
   */
  function clearSharedPinsFromScene() {
    console.log('Clearing shared pins from scene');
    
    // Remove each shared pin mesh from the scene
    sharedPinsInScene.forEach(mesh => {
      if (mesh && scene.children.includes(mesh)) {
        scene.remove(mesh);
        
        // Dispose of geometry and material to free memory
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(material => material.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      }
    });
    
    // Clear the array
    sharedPinsInScene = [];
  }
  
  /**
   * Create a mesh for a shared pin
   * @param {Object} pin - The pin data from Firestore
   * @returns {THREE.Mesh} The created mesh
   */
  function createSharedPinMesh(pin) {
    console.log('Creating mesh for shared pin:', pin.id);
    
    try {
      // Skip if missing required data
      if (!pin.position || (!pin.rotation && !pin.pinQuaternion)) {
        console.error('Pin is missing position or orientation data:', pin);
        return null;
      }
      
      // Create a texture loader
      const textureLoader = new THREE.TextureLoader();
      
      // Load the texture from the photoURL
      // Note: In a production app, you might want to handle loading errors
      const texture = textureLoader.load(
        pin.photoURL,
        // onLoad callback
        () => console.log(`Texture loaded for pin: ${pin.id}`),
        // onProgress callback (not used)
        undefined,
        // onError callback
        (err) => console.error(`Error loading texture for pin ${pin.id}:`, err)
      );
      
      // Calculate dimensions
      const width = BASE_PHOTO_WIDTH * (pin.scale || 1.0);
      const height = width / (pin.aspectRatio || 1.0);
      
      // Create geometry
      const geometry = new THREE.PlaneGeometry(width, height);
      
      // Create material
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true
      });
      
      // Create mesh
      const mesh = new THREE.Mesh(geometry, material);
      
      // Set position
      mesh.position.set(
        pin.position.x,
        pin.position.y,
        pin.position.z
      );
      
      // Set orientation - prefer quaternion if available
      if (pin.pinQuaternion) {
        console.log(`Using pinQuaternion for pin ${pin.id}:`, pin.pinQuaternion);
        mesh.quaternion.set(
          pin.pinQuaternion.x,
          pin.pinQuaternion.y,
          pin.pinQuaternion.z,
          pin.pinQuaternion.w
        );
      } else if (pin.rotation) {
        console.log(`Using Euler rotation for pin ${pin.id}:`, pin.rotation);
        // Use YXZ order to match the saving order
        const euler = new THREE.Euler(
          pin.rotation.x || 0,
          pin.rotation.y || 0,
          pin.rotation.z || 0,
          'YXZ'
        );
        mesh.quaternion.setFromEuler(euler);
      }
      
      // Store pin data in mesh userData
      mesh.userData = {
        id: pin.id,
        isSharedPin: true,
        userId: pin.userId,
        sectionId: pin.sectionId,
        createdAt: pin.createdAt
      };
      
      // Add creator viewpoint data if available
      if (pin.creatorViewpointPosition && pin.creatorViewpointQuaternion) {
        mesh.userData.creatorViewpointPosition = pin.creatorViewpointPosition;
        mesh.userData.creatorViewpointQuaternion = pin.creatorViewpointQuaternion;
      }
      
      // Add to scene
      scene.add(mesh);
      
      return mesh;
    } catch (error) {
      console.error(`Error creating mesh for pin ${pin.id}:`, error);
      return null;
    }
  }
  
  // Add a button to refresh shared pins
  function createRefreshButton() {
    // First, check if there's an existing button to remove
    const existingButton = document.getElementById('refreshSharedPinsBtn');
    if (existingButton && existingButton.parentNode) {
      existingButton.parentNode.removeChild(existingButton);
    }
    
    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'refreshSharedPinsBtn';
    refreshBtn.className = 'frosted-glass';
    
    // Create refresh icon using Material Symbols
    const refreshIcon = document.createElement('span');
    refreshIcon.className = 'material-symbols-outlined refresh-icon';
    refreshIcon.textContent = 'refresh';
    refreshBtn.appendChild(refreshIcon);
    
    // Add event listener for click
    refreshBtn.addEventListener('click', () => {
      // Add loading class for animation
      refreshBtn.classList.add('is-loading');
      
      // Load pins
      loadSharedPinsForCurrentSection()
        .then(() => {
          // Success handling (if needed)
          console.log('Successfully loaded shared pins');
        })
        .catch(error => {
          // Error handling
          console.error('Error loading pins:', error);
          showNotification('Failed to load shared pins', 'error');
        })
        .finally(() => {
          // Always remove loading class when done, regardless of success/failure
          refreshBtn.classList.remove('is-loading');
        });
    });
    
    // Add to document body
    document.body.appendChild(refreshBtn);
    return refreshBtn;
  }
  
  // Create the refresh button
  createRefreshButton();

  // Function to load shared pins from Firestore (old implementation)
  function loadSharedPinsFromFirestore() {
    console.log(`Loading shared pins from section: ${currentSectionId}`);
    
    loadSharedPins(currentSectionId)
      .then(sharedPins => {
        console.log(`Loaded ${sharedPins.length} shared pins`);
        
        // Process each shared pin
        sharedPins.forEach(pin => {
          createSharedPhotoPlane(pin);
        });
        
        // Show notification if pins were loaded
        if (sharedPins.length > 0) {
          showNotification(`Loaded ${sharedPins.length} shared pins`, 'info');
        }
      })
      .catch(error => {
        console.error('Error loading shared pins:', error);
        showNotification('Failed to load shared pins', 'error');
      });
  }
  
  // Function to create a photo plane from shared pin data (old implementation)
  function createSharedPhotoPlane(pinData) {
    console.log('Creating photo plane from shared pin data:', pinData);
    
    // Create a placeholder texture for now
    // In a real app, you would load the image from the photoURL
    const texture = new THREE.TextureLoader().load(pinData.photoURL);
    
    // Calculate plane dimensions based on scale and aspect ratio
    const planeWidth = BASE_PHOTO_WIDTH * (pinData.scale || 1.0);
    const planeHeight = planeWidth / (pinData.aspectRatio || 1.0);
    
    // Create geometry with the correct aspect ratio and scale
    const planeGeo = new THREE.PlaneGeometry(planeWidth, planeHeight);
    
    // Create material with the texture
    const planeMat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true
    });
    
    // Create mesh
    const photoMesh = new THREE.Mesh(planeGeo, planeMat);
    
    // Set position
    photoMesh.position.set(
      pinData.position.x,
      pinData.position.y,
      pinData.position.z
    );
    
    // Set rotation from Euler angles
    photoMesh.rotation.set(
      pinData.rotation.x,
      pinData.rotation.y,
      pinData.rotation.z
    );
    
    // Store metadata in userData
    photoMesh.userData = {
      id: pinData.id,
      userId: pinData.userId,
      sectionId: pinData.sectionId,
      isSharedPin: true,
      createdAt: pinData.createdAt
    };
    
    // Add creator viewpoint if available
    if (pinData.creatorViewpoint) {
      photoMesh.userData.creatorViewpoint = pinData.creatorViewpoint;
    }
    
    // Add to scene
    scene.add(photoMesh);
    console.log(`Added shared pin to scene with ID: ${pinData.id}`);
    
    return photoMesh;
  }

  // Create a segmented control for shared space toggle instead of a toggle switch
  function createSharedSpaceToggle() {
    // First, check if there's an existing toggle to remove
    const existingToggle = document.getElementById('sharedSpaceToggle');
    if (existingToggle && existingToggle.parentNode) {
      existingToggle.parentNode.removeChild(existingToggle);
    }
    
    // Create container
    const container = document.createElement('div');
    container.className = 'storage-setting';
    
    // Create label
    const label = document.createElement('div');
    label.className = 'segmented-control-label';
    label.textContent = 'Storage:';
    container.appendChild(label);
    
    // Create segmented control
    const segmentedControl = document.createElement('div');
    segmentedControl.className = 'segmented-control';
    segmentedControl.setAttribute('data-active', useSharedSpace ? 'shared' : 'local');
    
    // Create Local option
    const localOption = document.createElement('div');
    localOption.className = 'segmented-control-option' + (!useSharedSpace ? ' active' : '');
    localOption.textContent = 'Local';
    localOption.setAttribute('data-value', 'local');
    
    // Create Shared option
    const sharedOption = document.createElement('div');
    sharedOption.className = 'segmented-control-option' + (useSharedSpace ? ' active' : '');
    sharedOption.textContent = 'Shared';
    sharedOption.setAttribute('data-value', 'shared');
    
    // Create sliding indicator
    const indicator = document.createElement('div');
    indicator.className = 'segmented-control-indicator';
    
    // Add elements to segmented control
    segmentedControl.appendChild(localOption);
    segmentedControl.appendChild(sharedOption);
    segmentedControl.appendChild(indicator);
    
    // Add event listeners
    localOption.addEventListener('click', () => {
      if (useSharedSpace) {
        useSharedSpace = false;
        segmentedControl.setAttribute('data-active', 'local');
        localOption.classList.add('active');
        sharedOption.classList.remove('active');
        showNotification('Pins will be saved to local storage', 'info');
        
        // Update section selector disabled state
        updateSectionSelectorState();
      }
    });
    
    sharedOption.addEventListener('click', () => {
      if (!useSharedSpace) {
        useSharedSpace = true;
        segmentedControl.setAttribute('data-active', 'shared');
        sharedOption.classList.add('active');
        localOption.classList.remove('active');
        showNotification('Pins will be saved to shared space', 'info');
        
        // Update section selector disabled state
        updateSectionSelectorState();
      }
    });
    
    // Add segmented control to container
    container.appendChild(segmentedControl);
    
    return container;
  }
  
  // Create the shared space toggle
  createSharedSpaceToggle();

  /**
   * Show admin-specific UI elements
   * This function is called when the current user is verified as an admin
   */
  function showAdminUI() {
    console.log('[showAdminUI] Showing admin UI elements. Current window.isAdmin:', window.isAdmin);
    
    // Ensure global admin flag is set
    window.isAdmin = true;
    console.log('[showAdminUI] Set window.isAdmin to true');
    
    // First, remove any existing admin UI elements
    const existingAdminBadge = document.getElementById('adminBadge');
    if (existingAdminBadge) {
      console.log('[showAdminUI] Removing existing admin badge');
      existingAdminBadge.remove();
    }
    
    const existingManageButton = document.getElementById('managePinsBtn');
    if (existingManageButton) {
      console.log('[showAdminUI] Removing existing manage button');
      existingManageButton.remove();
    }
    
    // Create admin badge
    const adminBadge = document.createElement('div');
    adminBadge.id = 'adminBadge';
    adminBadge.textContent = 'ADMIN';
    adminBadge.style.position = 'fixed';
    adminBadge.style.top = '20px';
    adminBadge.style.right = '20px';
    adminBadge.style.backgroundColor = 'rgba(220, 53, 69, 0.8)';
    adminBadge.style.color = 'white';
    adminBadge.style.padding = '5px 10px';
    adminBadge.style.borderRadius = '4px';
    adminBadge.style.fontWeight = 'bold';
    adminBadge.style.fontSize = '12px';
    adminBadge.style.zIndex = '1000';
    document.body.appendChild(adminBadge);
    
    // Note: Fixed-position 'Manage Pins' button was removed as that functionality
    // is now handled by the 'Manage All Pins' button in the settings view
    
    // Show a notification to confirm admin status
    showNotification('Admin status verified', 'success');
  }

  // Add "Settings" button to contentTypeSelectView
  if (contentTypeSelectView) {
    const selectSettingsBtn = document.createElement('button');
    selectSettingsBtn.id = 'selectSettingsBtn';
    selectSettingsBtn.textContent = 'Settings';
    selectSettingsBtn.addEventListener('click', () => {
      showPanelView('settingsView');
      populateSettingsView();
    });
    contentTypeSelectView.appendChild(selectSettingsBtn);
  }

  // Function to populate and manage the settingsView
  function populateSettingsView() {
    console.log('[populateSettingsView] Called. Current window.isAdmin:', window.isAdmin);
    console.log('[populateSettingsView] Direct DOM check: #settingsView exists:', !!document.getElementById('settingsView'));
    
    // Check DOM state before accessing elements
    const allViews = [
      'contentTypeSelectView', 'cameraModeView', 'imagePreviewView',
      'settingsView', 'adminLoginView', 'adminPinsListView'
    ];
    allViews.forEach(id => {
      const el = document.getElementById(id);
      console.log(`[populateSettingsView] View check: #${id} exists:`, !!el, 
                  el ? `active:${el.classList.contains('active')}, display:${window.getComputedStyle(el).display}` : '');
    });
    
    const settingsViewEl = getEl('settingsView'); // Use getEl to ensure fresh reference
    if (!settingsViewEl) {
      console.error("settingsView element not found in populateSettingsView");
      return;
    }
    
    // Clear any previous content
    settingsViewEl.innerHTML = '';
    
    // Create heading
    const settingsHeading = document.createElement('h2');
    settingsHeading.textContent = 'Settings';
    settingsViewEl.appendChild(settingsHeading);
    
    // 1. Add shared space toggle (previously created directly in body)
    const sharedSpaceToggle = createSharedSpaceToggle();
    settingsViewEl.appendChild(sharedSpaceToggle);
    
    // 2. Add section selector (previously created directly in body)
    const sectionSelector = createSectionSelector();
    settingsViewEl.appendChild(sectionSelector);
    
    // Add a separator
    const separator1 = document.createElement('div');
    separator1.className = 'settings-separator';
    settingsViewEl.appendChild(separator1);
    
    // 3. Admin section - only visible if user is admin
    if (window.isAdmin) {
      console.log('[populateSettingsView] window.isAdmin is TRUE. Creating admin controls.');
      // Admin heading
      const adminHeading = document.createElement('h3');
      adminHeading.textContent = 'Admin Controls';
      settingsViewEl.appendChild(adminHeading);
      
      // Create Manage All Pins button
      const adminManagePinsBtn = document.createElement('button');
      adminManagePinsBtn.id = 'adminManagePinsBtn';
      adminManagePinsBtn.textContent = 'Manage All Pins';
      adminManagePinsBtn.addEventListener('click', () => {
        showAdminPinsList();
      });
      settingsViewEl.appendChild(adminManagePinsBtn);
    } else {
      console.log('[populateSettingsView] window.isAdmin is FALSE. Admin controls not created.');
    }
    
    // 4. Login/Logout section
    if (!window.isAdmin) {
      console.log('[populateSettingsView] Creating Admin Login button (window.isAdmin is false)');
      // Create Admin Login button
      const adminLoginPromptBtn = document.createElement('button');
      adminLoginPromptBtn.id = 'adminLoginPromptBtn';
      adminLoginPromptBtn.textContent = 'Admin Login';
      adminLoginPromptBtn.addEventListener('click', () => {
        showPanelView('adminLoginView');
        populateAdminLoginView();
      });
      settingsViewEl.appendChild(adminLoginPromptBtn);
    } else {
      console.log('[populateSettingsView] Not creating Admin Login button (window.isAdmin is true)');
    }
    
    // Create Sign Out button
    const signOutBtn = document.createElement('button');
    signOutBtn.id = 'signOutBtn';
    signOutBtn.textContent = 'Sign Out';
    signOutBtn.addEventListener('click', () => {
      signOutUser()
        .then(() => {
          console.log('Signed out, reverting to anonymous user.');
          showNotification('Signed out successfully', 'success');
          
          // If there's an admin badge visible, hide it since the admin is now signed out
          const adminBadge = getEl('adminBadge');
          if (adminBadge) {
            console.log('[SignOut] Hiding admin badge');
            adminBadge.style.display = 'none';
          }
          
          // Remove the old fixed position button if it exists (legacy cleanup)
          const oldManagePinsButton = getEl('managePinsBtn');
          if (oldManagePinsButton && oldManagePinsButton.parentNode) {
            console.log('[SignOut] Removing old fixed managePinsBtn from DOM');
            oldManagePinsButton.parentNode.removeChild(oldManagePinsButton);
          }
          
          // Return to the content type selection view
          window.isAdmin = false;
          console.log('[SignOut] Set window.isAdmin to false');
          showPanelView('contentTypeSelectView');
        })
        .catch(error => {
          console.error('Sign out failed:', error);
          showNotification('Sign out failed', 'error');
        });
    });
    settingsViewEl.appendChild(signOutBtn);
    
    // Add another separator
    const separator2 = document.createElement('div');
    separator2.className = 'settings-separator';
    settingsViewEl.appendChild(separator2);
    
    // Create Back button
    const backToContentTypesFromSettingsBtn = document.createElement('button');
    backToContentTypesFromSettingsBtn.id = 'backToContentTypesFromSettingsBtn';
    backToContentTypesFromSettingsBtn.textContent = 'Back';
    backToContentTypesFromSettingsBtn.addEventListener('click', () => {
      showPanelView('contentTypeSelectView');
    });
    settingsViewEl.appendChild(backToContentTypesFromSettingsBtn);
  }

  // Function to populate and manage the adminLoginView
  function populateAdminLoginView() {
    if (!adminLoginView) return;
    
    // Clear any previous content
    adminLoginView.innerHTML = '';
    
    // Create email input
    const adminEmailInput = document.createElement('input');
    adminEmailInput.id = 'adminEmailInput';
    adminEmailInput.type = 'email';
    adminEmailInput.placeholder = 'Admin Email';
    adminEmailInput.style.padding = '10px';
    adminEmailInput.style.borderRadius = '8px';
    adminEmailInput.style.border = 'none';
    adminEmailInput.style.margin = '5px 0';
    adminEmailInput.style.width = '100%';
    adminEmailInput.style.boxSizing = 'border-box';
    adminLoginView.appendChild(adminEmailInput);
    
    // Create password input
    const adminPasswordInput = document.createElement('input');
    adminPasswordInput.id = 'adminPasswordInput';
    adminPasswordInput.type = 'password';
    adminPasswordInput.placeholder = 'Admin Password';
    adminPasswordInput.style.padding = '10px';
    adminPasswordInput.style.borderRadius = '8px';
    adminPasswordInput.style.border = 'none';
    adminPasswordInput.style.margin = '5px 0';
    adminPasswordInput.style.width = '100%';
    adminPasswordInput.style.boxSizing = 'border-box';
    adminLoginView.appendChild(adminPasswordInput);
    
    // Create error message element
    const adminLoginErrorMsg = document.createElement('div');
    adminLoginErrorMsg.id = 'adminLoginErrorMsg';
    adminLoginErrorMsg.style.color = '#ff5252';
    adminLoginErrorMsg.style.fontSize = '14px';
    adminLoginErrorMsg.style.margin = '5px 0';
    adminLoginErrorMsg.style.textAlign = 'center';
    adminLoginErrorMsg.style.display = 'none';
    adminLoginView.appendChild(adminLoginErrorMsg);
    
    // Create login button
    const adminLoginExecuteBtn = document.createElement('button');
    adminLoginExecuteBtn.id = 'adminLoginExecuteBtn';
    adminLoginExecuteBtn.textContent = 'Login';
    adminLoginExecuteBtn.addEventListener('click', () => {
      // Get email and password from input fields
      const email = adminEmailInput.value.trim();
      const password = adminPasswordInput.value;
      
      // Clear any previous error messages
      adminLoginErrorMsg.style.display = 'none';
      
      // Validate inputs
      if (!email || !password) {
        adminLoginErrorMsg.textContent = 'Please enter both email and password';
        adminLoginErrorMsg.style.display = 'block';
        return;
      }
      
      // Attempt to sign in
      console.log('[AdminLogin] Starting login process with email:', email);
      signInWithEmail(email, password)
        .then(() => {
          console.log('[AdminLogin] Firebase authentication successful');
          
          // Clear inputs
          adminEmailInput.value = '';
          adminPasswordInput.value = '';
          
          // Check admin status and update UI
          console.log('[AdminLogin] Now checking admin status via isCurrentUserAdmin()');
          return isCurrentUserAdmin();
        })
        .then(isAdmin => {
          if (isAdmin) {
            window.isAdmin = true;
            console.log('[AdminLoginSuccess] window.isAdmin is now true.');
            showNotification('Admin login successful', 'success');
            // Update UI to reflect admin status
            showAdminUI();
          } else {
            window.isAdmin = false;
            console.log('[AdminLoginSuccess] User logged in but not admin. window.isAdmin is false.');
            showNotification('Logged in, but user is not an admin', 'warning');
          }
          
          console.log('[AdminLoginSuccess] Before showPanelView, window.isAdmin =', window.isAdmin);
          // Return to settings view
          showPanelView('settingsView');
          populateSettingsView();
        })
        .catch(error => {
          console.error('Admin login failed:', error);
          adminLoginErrorMsg.textContent = error.message || 'Login failed. Please check your credentials.';
          adminLoginErrorMsg.style.display = 'block';
        });
    });
    adminLoginView.appendChild(adminLoginExecuteBtn);
    
    // Create back button
    const backToSettingsFromLoginBtn = document.createElement('button');
    backToSettingsFromLoginBtn.id = 'backToSettingsFromLoginBtn';
    backToSettingsFromLoginBtn.textContent = 'Back';
    backToSettingsFromLoginBtn.addEventListener('click', () => {
      // Return to settings view
      showPanelView('settingsView');
      populateSettingsView();
    });
    adminLoginView.appendChild(backToSettingsFromLoginBtn);
  }

  // Function to handle the admin pins list view
  function showAdminPinsList() {
    if (!adminPinsListView) return;
    
    // Clear the view
    adminPinsListView.innerHTML = '';
    
    // Show loading state
    const loadingElement = document.createElement('div');
    loadingElement.textContent = 'Loading shared pins...';
    loadingElement.style.textAlign = 'center';
    loadingElement.style.padding = '20px';
    loadingElement.style.color = 'white';
    adminPinsListView.appendChild(loadingElement);
    
    // Show the pins list view
    showPanelView('adminPinsListView');
    
    // Fetch all shared pins
    getAllSharedPinsForAdmin()
      .then(pins => {
        // Clear the view
        adminPinsListView.innerHTML = '';
        
        // Create heading
        const heading = document.createElement('h2');
        heading.textContent = 'All Shared Pins';
        adminPinsListView.appendChild(heading);
        
        // Create back button
        const backButton = document.createElement('button');
        backButton.textContent = 'Back to Settings';
        backButton.style.marginBottom = '20px';
        backButton.addEventListener('click', () => {
          showPanelView('settingsView');
          populateSettingsView();
        });
        adminPinsListView.appendChild(backButton);
        
        // Create pins count info
        const countInfo = document.createElement('div');
        countInfo.textContent = `${pins.length} pins found`;
        countInfo.style.marginBottom = '15px';
        countInfo.style.textAlign = 'center';
        countInfo.style.color = 'white';
        adminPinsListView.appendChild(countInfo);
        
        // Create pins list container
        const pinsListContainer = document.createElement('div');
        pinsListContainer.className = 'admin-pins-list';
        pinsListContainer.style.overflowY = 'auto';
        pinsListContainer.style.maxHeight = 'calc(100vh - 200px)';
        adminPinsListView.appendChild(pinsListContainer);
        
        if (pins.length === 0) {
          const noPinsMessage = document.createElement('div');
          noPinsMessage.textContent = 'No shared pins found.';
          noPinsMessage.style.textAlign = 'center';
          noPinsMessage.style.padding = '20px';
          noPinsMessage.style.color = 'white';
          pinsListContainer.appendChild(noPinsMessage);
          return;
        }
        
        // Create a table for pins
        const pinsTable = document.createElement('table');
        
        // Create table header
        const tableHead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        const headers = ['Photo', 'Section', 'User ID', 'Created', 'Actions'];
        headers.forEach(headerText => {
          const header = document.createElement('th');
          header.textContent = headerText;
          headerRow.appendChild(header);
        });
        
        tableHead.appendChild(headerRow);
        pinsTable.appendChild(tableHead);
        
        // Create table body
        const tableBody = document.createElement('tbody');
        
        // Add pins to the table
        pins.forEach(pin => {
          const row = document.createElement('tr');
          row.setAttribute('data-id', pin.id);
          
          // Photo cell
          const photoCell = document.createElement('td');
          if (pin.photoURL) {
            const thumbnail = document.createElement('img');
            thumbnail.src = pin.photoURL;
            thumbnail.style.width = '50px';
            thumbnail.style.height = '50px';
            thumbnail.style.objectFit = 'cover';
            thumbnail.style.borderRadius = '4px';
            thumbnail.style.cursor = 'pointer';
            thumbnail.addEventListener('click', () => {
              window.open(pin.photoURL, '_blank');
            });
            photoCell.appendChild(thumbnail);
          } else {
            photoCell.textContent = 'No photo';
          }
          row.appendChild(photoCell);
          
          // Section ID cell
          const sectionCell = document.createElement('td');
          sectionCell.textContent = pin.sectionId || 'Unknown';
          row.appendChild(sectionCell);
          
          // User ID cell
          const userIdCell = document.createElement('td');
          userIdCell.textContent = pin.userId ? (pin.userId.substring(0, 8) + '...') : 'Unknown';
          userIdCell.title = pin.userId || 'Unknown';
          row.appendChild(userIdCell);
          
          // Created at cell
          const createdAtCell = document.createElement('td');
          createdAtCell.textContent = pin.createdAt ? pin.createdAt.toLocaleString() : 'Unknown';
          row.appendChild(createdAtCell);
          
          // Actions cell
          const actionsCell = document.createElement('td');
          const deleteButton = document.createElement('button');
          deleteButton.textContent = 'Delete';
          deleteButton.setAttribute('data-id', pin.id);
          
          // Delete button handler with confirmation
          deleteButton.addEventListener('click', async () => {
            if (confirm("Are you sure you want to delete this pin permanently? This action cannot be undone.")) {
              console.log(`Attempting to delete pin with ID: ${pin.id} and storage path: ${pin.photoStoragePath || 'unknown'}`);
              showNotification(`Deleting pin ${pin.id}...`, 'info');

              try {
                // Step 1: Delete Firestore document
                await deleteSharedPinDoc(pin.id);
                console.log(`Firestore document ${pin.id} deleted successfully.`);

                // Step 2: Delete image from Storage if path exists
                if (pin.photoStoragePath) {
                  try {
                    await deleteImageFromStorage(pin.photoStoragePath);
                    console.log(`Storage file ${pin.photoStoragePath} deleted successfully.`);
                  } catch (storageError) {
                    console.error(`Failed to delete image from Storage (${pin.photoStoragePath}):`, storageError);
                    // Optionally notify user, but proceed with UI cleanup if Firestore doc was deleted
                    showNotification(`Pin data deleted, but failed to delete image file: ${storageError.message}`, 'warning');
                  }
                } else {
                  console.warn(`No photoStoragePath found for pin ${pin.id}. Skipping storage file deletion.`);
                }

                // Step 3: Remove from UI table
                const rowToRemove = row; // We already have the row reference
                if (rowToRemove) {
                  rowToRemove.remove();
                  
                  // Update the count info
                  const currentCount = parseInt(countInfo.textContent.split(' ')[0]) - 1;
                  countInfo.textContent = `${currentCount} pins found`;
                }

                // Step 4: Remove from 3D scene
                const meshToRemove = sharedPinsInScene.find(mesh => mesh.userData.id === pin.id);
                if (meshToRemove) {
                  scene.remove(meshToRemove);
                  if (meshToRemove.geometry) meshToRemove.geometry.dispose();
                  if (meshToRemove.material) {
                    if (meshToRemove.material.map) meshToRemove.material.map.dispose();
                    meshToRemove.material.dispose();
                  }
                  sharedPinsInScene = sharedPinsInScene.filter(mesh => mesh.userData.id !== pin.id);
                  console.log(`Removed mesh for pin ${pin.id} from scene.`);
                } else {
                  console.warn(`Could not find mesh in scene for pin ${pin.id} to remove.`);
                }

                showNotification(`Pin ${pin.id} deleted successfully!`, 'success');
              } catch (firestoreError) {
                console.error(`Failed to delete Firestore document for pin ${pin.id}:`, firestoreError);
                showNotification(`Error deleting pin ${pin.id}: ${firestoreError.message}`, 'error');
              }
            }
          });
          
          actionsCell.appendChild(deleteButton);
          row.appendChild(actionsCell);
          
          tableBody.appendChild(row);
        });
        
        pinsTable.appendChild(tableBody);
        pinsListContainer.appendChild(pinsTable);
      })
      .catch(error => {
        // Show error
        adminPinsListView.innerHTML = '';
        
        const errorMessage = document.createElement('div');
        errorMessage.textContent = `Error loading pins: ${error.message}`;
        errorMessage.style.color = 'red';
        errorMessage.style.padding = '20px';
        errorMessage.style.textAlign = 'center';
        adminPinsListView.appendChild(errorMessage);
        
        // Create back button
        const backButton = document.createElement('button');
        backButton.textContent = 'Back to Settings';
        backButton.addEventListener('click', () => {
          showPanelView('settingsView');
          populateSettingsView();
        });
        adminPinsListView.appendChild(backButton);
      });
  }

  // Update section selector state based on shared space toggle
  function updateSectionSelectorState() {
    const sectionSelector = document.getElementById('sectionSelector');
    if (sectionSelector) {
      const select = document.getElementById('sectionSelect');
      
      if (useSharedSpace) {
        sectionSelector.classList.remove('disabled');
        if (select) select.disabled = false;
      } else {
        sectionSelector.classList.add('disabled');
        if (select) select.disabled = true;
      }
    }
  }
});
