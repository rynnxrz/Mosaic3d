// Database configuration
const DB_NAME = 'Mosaic3DUserCreationsDB';
const DB_VERSION = 2;
const IMAGES_STORE = 'images';
const METADATA_STORE = 'pinnedPhotoMetadata';

// Import Firebase functions
import { initFirebase, getCurrentFirebaseUserId, savePinnedItemToFirestore, loadPinnedItemsFromFirestore, deletePinnedItemFromFirestore } from './firebase.js';

// Database instance
let db = null;
let useFirebase = true; // Set to true to use Firebase, false to use only IndexedDB

/**
 * Get the database instance, opening it if necessary
 * @returns {Promise} A promise that resolves with the database instance
 */
async function getDB() {
  if (db) return db;
  // This reuses parts of your existing initDB logic but returns a promise
  return new Promise((resolve, reject) => {
    console.log(`Attempting to get/open IndexedDB: ${DB_NAME}, version: ${DB_VERSION}`);
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB error in getDB:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result; // Assign to global db if you still use it elsewhere
      console.log('Database accessed successfully in getDB.');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      // This should ideally be handled by your main initDB,
      // but getDB needs to be aware of it if it's the first open.
      console.log('Database upgrade needed in getDB context.');
      db = event.target.result;
      // ... (your existing onupgradeneeded logic for creating stores if necessary)
      // For this task, we assume stores are already created by the main initDB.
    };
  });
}

/**
 * Initialize the database (both IndexedDB and Firebase if enabled)
 * @returns {Promise} A promise that resolves when the database is ready
 */
export async function initDB() {
  try {
    // Initialize Firebase if enabled
    if (useFirebase) {
      await initFirebase();
      console.log('Firebase initialized with user ID:', getCurrentFirebaseUserId());
    }
    
    // Initialize IndexedDB
    return new Promise((resolve, reject) => {
      if (db) {
        resolve(db);
        return;
      }

      console.log(`Opening IndexedDB database: ${DB_NAME}, version: ${DB_VERSION}`);
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        console.log('Database initialized successfully');
        
        // Log the object store names for debugging
        console.log('Object stores in the database:', Array.from(db.objectStoreNames));
        
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        db = event.target.result;
        console.log('Database upgrade needed, creating object stores');
        const oldVersion = event.oldVersion;
        console.log(`Upgrading from version ${oldVersion} to ${DB_VERSION}`);
        
        // Create object store for images with imageId as key
        if (!db.objectStoreNames.contains(IMAGES_STORE)) {
          const imageStore = db.createObjectStore(IMAGES_STORE, { keyPath: 'id' });
          console.log(`Created '${IMAGES_STORE}' object store with keyPath 'id'`);
        } else {
          console.log(`Object store '${IMAGES_STORE}' already exists`);
        }
        
        // Create object store for metadata with auto-incrementing ID
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          const metadataStore = db.createObjectStore(METADATA_STORE, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          
          // Create index on imageId for quick lookups
          metadataStore.createIndex('imageId', 'imageId', { unique: false });
          console.log(`Created '${METADATA_STORE}' object store with keyPath 'id' and index on 'imageId'`);
        } else {
          console.log(`Object store '${METADATA_STORE}' already exists`);
          
          // We don't need to modify existing store structure for version upgrade
          // IndexedDB automatically preserves existing data and structure
        }
      };
    });
  } catch (error) {
    console.error('Error initializing databases:', error);
    throw error;
  }
}

/**
 * Get the current user ID (from Firebase if enabled, or generate a local one)
 * @returns {string} The user ID
 */
export function getUserId() {
  if (useFirebase) {
    const firebaseUserId = getCurrentFirebaseUserId();
    if (firebaseUserId) {
      return firebaseUserId;
    }
  }
  
  // Fallback to local storage for user ID if Firebase is not available
  let userId = localStorage.getItem('mosaic3d_user_id');
  if (!userId) {
    // Generate a simple UUID
    userId = 'local_' + Math.random().toString(36).substring(2, 15) + 
             Math.random().toString(36).substring(2, 15);
    localStorage.setItem('mosaic3d_user_id', userId);
  }
  return userId;
}

