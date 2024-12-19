import { db, rtdb } from "./firebase-config.js";
import { doc, setDoc, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/9.21.0/firebase-firestore.js";
import { ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/9.21.0/firebase-database.js";

const hostCodeDisplay = document.getElementById("host-code-display");
const startShareBtn = document.getElementById("start-share");
const stopShareBtn = document.getElementById("stop-share");
const clientCodeInput = document.getElementById("client-code");
const connectBtn = document.getElementById("connect");
const remoteScreen = document.getElementById("remote-screen");

const permissionDialog = document.getElementById("permission-dialog");
const acceptRequestBtn = document.getElementById("accept-request");
const rejectRequestBtn = document.getElementById("reject-request");

let hostCode;
let mediaStream;
let sharingRequestRef;

// Function to generate a unique device code
async function generateUniqueCode() {
  let code;
  let isUnique = false;

  while (!isUnique) {
    code = Math.random().toString(36).substr(2, 6); // Generate random code
    const docRef = doc(db, "sessions", code);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      isUnique = true; // Code is unique
    }
  }

  return code;
}

// Initialize the host's device code
async function initializeHostCode() {
  hostCode = await generateUniqueCode();
  hostCodeDisplay.innerText = hostCode; // Display the generated code

  // Save the host code in Firestore with an "available" status
  const hostDoc = doc(db, "sessions", hostCode);
  await setDoc(hostDoc, { status: "available", hostCode });

  // Listen for incoming sharing requests
  sharingRequestRef = ref(rtdb, `sessions/${hostCode}/request`);
  onValue(sharingRequestRef, (snapshot) => {
    if (snapshot.exists()) {
      showPermissionDialog(snapshot.val());
    }
  });
}

// Show the permission dialog
function showPermissionDialog(clientCode) {
  permissionDialog.style.display = "flex"; // Show the modal

  acceptRequestBtn.onclick = async () => {
    permissionDialog.style.display = "none";
    set(ref(rtdb, `sessions/${hostCode}/status`), "accepted");
    console.log("Request accepted. Starting screen sharing...");
    startScreenSharing(); // Automatically start screen sharing
  };

  rejectRequestBtn.onclick = async () => {
    permissionDialog.style.display = "none";
    set(ref(rtdb, `sessions/${hostCode}/status`), "rejected");
    console.log("Request rejected.");
  };
}

// Start screen sharing directly after acceptance
function startScreenSharing() {
  startShareBtn.click(); // Trigger the click event of the Start Sharing button
}

// Start screen sharing
startShareBtn.addEventListener("click", async () => {
  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true });

    const streamRef = ref(rtdb, `sessions/${hostCode}/stream`);

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const video = document.createElement("video");
    video.srcObject = mediaStream;
    video.play();

    const sendFrame = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameData = canvas.toDataURL("image/webp");
      set(streamRef, frameData);
    };

    setInterval(sendFrame, 100);
    console.log("Screen sharing started successfully.");
    stopShareBtn.style.display = "inline-block"; // Show Stop Sharing button
    startShareBtn.style.display = "none"; // Hide Start Sharing button
  } catch (error) {
    console.error("Error starting screen sharing:", error);
  }
});

// Stop screen sharing
stopShareBtn.addEventListener("click", async () => {
  mediaStream.getTracks().forEach((track) => track.stop());
  await remove(ref(rtdb, `sessions/${hostCode}/stream`));
  console.log("Screen sharing stopped.");
  stopShareBtn.style.display = "none"; // Hide Stop Sharing button
  startShareBtn.style.display = "inline-block"; // Show Start Sharing button
});

// Client connects using the entered device code
connectBtn.addEventListener("click", async () => {
  const clientCode = clientCodeInput.value.trim();
  if (!clientCode) {
    alert("Please enter a valid device code.");
    return;
  }

  console.log("Requesting to connect to host with code:", clientCode);

  const requestRef = ref(rtdb, `sessions/${clientCode}/request`);
  await set(requestRef, hostCode); // Send request to host

  const statusRef = ref(rtdb, `sessions/${clientCode}/status`);
  onValue(statusRef, (snapshot) => {
    if (snapshot.exists()) {
      const status = snapshot.val();
      if (status === "accepted") {
        console.log("Sharing request accepted.");
        startReceivingStream(clientCode);
      } else if (status === "rejected") {
        console.log("Sharing request rejected.");
        alert("Your sharing request was rejected.");
      }
    }
  });
});

// Start receiving stream
function startReceivingStream(clientCode) {
  const streamRef = ref(rtdb, `sessions/${clientCode}/stream`);
  onValue(streamRef, (snapshot) => {
    if (snapshot.exists()) {
      const frameData = snapshot.val();
      const img = new Image();
      img.src = frameData;
      remoteScreen.innerHTML = "";
      remoteScreen.appendChild(img);
    }
  });
}

// Initialize the app
initializeHostCode();
