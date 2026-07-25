// Web config for the shared `mulmoserver` Firebase project, used by the remote-host
// command channel from BOTH sides: the server's session controller seeds its app with
// it, and the browser's does the same.
//
// The values are NOT secrets — they identify the project to the client SDK, and access
// is gated by Firestore security rules. Safe to commit. Firestore must be in Native mode.
export const firebaseConfig = {
  apiKey: "AIzaSyC5IrhcCtfVQ4nZeI89Owa7da_D-It0b9s",
  authDomain: "mulmoserver.firebaseapp.com",
  projectId: "mulmoserver",
  storageBucket: "mulmoserver.firebasestorage.app",
  messagingSenderId: "830257137330",
  appId: "1:830257137330:web:5cb8db01ae61b5d161abab",
  measurementId: "G-Y75JGK1G4T",
} as const;
