import './style.css'
import * as THREE from 'three';

window.addEventListener('DOMContentLoaded', () => {
  // Get DOM elements
  const canvasContainer = document.getElementById('canvas-container');
  const joystickBase = document.getElementById('joystick-base');
  const joystickHandle = document.getElementById('joystick-handle');
  const lookArea = document.getElementById('look-area');

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
  const MOVE_SENSITIVITY = 0.2; // Movement speed multiplier
  const LOOK_SENSITIVITY = 0.15; // Look speed multiplier
  const CAMERA_HEIGHT = 5.5; // Camera Y position (eye level)
  const CAMERA_COLLISION_RADIUS = 2.5; // Camera collision radius

  // --- Three.js 3D Scene Setup ---
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75,
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
    move.addScaledVector(right, -joystickDelta.x * MOVE_SENSITIVITY); // Notice the minus sign
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
    const height = window.innerHeight * 0.8;
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
});