/**
 * Persist a pinned photo (metadata + transform) to storage (IndexedDB and/or Firebase).
 * All numeric fields are stored as numbers so typeof === 'number' on retrieval.
 * @param {Blob} imageBlob - The image blob to save
 * @param {string} imageId - The unique ID for the image
 * @param {Object} transformData - Position, orientation, scale data, and optional creator viewpoint
 * @returns {Promise} A promise that resolves when the save is complete
 */
export function savePinnedItem(imageBlob, imageId, transformData) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!db) {
        await initDB();
        if (!db) {
          reject(new Error('Database not initialized after attempted init.'));
          return;
        }
      }

      // Validate the input Blob
      console.log('savePinnedItem called with:', {
        imageId,
        'imageBlob instanceof Blob': imageBlob instanceof Blob,
        'imageBlob size': imageBlob ? imageBlob.size : 'N/A',
        'imageBlob type': imageBlob ? imageBlob.type : 'N/A'
      });

      if (!imageBlob || !(imageBlob instanceof Blob) || imageBlob.size === 0) {
        reject(new Error('Invalid Blob: ' + (imageBlob ? `size: ${imageBlob.size}` : 'null or undefined')));
        return;
      }

      // Read the blob as base64
      const base64ImageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(imageBlob);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
      });

      // Save to Firebase if enabled
      if (useFirebase) {
        try {
          // Add the user ID to transform data
          transformData.userId = getUserId();
          transformData.type = imageBlob.type || 'image/jpeg';
          
          await savePinnedItemToFirestore(imageId, base64ImageData, transformData);
          console.log(`[Firebase] Pin saved with ID: ${imageId}`);
        } catch (firebaseError) {
          console.error('[Firebase] Error saving pin:', firebaseError);
          // Continue with IndexedDB save even if Firebase fails
        }
      }

      // Always save to IndexedDB as a backup
      let transaction;
      try {
        transaction = db.transaction([IMAGES_STORE, METADATA_STORE], 'readwrite');
      } catch (e) {
        reject(new Error(`Failed to start transaction: ${e.message}`));
        return;
      }

      transaction.oncomplete = () => {
        console.info(`[DB] Transaction completed for imageId: ${imageId}. Image and metadata saved.`);
        resolve();
      };
      transaction.onerror = (event) => {
        console.error('[DB] Transaction error in savePinnedItem:', event.target.error);
        reject(event.target.error);
      };

      // 1. Save image to IMAGES_STORE
      try {
        const imageStore = transaction.objectStore(IMAGES_STORE);
        const imageRecord = {
          id: imageId, // Assuming imageId is the key for images
          base64: base64ImageData,
          type: imageBlob.type || 'image/jpeg'
        };
        const imageRequest = imageStore.put(imageRecord);
        imageRequest.onerror = (event) => {
          console.error('[DB] Error saving image to IMAGES_STORE:', event.target.error);
          // Don't reject here, let the transaction.onerror handle it or it might commit prematurely
        };
        imageRequest.onsuccess = () => {
          console.log(`[DB] Image saved to IMAGES_STORE with ID: ${imageId}`);
        };
      } catch (e) {
        console.error("[DB] Error accessing IMAGES_STORE:", e);
        if (!transaction.aborted) transaction.abort(); // Abort if possible
        reject(e); // Reject the main promise
        return;
      }
     
      // 2. Prepare and save metadata to METADATA_STORE
      try {
        const metadataStore = transaction.objectStore(METADATA_STORE);
        const metadataRecord = {
          // id: auto-incrementing, so don't set it if your keyPath is 'id' and autoIncrement is true
          imageId: imageId,
          timestamp: Date.now(),
          userId: getUserId(), // Add user ID to metadata
          position: transformData.position,
          orientation: transformData.orientation,
          scale: transformData.scale,
          userScale: transformData.userScale,
          aspectRatio: transformData.aspectRatio
        };

        const cv = transformData.creatorViewpoint;
        if (cv && cv.position) {
          metadataRecord.creatorViewpointPosition_x = Number(cv.position.x);
          metadataRecord.creatorViewpointPosition_y = Number(cv.position.y);
          metadataRecord.creatorViewpointPosition_z = Number(cv.position.z);

          if (cv.quaternion) { // cv.quaternion is the THREE.Quaternion object from main.js
            const q = cv.quaternion; // Alias for clarity
            const qx = Number(q.x);
            const qy = Number(q.y);
            const qz = Number(q.z);
            const qw = Number(q.w);

            metadataRecord.creatorViewpointQuaternion_x = Number.isFinite(qx) ? qx : null;
            metadataRecord.creatorViewpointQuaternion_y = Number.isFinite(qy) ? qy : null;
            metadataRecord.creatorViewpointQuaternion_z = Number.isFinite(qz) ? qz : null;
            metadataRecord.creatorViewpointQuaternion_w = Number.isFinite(qw) ? qw : null; // CRITICAL: Ensure 'w' is handled
          } else {
            // If cv.quaternion is null or undefined, explicitly set all components to null in the DB record
            metadataRecord.creatorViewpointQuaternion_x = null;
            metadataRecord.creatorViewpointQuaternion_y = null;
            metadataRecord.creatorViewpointQuaternion_z = null;
            metadataRecord.creatorViewpointQuaternion_w = null;
          }
        } else {
          metadataRecord.creatorViewpointPosition_x = null;
          metadataRecord.creatorViewpointPosition_y = null;
          metadataRecord.creatorViewpointPosition_z = null;
          ['x', 'y', 'z', 'w'].forEach(k => { metadataRecord[`creatorViewpointQuaternion_${k}`] = null; });
        }
       
        const metadataRequest = metadataStore.add(metadataRecord); // Use add for auto-incrementing key
        metadataRequest.onerror = (event) => {
          console.error('[DB] Error saving metadata to METADATA_STORE:', event.target.error);
        };
        metadataRequest.onsuccess = (event_success) => { // event_success.target.result will be the new key
          console.log(`[DB] Metadata saved to METADATA_STORE with new ID: ${event_success.target.result} for imageId: ${imageId}`);
        };
      } catch (e) {
        console.error("[DB] Error accessing METADATA_STORE:", e);
        if (!transaction.aborted) transaction.abort();
        reject(e);
        return;
      }
    } catch (error) {
      console.error('Error in savePinnedItem:', error);
      reject(error);
    }
  });
}

