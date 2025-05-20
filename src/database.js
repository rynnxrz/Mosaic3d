// Database configuration
const DB_NAME = 'Mosaic3DUserCreationsDB';
const DB_VERSION = 2;
const IMAGES_STORE = 'images';
const METADATA_STORE = 'pinnedPhotoMetadata';

// Database instance
let db = null;

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
 * Save a pinned photo and its transform data to IndexedDB
 * @param {Blob} imageBlob - The image blob to save
 * @param {string} imageId - The unique ID for the image
 * @param {Object} transformData - Position, orientation, scale data, and optional creator viewpoint
 * @returns {Promise} A promise that resolves when the save is complete
 */
export function savePinnedItem(imageBlob, imageId, transformData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized. Call initDB() first.'));
      return;
    }

    // Validate the input Blob
    console.log('savePinnedItem called with:', {
      imageId,
      'imageBlob instanceof Blob': imageBlob instanceof Blob,
      'imageBlob size': imageBlob ? imageBlob.size : 'N/A',
      'imageBlob type': imageBlob ? imageBlob.type : 'N/A'
    });

    if (!imageBlob || !(imageBlob instanceof Blob) || imageBlob.size === 0) {
      console.error('Invalid Blob provided to savePinnedItem:', imageBlob);
      reject(new Error('Invalid Blob: ' + (imageBlob ? `size: ${imageBlob.size}` : 'null or undefined')));
      return;
    }

    // Create a clean copy of the transformData to ensure proper serialization
    const cleanTransformData = {
      position: { ...transformData.position },
      orientation: { ...transformData.orientation },
      scale: { ...transformData.scale },
      userScale: transformData.userScale || 1.0,
      aspectRatio: transformData.aspectRatio || 1.0
    };
    
    // Add creator viewpoint if available
    if (transformData.creatorViewpoint) {
      if (transformData.creatorViewpoint.position) {
        cleanTransformData.creatorViewpointPosition_x = transformData.creatorViewpoint.position.x;
        cleanTransformData.creatorViewpointPosition_y = transformData.creatorViewpoint.position.y;
        cleanTransformData.creatorViewpointPosition_z = transformData.creatorViewpoint.position.z;
      }
      if (transformData.creatorViewpoint.quaternion) {
        cleanTransformData.creatorViewpointQuaternion_x = transformData.creatorViewpoint.quaternion.x;
        cleanTransformData.creatorViewpointQuaternion_y = transformData.creatorViewpoint.quaternion.y;
        cleanTransformData.creatorViewpointQuaternion_z = transformData.creatorViewpoint.quaternion.z;
        cleanTransformData.creatorViewpointQuaternion_w = transformData.creatorViewpoint.quaternion.w;
      }
    }

    // Convert the Blob to a base64-encoded string for reliable storage
    const reader = new FileReader();
    reader.onload = function() {
      try {
        const base64String = reader.result;
        console.log(`Read blob as base64 string, length: ${base64String.length}`);
        
        const transaction = db.transaction([IMAGES_STORE, METADATA_STORE], 'readwrite');
        
        transaction.onerror = (event) => {
          console.error('Transaction error:', event.target.error);
          reject(event.target.error);
        };
        
        transaction.oncomplete = () => {
          console.log(`Save transaction completed successfully for imageId: ${imageId}`);
          resolve();
        };
        
        // Save the image using a simple string representation
        const imageStore = transaction.objectStore(IMAGES_STORE);
        const imageRecord = {
          id: imageId,
          base64: base64String,
          type: imageBlob.type || 'image/jpeg'
        };
        
        console.log('Storing image record as base64 string:', {
          id: imageId,
          'base64 exists': !!base64String,
          'base64 length': base64String.length,
          type: imageBlob.type || 'image/jpeg'
        });
        
        const imageRequest = imageStore.put(imageRecord);
        
        imageRequest.onsuccess = () => {
          console.log(`Image saved successfully with ID: ${imageId}`);
          
          // Verify the saved record
          const verifyRequest = imageStore.get(imageId);
          verifyRequest.onsuccess = () => {
            const savedRecord = verifyRequest.result;
            console.log('Verification - Saved image record:', {
              id: savedRecord.id,
              'base64 exists': !!savedRecord.base64,
              'base64 length': savedRecord.base64 ? savedRecord.base64.length : 0,
              type: savedRecord.type,
              'record keys': Object.keys(savedRecord)
            });
          };
        };
        
        imageRequest.onerror = (event) => {
          console.error('Error saving image:', event.target.error);
        };
        
        // Save the metadata
        const metadataStore = transaction.objectStore(METADATA_STORE);
        const metadataRecord = {
          imageId: imageId,
          position: cleanTransformData.position,
          orientation: cleanTransformData.orientation,
          scale: cleanTransformData.scale,
          userScale: cleanTransformData.userScale,
          aspectRatio: cleanTransformData.aspectRatio,
          timestamp: Date.now()
        };
        
        // Add creator viewpoint data if available
        if (cleanTransformData.creatorViewpointPosition_x !== undefined) {
          metadataRecord.creatorViewpointPosition_x = cleanTransformData.creatorViewpointPosition_x;
          metadataRecord.creatorViewpointPosition_y = cleanTransformData.creatorViewpointPosition_y;
          metadataRecord.creatorViewpointPosition_z = cleanTransformData.creatorViewpointPosition_z;
        }
        
        if (cleanTransformData.creatorViewpointQuaternion_x !== undefined) {
          metadataRecord.creatorViewpointQuaternion_x = cleanTransformData.creatorViewpointQuaternion_x;
          metadataRecord.creatorViewpointQuaternion_y = cleanTransformData.creatorViewpointQuaternion_y;
          metadataRecord.creatorViewpointQuaternion_z = cleanTransformData.creatorViewpointQuaternion_z;
          metadataRecord.creatorViewpointQuaternion_w = cleanTransformData.creatorViewpointQuaternion_w;
        }
        
        const metadataRequest = metadataStore.add(metadataRecord);
        metadataRequest.onsuccess = () => {
          console.log(`Metadata saved successfully for imageId: ${imageId}`);
        };
        
        metadataRequest.onerror = (event) => {
          console.error('Error saving metadata:', event.target.error);
        };
      } catch (error) {
        console.error('Error processing base64 string:', error);
        reject(error);
      }
    };
    
    reader.onerror = (error) => {
      console.error('FileReader error:', reader.error);
      reject(reader.error || new Error('FileReader failed'));
    };
    
    // Read the blob as a data URL to get a base64 string
    console.log(`Starting to read blob as Data URL, size: ${imageBlob.size}`);
    reader.readAsDataURL(imageBlob);
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