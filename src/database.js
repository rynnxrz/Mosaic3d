// Database configuration
const DB_NAME = 'Mosaic3DUserCreationsDB';
const DB_VERSION = 2;
const IMAGES_STORE = 'images';
const METADATA_STORE = 'pinnedPhotoMetadata';

// Database instance
let db = null;

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
 * Initialize the IndexedDB database
 * @returns {Promise} A promise that resolves when the database is ready
 */
export function initDB() {
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
}

/**
 * Persist a pinned photo (metadata + transform) to IndexedDB.
 * All numeric fields are stored as numbers so typeof === 'number' on retrieval.
 * @param {Blob} imageBlob - The image blob to save
 * @param {string} imageId - The unique ID for the image
 * @param {Object} transformData - Position, orientation, scale data, and optional creator viewpoint
 * @returns {Promise} A promise that resolves when the save is complete
 */
export function savePinnedItem(imageBlob, imageId, transformData) {
  return new Promise(async (resolve, reject) => {
    if (!db) {
      try {
        // Attempt to initialize db if it's null, useful if called before main initDB completes
        await initDB();
        if (!db) {
          reject(new Error('Database not initialized after attempted init.'));
          return;
        }
      } catch (initError) {
        reject(new Error('Database initialization failed in savePinnedItem: ' + initError));
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

    const reader = new FileReader();
    reader.readAsDataURL(imageBlob); // Start reading the blob

    reader.onload = () => { // This is an async callback
      const base64ImageData = reader.result;
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
    }; // End of reader.onload

    reader.onerror = (event) => {
      console.error('[DB] FileReader error in savePinnedItem:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Load all pinned photos from IndexedDB and recreate them in the scene
 * @param {THREE.Scene} scene - The Three.js scene to add meshes to
 * @param {Function} callbackToRecreateMesh - Function to recreate the mesh from blob and metadata
 * @returns {Promise} A promise that resolves when all items are loaded
 */
export function loadPinnedItems(scene, callbackToRecreateMesh) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized. Call initDB() first.'));
      return;
    }

    try {
      console.log('Starting to load pinned items from IndexedDB');
      
      const transaction = db.transaction([IMAGES_STORE, METADATA_STORE], 'readonly');
      
      transaction.onerror = (event) => {
        console.error('Transaction error:', event.target.error);
        reject(event.target.error);
      };
      
      // Get all metadata records
      const metadataStore = transaction.objectStore(METADATA_STORE);
      const imageStore = transaction.objectStore(IMAGES_STORE);
      
      const metadataRequest = metadataStore.getAll();
      
      metadataRequest.onsuccess = () => {
        const metadataRecords = metadataRequest.result;
        console.log(`Found ${metadataRecords.length} pinned photos to load`);
        
        // Log all imageIds for debugging
        console.log('ImageIDs to load:', metadataRecords.map(record => record.imageId));
        
        // Use Promise.all to wait for all photos to be processed
        const loadPromises = metadataRecords.map(metadata => {
          return new Promise((resolveItem, rejectItem) => {
            // Get the corresponding image
            console.log(`Loading image for imageId: ${metadata.imageId}`);
            const imageRequest = imageStore.get(metadata.imageId);
            
            imageRequest.onsuccess = () => {
              const imageRecord = imageRequest.result;
              console.log(`Image record retrieved for imageId: ${metadata.imageId}`, 
                imageRecord ? {
                  'record keys': Object.keys(imageRecord),
                  'has base64': !!imageRecord.base64,
                  'has blob': !!imageRecord.blob,
                  'type': imageRecord.type
                } : 'No record found');
              
              // Try loading with base64 string first (new method)
              if (imageRecord && imageRecord.base64) {
                try {
                  console.log(`Found base64 data for imageId: ${metadata.imageId}, length: ${imageRecord.base64.length}`);
                  
                  // Convert base64 to Blob
                  const base64Data = imageRecord.base64;
                  
                  // Check if it's a data URL (starts with data:image/)
                  const isDataUrl = base64Data.startsWith('data:');
                  let base64Content;
                  let contentType;
                  
                  if (isDataUrl) {
                    // Extract content type and base64 part
                    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
                    if (!matches || matches.length !== 3) {
                      throw new Error('Invalid data URL format');
                    }
                    contentType = matches[1];
                    base64Content = matches[2];
                  } else {
                    // Assume it's just a base64 string
                    contentType = imageRecord.type || 'image/jpeg';
                    base64Content = base64Data;
                  }
                  
                  // Convert base64 to binary
                  const byteCharacters = atob(base64Content);
                  const byteArrays = [];
                  
                  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
                    const slice = byteCharacters.slice(offset, offset + 512);
                    
                    const byteNumbers = new Array(slice.length);
                    for (let i = 0; i < slice.length; i++) {
                      byteNumbers[i] = slice.charCodeAt(i);
                    }
                    
                    const byteArray = new Uint8Array(byteNumbers);
                    byteArrays.push(byteArray);
                  }
                  
                  const blob = new Blob(byteArrays, { type: contentType });
                  
                  console.log(`Blob created successfully from base64 for imageId: ${metadata.imageId}`, {
                    'blob size': blob.size,
                    'blob type': blob.type
                  });
                  
                  // Call the provided callback to recreate the mesh
                  callbackToRecreateMesh(blob, metadata);
                  resolveItem();
                } catch (error) {
                  console.error(`Error converting base64 to Blob for imageId: ${metadata.imageId}`, error);
                  resolveItem(); // Still resolve to allow other items to load
                }
              } 
              // Fallback to blob property (old method)
              else if (imageRecord && imageRecord.blob) {
                try {
                  console.log(`Using direct blob for imageId: ${metadata.imageId}`, {
                    'blob type': imageRecord.blob.type,
                    'blob size': imageRecord.blob.size,
                    'blob is instanceof Blob': imageRecord.blob instanceof Blob
                  });
                  
                  // Call the provided callback to recreate the mesh
                  callbackToRecreateMesh(imageRecord.blob, metadata);
                  resolveItem();
                } catch (error) {
                  console.error(`Error using blob for imageId: ${metadata.imageId}`, error);
                  resolveItem(); // Resolve even if error to continue with others
                }
              } else {
                // Debug the specific issue
                if (!imageRecord) {
                  console.warn(`No image record found for imageId: ${metadata.imageId}`);
                } else {
                  console.warn(`Image record found for imageId: ${metadata.imageId} but no usable image data`);
                  console.log('Image record details:', {
                    id: imageRecord.id,
                    keys: Object.keys(imageRecord),
                    'base64 exists': !!imageRecord.base64,
                    'blob exists': !!imageRecord.blob
                  });
                }
                
                resolveItem(); // Resolve even if image not found to continue with others
              }
            };
            
            imageRequest.onerror = (event) => {
              console.error(`Error fetching image for imageId: ${metadata.imageId}`, event.target.error);
              rejectItem(event.target.error);
            };
          });
        });
        
        Promise.all(loadPromises)
          .then(() => {
            console.log('All pinned photos loaded successfully');
            resolve();
          })
          .catch(error => {
            console.error('Error loading pinned photos:', error);
            reject(error);
          });
      };
      
      metadataRequest.onerror = (event) => {
        console.error('Error fetching metadata:', event.target.error);
        reject(event.target.error);
      };
      
    } catch (error) {
      console.error('Error in loadPinnedItems:', error);
      reject(error);
    }
  });
}

/**
 * Delete a pinned photo and its metadata from IndexedDB
 * @param {string} imageId - The unique ID for the image to delete
 * @returns {Promise} A promise that resolves when the delete is complete
 */
export function deletePinnedItem(imageId) {
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
        console.log('Delete transaction completed successfully');
        resolve();
      };
      
      // Delete the image 
      const imageStore = transaction.objectStore(IMAGES_STORE);
      imageStore.delete(imageId);
      
      // Delete all metadata records with this imageId
      const metadataStore = transaction.objectStore(METADATA_STORE);
      const index = metadataStore.index('imageId');
      const request = index.getAllKeys(imageId);
      
      request.onsuccess = () => {
        const keys = request.result;
        keys.forEach(key => {
          metadataStore.delete(key);
        });
      };
      
    } catch (error) {
      console.error('Error in deletePinnedItem:', error);
      reject(error);
    }
  });
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