/**
 * Load pinned items from storage (Firebase and/or IndexedDB)
 * @param {Object} scene - The THREE.js scene to add items to
 * @param {Function} callbackToRecreateMesh - Callback to recreate mesh from data
 * @returns {Promise} A promise that resolves when loading is complete
 */
export async function loadPinnedItems(scene, callbackToRecreateMesh) {
  try {
    // Initialize database if needed
    if (!db) {
      await initDB();
    }
    
    // Try to load from Firebase first if enabled
    if (useFirebase) {
      try {
        const firebasePins = await loadPinnedItemsFromFirestore();
        console.log(`[Firebase] Loaded ${firebasePins.length} pins`);
        
        // Process Firebase pins
        for (const pin of firebasePins) {
          const imageData = pin.imageData;
          const metadata = pin.metadata;
          
          // Convert base64 to Blob
          const base64Data = imageData.base64.split(',')[1];
          const byteCharacters = atob(base64Data);
          const byteArrays = [];
          
          for (let i = 0; i < byteCharacters.length; i += 1024) {
            const slice = byteCharacters.slice(i, i + 1024);
            const byteNumbers = new Array(slice.length);
            for (let j = 0; j < slice.length; j++) {
              byteNumbers[j] = slice.charCodeAt(j);
            }
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
          }
          
          const imageBlob = new Blob(byteArrays, { type: imageData.type });
          
          // Convert Firebase metadata format to the format expected by callbackToRecreateMesh
          const transformedMetadata = {
            imageId: metadata.imageId,
            position: metadata.position,
            orientation: metadata.orientation,
            scale: metadata.scale,
            userScale: metadata.userScale,
            aspectRatio: metadata.aspectRatio
          };
          
          // Add creator viewpoint if available
          if (metadata.creatorViewpoint) {
            transformedMetadata.creatorViewpointPosition_x = metadata.creatorViewpoint.position.x;
            transformedMetadata.creatorViewpointPosition_y = metadata.creatorViewpoint.position.y;
            transformedMetadata.creatorViewpointPosition_z = metadata.creatorViewpoint.position.z;
            
            if (metadata.creatorViewpoint.quaternion) {
              transformedMetadata.creatorViewpointQuaternion_x = metadata.creatorViewpoint.quaternion.x;
              transformedMetadata.creatorViewpointQuaternion_y = metadata.creatorViewpoint.quaternion.y;
              transformedMetadata.creatorViewpointQuaternion_z = metadata.creatorViewpoint.quaternion.z;
              transformedMetadata.creatorViewpointQuaternion_w = metadata.creatorViewpoint.quaternion.w;
            }
          }
          
          // Recreate mesh
          callbackToRecreateMesh(imageBlob, transformedMetadata);
        }
        
        // If we successfully loaded from Firebase, we can return early
        if (firebasePins.length > 0) {
          return;
        }
      } catch (firebaseError) {
        console.error('[Firebase] Error loading pins:', firebaseError);
        // Fall back to IndexedDB if Firebase fails
      }
    }
    
    // Fall back to IndexedDB
    return new Promise((resolve, reject) => {
      try {
        // Get all metadata records
        const transaction = db.transaction([METADATA_STORE, IMAGES_STORE], 'readonly');
        const metadataStore = transaction.objectStore(METADATA_STORE);
        const imageStore = transaction.objectStore(IMAGES_STORE);
        
        const metadataRequest = metadataStore.openCursor();
        
        metadataRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const metadata = cursor.value;
            const imageId = metadata.imageId;
            
            // Fetch the corresponding image
            const imageRequest = imageStore.get(imageId);
            
            imageRequest.onsuccess = (event) => {
              const imageRecord = event.target.result;
              if (imageRecord) {
                // Convert base64 to Blob
                const base64Data = imageRecord.base64.split(',')[1];
                const byteCharacters = atob(base64Data);
                const byteArrays = [];
                
                for (let i = 0; i < byteCharacters.length; i += 1024) {
                  const slice = byteCharacters.slice(i, i + 1024);
                  const byteNumbers = new Array(slice.length);
                  for (let j = 0; j < slice.length; j++) {
                    byteNumbers[j] = slice.charCodeAt(j);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  byteArrays.push(byteArray);
                }
                
                const imageBlob = new Blob(byteArrays, { type: imageRecord.type });
                
                // Recreate mesh
                callbackToRecreateMesh(imageBlob, metadata);
              }
            };
            
            imageRequest.onerror = (event) => {
              console.error(`Error fetching image with ID ${imageId}:`, event.target.error);
            };
            
            cursor.continue();
          } else {
            console.log('No more entries in metadata store');
            resolve();
          }
        };
        
        metadataRequest.onerror = (event) => {
          console.error('Error opening metadata cursor:', event.target.error);
          reject(event.target.error);
        };
        
        transaction.oncomplete = () => {
          console.log('All pinned items loaded from IndexedDB');
          resolve();
        };
        
        transaction.onerror = (event) => {
          console.error('Transaction error in loadPinnedItems:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in loadPinnedItems:', error);
        reject(error);
      }
    });
  } catch (error) {
    console.error('Error in loadPinnedItems:', error);
    throw error;
  }
}

