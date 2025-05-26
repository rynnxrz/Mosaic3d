/**
 * Firebase Admin SDK - Set Admin Custom Claims
 * 
 * IMPORTANT: This script is for conceptual reference only. It must be run in a secure environment
 * (server, Cloud Function, or local development machine) with appropriate Firebase Admin SDK credentials.
 * 
 * Prerequisites:
 * 1. Install Firebase Admin SDK: npm install firebase-admin
 * 2. Download service account key from Firebase Console:
 *    - Go to Project Settings > Service Accounts
 *    - Click "Generate new private key"
 *    - Save the JSON file securely
 * 3. Replace 'path/to/serviceAccountKey.json' with the path to your service account key file
 * 4. Replace 'TARGET_USER_UID' with the actual Firebase User ID to grant admin privileges
 */

const admin = require('firebase-admin');

// Initialize the Firebase Admin SDK with service account credentials
const serviceAccount = require('/Users/ssxu/Downloads/firebase-admin-scripts/mosaic3d-shared-dev-firebase-adminsdk-fbsvc-c2e424c0e8.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// The Firebase User ID to grant admin privileges
const targetUserUid = 'gS1xUtsm9lOrDpuCv3DfeKXj0ju2';

// Set the custom claim
admin.auth().setCustomUserClaims(targetUserUid, { admin: true })
  .then(() => {
    console.log(`Successfully set admin claim for user: ${targetUserUid}`);
    
    // Verify the claim was set correctly
    return admin.auth().getUser(targetUserUid);
  })
  .then((userRecord) => {
    console.log('User record:');
    console.log(`UID: ${userRecord.uid}`);
    console.log(`Email: ${userRecord.email || 'No email'}`);
    console.log(`Custom claims: ${JSON.stringify(userRecord.customClaims)}`);
    
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error setting custom claim:', error);
    process.exit(1);
  });

/**
 * NOTES:
 * 
 * 1. For anonymous users:
 *    - You can set admin claims on anonymous users, but they will be lost if the user signs out
 *    - For testing, you can use an anonymous user ID, but for production, use a persistent account
 * 
 * 2. Getting the current user's UID:
 *    - In the browser console of your app, you can get the current user's UID by running:
 *      firebase.auth().currentUser.uid
 *    - Or in your app code, log the UID after authentication:
 *      console.log(auth.currentUser.uid)
 * 
 * 3. Alternative: Firebase Cloud Functions
 *    - You can also set custom claims using an HTTP callable Cloud Function
 *    - This approach requires proper authentication and authorization checks
 *    - Example Cloud Function code:
 *
 *      exports.setAdminRole = functions.https.onCall((data, context) => {
 *        // Check if the request is made by an admin
 *        if (!context.auth.token.admin === true) {
 *          throw new functions.https.HttpsError('permission-denied', 'Only admins can add other admins');
 *        }
 *        
 *        // Get the user and add custom claim
 *        return admin.auth().getUserByEmail(data.email).then(user => {
 *          return admin.auth().setCustomUserClaims(user.uid, { admin: true });
 *        }).then(() => {
 *          return { result: 'Success' };
 *        }).catch(err => {
 *          return { error: err.message };
 *        });
 *      });
 */ 