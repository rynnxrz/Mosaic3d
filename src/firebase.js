// Firebase configuration and utilities
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, deleteDoc, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Euler, Quaternion } from 'three'; // Import THREE.js components for viewpoint conversion

// Replace with your Firebase project configuration
// You'll need to replace these values with the ones from your Firebase console
const firebaseConfig = {
  apiKey: "AIzaSyBHwDIhC8QyjjFkVy57g96woRverHBNdCI",
  authDomain: "mosaic3d-shared-dev.firebaseapp.com",
  projectId: "mosaic3d-shared-dev",
  storageBucket: "mosaic3d-shared-dev.firebasestorage.app",
  messagingSenderId: "69872249273",
  appId: "1:69872249273:web:100745c538a49b2046ae68"
};

/**
 * Helper function to convert a value to a Number or return undefined if not a finite number
 * @param {*} val - The value to convert
 * @returns {Number|undefined} The converted number or undefined
 */
function numOrUndef(val) {
  if (val === undefined || val === null) return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Helper function to convert Euler angles to Quaternion
 * @param {Object} rot - Rotation object with x, y, z properties (Euler angles)
 * @returns {Object} Quaternion object with x, y, z, w properties
 */
function eulerToQuaternion(rot = {}) {
  const e = new Euler(
    numOrUndef(rot.x) || 0, 
    numOrUndef(rot.y) || 0, 
    numOrUndef(rot.z) || 0, 
    'YXZ' // Use YXZ order for consistent conversion
  );
  const q = new Quaternion().setFromEuler(e);
  return { 
    x: q.x, 
    y: q.y, 
    z: q.z, 
    w: q.w 
  };
}

/**
 * Helper function to extract and validate x, y, z components from a source object
 * @param {Object} src - The source object
 * @param {string} base - The base key prefix
 * @returns {Object|undefined} An object with x, y, z properties or undefined
 */
function pickXYZ(src, base) {
  if (!src) return undefined;
  
  // Check for flat structure (e.g., base_x, base_y, base_z)
  if (src[`${base}_x`] !== undefined) {
    const x = numOrUndef(src[`${base}_x`]);
    const y = numOrUndef(src[`${base}_y`]);
    const z = numOrUndef(src[`${base}_z`]);
    
    if (x !== undefined && y !== undefined && z !== undefined) {
      return { x, y, z };
    }
    return undefined;
  }
  
  // Check for nested structure (e.g., base.x, base.y, base.z)
  if (src[base] && typeof src[base] === 'object') {
    const x = numOrUndef(src[base].x);
    const y = numOrUndef(src[base].y);
    const z = numOrUndef(src[base].z);
    
    if (x !== undefined && y !== undefined && z !== undefined) {
      return { x, y, z };
    }
  }
  
  return undefined;
}

/**
 * Helper function to extract and validate x, y, z, w components from a source object
 * @param {Object} src - The source object
 * @param {string} base - The base key prefix
 * @returns {Object|undefined} An object with x, y, z, w properties or undefined
 */
function pickXYZW(src, base) {
  if (!src) return undefined;
  
  // Check for flat structure (e.g., base_x, base_y, base_z, base_w)
  if (src[`${base}_x`] !== undefined) {
    const x = numOrUndef(src[`${base}_x`]);
    const y = numOrUndef(src[`${base}_y`]);
    const z = numOrUndef(src[`${base}_z`]);
    const w = numOrUndef(src[`${base}_w`]);
    
    if (x !== undefined && y !== undefined && z !== undefined && w !== undefined) {
      return { x, y, z, w };
    }
    return undefined;
  }
  
  // Check for nested structure (e.g., base.x, base.y, base.z, base.w)
  if (src[base] && typeof src[base] === 'object') {
    const x = numOrUndef(src[base].x);
    const y = numOrUndef(src[base].y);
    const z = numOrUndef(src[base].z);
    const w = numOrUndef(src[base].w);
    
    if (x !== undefined && y !== undefined && z !== undefined && w !== undefined) {
      return { x, y, z, w };
    }
  }
  
  return undefined;
}

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Collection references
const PINS_COLLECTION = 'pins';
const IMAGES_COLLECTION = 'images';
const SHARED_PINS_COLLECTION = 'sharedPins';

// Authentication state
let currentUser = null;

/**
 * Check if the current user has admin privileges
 * @returns {Promise<boolean>} Promise that resolves to true if user is an admin, false otherwise
 */
export async function isCurrentUserAdmin() {
  try {
    console.log('[isCurrentUserAdmin] Function called to check admin status');
    
    // Check if user is signed in
    const user = auth.currentUser;
    if (!user) {
      console.log('[isCurrentUserAdmin] No user signed in, cannot check admin status');
      return false;
    }
    
    console.log('[isCurrentUserAdmin] Current user:', user.uid, 'Email:', user.email);
    
    // Force refresh to get the latest token with claims
    const idTokenResult = await user.getIdTokenResult(true);
    
    // Log token claims for debugging
    console.log('[isCurrentUserAdmin] Token claims:', JSON.stringify(idTokenResult.claims, null, 2));
    
    // Check for admin claim
    const isAdmin = idTokenResult.claims.admin === true;
    console.log(`[isCurrentUserAdmin] User ${user.uid} admin status: ${isAdmin}`);
    
    // Also update window.isAdmin for easier access throughout the app
    if (typeof window !== 'undefined') {
      window.isAdmin = isAdmin;
      console.log('[isCurrentUserAdmin] Updated window.isAdmin to:', isAdmin);
    }
    
    return isAdmin;
  } catch (error) {
    console.error('[isCurrentUserAdmin] Error checking admin status:', error);
    return false;
  }
}

/**
 * Get shared pins from Firestore based on sectionId
 * @param {string} sectionId - The ID of the section to fetch pins from
 * @returns {Promise<Array>} A promise that resolves with an array of pin objects
 */
export async function getSharedPins(sectionId) {
  try {
    console.log(`[Firebase] Fetching shared pins for section: ${sectionId}`);
    
    // Create a query against the sharedPins collection
    const pinsQuery = query(
      collection(db, SHARED_PINS_COLLECTION),
      where("sectionId", "==", sectionId),
      orderBy("createdAt", "asc") // Order by createdAt in ascending order (oldest first)
    );
    
    // Execute the query
    const querySnapshot = await getDocs(pinsQuery);
    
    // Process the query results
    const pins = [];
    querySnapshot.forEach((doc) => {
      // Get raw data from Firestore
      const rawData = doc.data();
      console.log('[Firebase] Raw Shared Pin Data:', JSON.parse(JSON.stringify(rawData)));
      
      // Create processed pin object with document ID
      const processedPin = {
        id: doc.id,
        ...rawData
      };
      
      // Convert Firestore timestamp to JavaScript Date if it exists
      if (processedPin.createdAt) {
        processedPin.createdAt = processedPin.createdAt.toDate();
      }
      
      // Process creator viewpoint data for compatibility with main.js
      if (processedPin.creatorViewpoint) {
        // Extract and validate position data
        if (processedPin.creatorViewpoint.position) {
          const pos = processedPin.creatorViewpoint.position;
          processedPin.creatorViewpointPosition = {
            x: numOrUndef(pos.x),
            y: numOrUndef(pos.y),
            z: numOrUndef(pos.z)
          };
          
          // If any component is undefined, make the whole position undefined
          if (processedPin.creatorViewpointPosition.x === undefined || 
              processedPin.creatorViewpointPosition.y === undefined || 
              processedPin.creatorViewpointPosition.z === undefined) {
            processedPin.creatorViewpointPosition = undefined;
          }
        }
        
        // Process quaternion data - handle both rotation (Euler) and direct quaternion
        if (processedPin.creatorViewpoint.rotation) {
          // Convert Euler rotation to quaternion
          processedPin.creatorViewpointQuaternion = eulerToQuaternion(processedPin.creatorViewpoint.rotation);
        } else if (processedPin.creatorViewpoint.quaternion) {
          // Use existing quaternion data if available
          const quat = processedPin.creatorViewpoint.quaternion;
          processedPin.creatorViewpointQuaternion = {
            x: numOrUndef(quat.x),
            y: numOrUndef(quat.y),
            z: numOrUndef(quat.z),
            w: numOrUndef(quat.w)
          };
          
          // If any component is undefined, make the whole quaternion undefined
          if (Object.values(processedPin.creatorViewpointQuaternion).some(v => v === undefined)) {
            processedPin.creatorViewpointQuaternion = undefined;
          }
        }
        
        // Remove the nested creatorViewpoint to prevent confusion in main.js
        delete processedPin.creatorViewpoint;
      }
      
      // Process pin orientation - add pinQuaternion if it exists
      if (processedPin.pinQuaternion) {
        // Ensure all components are valid numbers
        const q = processedPin.pinQuaternion;
        if (numOrUndef(q.x) !== undefined && 
            numOrUndef(q.y) !== undefined && 
            numOrUndef(q.z) !== undefined && 
            numOrUndef(q.w) !== undefined) {
          // Keep the pinQuaternion as is, it's already valid
        } else {
          // Invalid quaternion, delete it
          delete processedPin.pinQuaternion;
        }
      }
      
      console.log('[Firebase] Processed Shared Pin for main.js:', JSON.parse(JSON.stringify(processedPin)));
      pins.push(processedPin);
    });
    
    console.log(`[Firebase] Found ${pins.length} shared pins for section: ${sectionId}`);
    return pins;
  } catch (error) {
    console.error(`[Firebase] Error fetching shared pins for section ${sectionId}:`, error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

/**
 * Sign in anonymously if no user is currently signed in
 * @returns {Promise<Object>} Firebase User object
 */
export function signInAnonymouslyIfNeeded() {
  return new Promise((resolve, reject) => {
    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe(); // Stop listening once we get the initial state
      
      if (user) {
        // User is already signed in
        console.log('User already signed in:', user.uid);
        currentUser = user;
        resolve(user);
      } else {
        // No user is signed in, sign in anonymously
        console.log('No user signed in, signing in anonymously...');
        signInAnonymously(auth)
          .then((userCredential) => {
            const user = userCredential.user;
            console.log('Anonymous sign-in successful:', user.uid);
            currentUser = user;
            resolve(user);
          })
          .catch((error) => {
            console.error('Anonymous sign-in error:', error);
            reject(error);
          });
      }
    });
  });
}

/**
 * Get the current Firebase user ID
 * @returns {string|null} The current user ID or null if not signed in
 */
export function getCurrentFirebaseUserId() {
  return currentUser ? currentUser.uid : null;
}

/**
 * Initialize Firebase and sign in anonymously
 * @returns {Promise} A promise that resolves when Firebase is initialized and user is signed in
 */
export function initFirebase() {
  console.log('Initializing Firebase...');
  return signInAnonymouslyIfNeeded()
    .then(user => {
      console.log('Firebase initialized with user ID:', user.uid);
      return user;
    })
    .catch(error => {
      console.error('Firebase initialization error:', error);
      throw error;
    });
}

/**
 * Add a shared pin to the Firestore sharedPins collection
 * @param {Object} pinData - Object containing pin data
 * @param {string} pinData.photoURL - URL to the photo
 * @param {Object} pinData.position - Position object with x, y, z coordinates
 * @param {Object} pinData.rotation - Rotation object with x, y, z Euler angles
 * @param {Object} pinData.transform - Transform data including quaternion
 * @param {string} pinData.sectionId - ID of the section where the pin is placed
 * @returns {Promise<string>} A promise that resolves with the ID of the newly created document
 */
export async function addSharedPin(pinData) {
  // Get current user ID
  const userId = getCurrentFirebaseUserId();
  
  // Validate user authentication
  if (!userId) {
    const error = new Error('User not authenticated. Cannot add shared pin.');
    console.error(error);
    throw error;
  }
  
  try {
    // Construct the document data
    const sharedPinDoc = {
      ...pinData,              // Include all fields from pinData
      userId: userId,          // Add the user ID
      createdAt: serverTimestamp() // Add server timestamp
    };
    
    // Store quaternion directly if available in transform data
    if (pinData.transform && pinData.transform.quaternion) {
      sharedPinDoc.pinQuaternion = {
        x: numOrUndef(pinData.transform.quaternion.x),
        y: numOrUndef(pinData.transform.quaternion.y),
        z: numOrUndef(pinData.transform.quaternion.z),
        w: numOrUndef(pinData.transform.quaternion.w)
      };
      console.log('[Firebase] Storing pin quaternion:', sharedPinDoc.pinQuaternion);
    }
    
    // If creatorViewpoint exists with rotation (Euler), also store as quaternion
    if (pinData.creatorViewpoint && pinData.creatorViewpoint.rotation) {
      // Convert Euler to quaternion and store as flat fields
      const vpQuat = eulerToQuaternion(pinData.creatorViewpoint.rotation);
      
      // Store as flat fields for better compatibility
      sharedPinDoc.creatorViewpointQuaternion_x = numOrUndef(vpQuat.x);
      sharedPinDoc.creatorViewpointQuaternion_y = numOrUndef(vpQuat.y);
      sharedPinDoc.creatorViewpointQuaternion_z = numOrUndef(vpQuat.z);
      sharedPinDoc.creatorViewpointQuaternion_w = numOrUndef(vpQuat.w);
      
      // Store position as flat fields if it exists
      if (pinData.creatorViewpoint.position) {
        const pos = pinData.creatorViewpoint.position;
        sharedPinDoc.creatorViewpointPosition_x = numOrUndef(pos.x);
        sharedPinDoc.creatorViewpointPosition_y = numOrUndef(pos.y);
        sharedPinDoc.creatorViewpointPosition_z = numOrUndef(pos.z);
      }
      
      console.log('[Firebase] Storing creator viewpoint data in flat format');
    }
    
    // Add the document to the sharedPins collection
    const docRef = await addDoc(collection(db, SHARED_PINS_COLLECTION), sharedPinDoc);
    
    console.log(`[Firebase] Shared pin added with ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error('[Firebase] Error adding shared pin:', error);
    throw error;
  }
}

/**
 * Save a pinned photo to Firestore
 * @param {string} imageId - The unique ID for the image
 * @param {string} base64ImageData - Base64 encoded image data
 * @param {Object} transformData - Position, orientation, scale data, and optional creator viewpoint
 * @returns {Promise} A promise that resolves when the save is complete
 */
export async function savePinnedItemToFirestore(imageId, base64ImageData, transformData) {
  const userId = getCurrentFirebaseUserId();
  if (!userId) {
    throw new Error('User not authenticated');
  }

  try {
    // Save image data to images collection
    await setDoc(doc(db, IMAGES_COLLECTION, imageId), {
      userId: userId,
      base64: base64ImageData,
      type: transformData.type || 'image/jpeg',
      timestamp: Date.now()
    });

    // Save pin metadata to pins collection
    const pinData = {
      userId: userId,
      imageId: imageId,
      timestamp: Date.now(),
      position: transformData.position,
      orientation: transformData.orientation,
      scale: transformData.scale,
      userScale: transformData.userScale,
      aspectRatio: transformData.aspectRatio
    };

    // Add creator viewpoint if available
    const cv = transformData.creatorViewpoint;
    if (cv && cv.position) {
      pinData.creatorViewpoint = {
        position: {
          x: Number(cv.position.x),
          y: Number(cv.position.y),
          z: Number(cv.position.z)
        }
      };

      if (cv.quaternion) {
        pinData.creatorViewpoint.quaternion = {
          x: Number(cv.quaternion.x),
          y: Number(cv.quaternion.y),
          z: Number(cv.quaternion.z),
          w: Number(cv.quaternion.w)
        };
      }
    }

    await setDoc(doc(db, PINS_COLLECTION, imageId), pinData);
    console.log(`[Firebase] Pin saved with ID: ${imageId}`);
    return imageId;
  } catch (error) {
    console.error('[Firebase] Error saving pin:', error);
    throw error;
  }
}

/**
 * Load all pinned items for the current user
 * @returns {Promise<Array>} A promise that resolves with an array of pin data
 */
export async function loadPinnedItemsFromFirestore() {
  const userId = getCurrentFirebaseUserId();
  if (!userId) {
    throw new Error('User not authenticated');
  }

  try {
    // Query pins for current user
    const pinsQuery = query(collection(db, PINS_COLLECTION), where("userId", "==", userId));
    const pinsSnapshot = await getDocs(pinsQuery);
    
    const pins = [];
    for (const pinDoc of pinsSnapshot.docs) {
      const pinData = pinDoc.data();
      
      // Get the associated image data
      const imageDoc = await getDoc(doc(db, IMAGES_COLLECTION, pinData.imageId));
      if (imageDoc.exists()) {
        const imageData = imageDoc.data();
        
        pins.push({
          id: pinDoc.id,
          imageData: imageData,
          metadata: pinData
        });
      }
    }
    
    console.log(`[Firebase] Loaded ${pins.length} pins for user ${userId}`);
    return pins;
  } catch (error) {
    console.error('[Firebase] Error loading pins:', error);
    throw error;
  }
}

/**
 * Delete a pinned item from Firestore
 * @param {string} imageId - The ID of the pin to delete
 * @returns {Promise} A promise that resolves when the deletion is complete
 */
export async function deletePinnedItemFromFirestore(imageId) {
  const userId = getCurrentFirebaseUserId();
  if (!userId) {
    throw new Error('User not authenticated');
  }

  try {
    // Delete the pin metadata
    await deleteDoc(doc(db, PINS_COLLECTION, imageId));
    
    // Delete the image data
    await deleteDoc(doc(db, IMAGES_COLLECTION, imageId));
    
    console.log(`[Firebase] Deleted pin with ID: ${imageId}`);
  } catch (error) {
    console.error('[Firebase] Error deleting pin:', error);
    throw error;
  }
}

/**
 * Load shared pins from a specific section
 * @param {string} sectionId - The ID of the section to load pins from
 * @returns {Promise<Array>} A promise that resolves with an array of shared pin data
 */
export async function loadSharedPins(sectionId) {
  try {
    // Query shared pins for the specified section
    const sharedPinsQuery = query(
      collection(db, SHARED_PINS_COLLECTION), 
      where("sectionId", "==", sectionId)
    );
    
    const pinsSnapshot = await getDocs(sharedPinsQuery);
    
    const sharedPins = [];
    for (const pinDoc of pinsSnapshot.docs) {
      const pinData = pinDoc.data();
      
      // Convert Firestore timestamp to JS Date
      if (pinData.createdAt) {
        pinData.createdAt = pinData.createdAt.toDate();
      }
      
      sharedPins.push({
        id: pinDoc.id,
        ...pinData
      });
    }
    
    console.log(`[Firebase] Loaded ${sharedPins.length} shared pins for section ${sectionId}`);
    return sharedPins;
  } catch (error) {
    console.error('[Firebase] Error loading shared pins:', error);
    throw error;
  }
}

/**
 * Sign in with email and password
 * @param {string} email - The user's email
 * @param {string} password - The user's password
 * @returns {Promise<Object>} Firebase UserCredential object
 */
export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password)
    .then((userCredential) => {
      console.log(`[Firebase] Email sign-in successful for user: ${userCredential.user.uid}`);
      currentUser = userCredential.user;
      return userCredential;
    })
    .catch((error) => {
      console.error('[Firebase] Email sign-in error:', error);
      throw error;
    });
}

/**
 * Sign out the current user and revert to anonymous authentication
 * @returns {Promise} A promise that resolves when sign-out and anonymous sign-in are complete
 */
export function signOutUser() {
  return signOut(auth)
    .then(() => {
      console.log('[Firebase] User signed out successfully');
      // After sign out, sign in anonymously
      return signInAnonymouslyIfNeeded();
    })
    .then((user) => {
      console.log('[Firebase] Reverted to anonymous user:', user.uid);
      return user;
    })
    .catch((error) => {
      console.error('[Firebase] Error during sign-out process:', error);
      throw error;
    });
}

/**
 * Get all shared pins for admin, across all sections
 * @returns {Promise<Array>} A promise that resolves with an array of all shared pins
 */
export async function getAllSharedPinsForAdmin() {
  try {
    // Check if user is admin
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) {
      throw new Error('Unauthorized: Only admins can access all shared pins');
    }

    console.log('[Firebase] Admin fetching all shared pins');
    
    // Create a query against the sharedPins collection, ordered by createdAt (newest first)
    const pinsQuery = query(
      collection(db, SHARED_PINS_COLLECTION),
      orderBy("createdAt", "desc") // Order by createdAt in descending order (newest first)
    );
    
    // Execute the query
    const querySnapshot = await getDocs(pinsQuery);
    
    // Process the query results
    const pins = [];
    querySnapshot.forEach((doc) => {
      const pinData = doc.data();
      
      // Convert Firestore timestamp to JavaScript Date if it exists
      if (pinData.createdAt) {
        pinData.createdAt = pinData.createdAt.toDate();
      }
      
      // Add the document ID to the pin data
      pins.push({
        id: doc.id,
        ...pinData
      });
    });
    
    console.log(`[Firebase] Admin found ${pins.length} total shared pins`);
    return pins;
  } catch (error) {
    console.error(`[Firebase] Error fetching all shared pins for admin:`, error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

/**
 * Upload a photo to Firebase Storage
 * @param {string} userId - The authenticated Firebase user's UID
 * @param {Blob} imageBlob - The image data to upload
 * @param {string} fileName - A unique name for the file
 * @returns {Promise<string>} A promise that resolves with the download URL
 */
export async function uploadPhotoToStorage(userId, imageBlob, fileName) {
  console.log(`[Firebase] Uploading photo to Storage for user: ${userId}, filename: ${fileName}`);
  
  if (!userId) {
    throw new Error('User ID is required for uploading to Firebase Storage');
  }
  
  if (!imageBlob) {
    throw new Error('Image blob is required for uploading to Firebase Storage');
  }
  
  try {
    // Construct the storage path
    const storagePath = `sharedPins_images/${userId}/${fileName}`;
    console.log(`[Firebase] Storage path: ${storagePath}`);
    
    // Create a reference to the file location
    const storageRef = ref(storage, storagePath);
    
    // Upload the file
    const snapshot = await uploadBytes(storageRef, imageBlob);
    console.log(`[Firebase] Upload complete. Bytes transferred: ${snapshot.metadata.size}`);
    
    // Get the download URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log(`[Firebase] Download URL: ${downloadURL}`);
    
    return downloadURL;
  } catch (error) {
    console.error('[Firebase] Error uploading photo to Storage:', error);
    throw error; // Re-throw the error to be handled by the caller
  }
}

/**
 * Delete a shared pin document from Firestore
 * @param {string} pinId - The ID of the shared pin document to delete
 * @returns {Promise<void>} A promise that resolves when the document is deleted
 */
export async function deleteSharedPinDoc(pinId) {
  try {
    // Check if user is admin
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) {
      throw new Error('Unauthorized: Only admins can delete shared pins');
    }

    console.log(`[Firebase] Deleting shared pin document with ID: ${pinId}`);
    
    // Delete the document from the sharedPins collection
    await deleteDoc(doc(db, SHARED_PINS_COLLECTION, pinId));
    
    console.log(`[Firebase] Successfully deleted shared pin document: ${pinId}`);
    return true;
  } catch (error) {
    console.error(`[Firebase] Error deleting shared pin document ${pinId}:`, error);
    throw error; // Re-throw to allow calling code to handle it
  }
}

/**
 * Delete an image file from Firebase Storage
 * @param {string} storagePath - The path to the file in Firebase Storage
 * @returns {Promise<void>} A promise that resolves when the file is deleted
 */
export async function deleteImageFromStorage(storagePath) {
  try {
    // Check if user is admin
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) {
      throw new Error('Unauthorized: Only admins can delete files from Storage');
    }

    console.log(`[Firebase] Deleting image from Storage at path: ${storagePath}`);
    
    // Create a reference to the file
    const storageRef = ref(storage, storagePath);
    
    // Delete the file
    await deleteObject(storageRef);
    
    console.log(`[Firebase] Successfully deleted image from Storage: ${storagePath}`);
    return true;
  } catch (error) {
    // Check if it's a "file not found" error, which we can consider non-critical
    if (error.code === 'storage/object-not-found') {
      console.warn(`[Firebase] File not found in Storage (${storagePath}). It may have been deleted already.`);
      return true; // Consider this a "success" from a cleanup perspective
    }
    
    console.error(`[Firebase] Error deleting image from Storage (${storagePath}):`, error);
    throw error; // Re-throw to allow calling code to handle it
  }
}

export { db, auth, storage }; 