/**
 * Delete a pinned item from storage (Firebase and/or IndexedDB)
 * @param {string} imageId - The ID of the image to delete
 * @returns {Promise} A promise that resolves when the deletion is complete
 */
export async function deletePinnedItem(imageId) {
  try {
    // Delete from Firebase if enabled
    if (useFirebase) {
      try {
        await deletePinnedItemFromFirestore(imageId);
      } catch (firebaseError) {
        console.error('[Firebase] Error deleting pin:', firebaseError);
        // Continue with IndexedDB deletion even if Firebase fails
      }
    }
    
    // Always delete from IndexedDB
    return new Promise((resolve, reject) => {
      if (!db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      try {
        const transaction = db.transaction([METADATA_STORE, IMAGES_STORE], 'readwrite');
        const metadataStore = transaction.objectStore(METADATA_STORE);
        const imageStore = transaction.objectStore(IMAGES_STORE);
        const metadataIndex = metadataStore.index('imageId');
        
        // Find and delete metadata entries with matching imageId
        const metadataRequest = metadataIndex.openCursor(IDBKeyRange.only(imageId));
        
        metadataRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        
        // Delete the image
        imageStore.delete(imageId);
        
        transaction.oncomplete = () => {
          console.log(`Successfully deleted pinned item with imageId: ${imageId}`);
          resolve();
        };
        
        transaction.onerror = (event) => {
          console.error('Transaction error in deletePinnedItem:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in deletePinnedItem:', error);
        reject(error);
      }
    });
  } catch (error) {
    console.error('Error in deletePinnedItem:', error);
    throw error;
  }
}

/**
 * Clear all data from the database
 * @returns {Promise} A promise that resolves when the clear is complete
 */
export function clearDatabase() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized. Call initDB() first.'));
      return;
    }

    try {
      const transaction = db.transaction([IMAGES_STORE, METADATA_STORE], 'readwrite');
      
      transaction.onerror = (event) => {
        console.error('Transaction error:', event.target.error);
        reject(event.target.error);
      };
      
      transaction.oncomplete = () => {
        console.log('Clear transaction completed successfully');
        resolve();
      };
      
      // Clear both stores
      transaction.objectStore(IMAGES_STORE).clear();
      transaction.objectStore(METADATA_STORE).clear();
      
    } catch (error) {
      console.error('Error in clearDatabase:', error);
      reject(error);
    }
  });
}

/**
 * Return every pinned-photo record, reconstructing nested structures
 * and guaranteeing numeric field types.
 * @returns {Promise<Array>} A promise that resolves with an array of all metadata records
 */
export function getAllPinnedPhotoMetadata() { // Changed to non-async, returns Promise directly
  return new Promise(async (resolve, reject) => {
    if (!db) {
      try {
        await initDB(); // Or: await getDB();
        if (!db) {
          reject(new Error('Database not initialized after attempted init in getAll.'));
          return;
        }
      } catch (initError) {
        reject(new Error('Database initialization failed in getAll: ' + initError));
        return;
      }
    }

    let transaction;
    try {
      transaction = db.transaction([METADATA_STORE], 'readonly');
    } catch (e) {
      reject(new Error(`Failed to start transaction in getAll: ${e.message}`));
      return;
    }
    
    const objectStore = transaction.objectStore(METADATA_STORE);
    const request = objectStore.getAll(); // Correctly call getAll() on the object store

    request.onerror = (event) => {
      console.error('[DB] Error getting all metadata:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = () => {
      const allRawRecords = request.result;
      console.log(`[DB] getAllPinnedPhotoMetadata: Retrieved ${allRawRecords.length} raw records.`);

      const formattedRecords = allRawRecords.map(rec => {
        const out = { ...rec };

        const px = Number(rec.creatorViewpointPosition_x);
        const py = Number(rec.creatorViewpointPosition_y);
        const pz = Number(rec.creatorViewpointPosition_z);
        if ([px, py, pz].every(Number.isFinite)) {
          out.creatorViewpointPosition = { x: px, y: py, z: pz };
        } else {
          out.creatorViewpointPosition = null;
        }

        const qx_db = Number(rec.creatorViewpointQuaternion_x);
        const qy_db = Number(rec.creatorViewpointQuaternion_y);
        const qz_db = Number(rec.creatorViewpointQuaternion_z);
        const qw_db = Number(rec.creatorViewpointQuaternion_w);

        if ([qx_db, qy_db, qz_db, qw_db].every(Number.isFinite)) {
          out.creatorViewpointQuaternion = { x: qx_db, y: qy_db, z: qz_db, w: qw_db };
        } else {
          out.creatorViewpointQuaternion = null; // If any component is not a finite number, set the whole object to null
        }
        
        // Clean up flat fields from the output object (optional but good practice)
        delete out.creatorViewpointPosition_x;
        delete out.creatorViewpointPosition_y;
        delete out.creatorViewpointPosition_z;
        delete out.creatorViewpointQuaternion_x;
        delete out.creatorViewpointQuaternion_y;
        delete out.creatorViewpointQuaternion_z;
        delete out.creatorViewpointQuaternion_w;

        return out;
      });
      console.info('[DB] getAllPinnedPhotoMetadata: Processed records:', JSON.parse(JSON.stringify(formattedRecords)));
      resolve(formattedRecords);
    };
  });
} 