// Import necessary Firebase modules
import { db, rtdb } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.21.0/firebase-firestore.js";
import { ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/9.21.0/firebase-database.js";

// DOM Elements
const hostCodeDisplay = document.getElementById("host-code-display");
const startShareBtn = document.getElementById("start-share");
const stopShareBtn = document.getElementById("stop-share");
const clientCodeInput = document.getElementById("client-code");
const connectBtn = document.getElementById("connect");
const remoteScreen = document.getElementById("remote-screen");
const permissionDialog = new bootstrap.Modal(document.getElementById("permission-modal"));
const rejectedDialog = new bootstrap.Modal(document.getElementById("rejected-modal"));
const stoppedDialog = new bootstrap.Modal(document.getElementById("stopped-modal"));

// Permission Checkboxes
const allowScreenShare = document.getElementById("allow-screen-share");
const allowMouseControl = document.getElementById("allow-mouse-control");
const allowKeyboardControl = document.getElementById("allow-keyboard-control");
const allowFileTransfer = document.getElementById("allow-file-transfer");
const allowAllAccess = document.getElementById("allow-all-access");

let hostCode;
let mediaStream;
let sharingRequestRef;
let clientCodeForControl;
let sharingStartTime;

// Function to generate a unique device code
async function generateUniqueCode() {
  let code;
  let isUnique = false;

  while (!isUnique) {
    code = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const docRef = doc(db, "sessions", code);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      isUnique = true;
    }
  }
  return code;
}

// Initialize the host's device code
async function initializeHostCode() {
  hostCode = await generateUniqueCode();
  hostCodeDisplay.innerText = `Your Code: ${hostCode}`;

  // Save the host code in Firestore
  const hostDoc = doc(db, "sessions", hostCode);
  await setDoc(hostDoc, { status: "available", hostCode });

  // Listen for sharing requests
  sharingRequestRef = ref(rtdb, `sessions/${hostCode}/request`);
  onValue(sharingRequestRef, (snapshot) => {
    if (snapshot.exists()) {
      showPermissionDialog(snapshot.val());
    }
  });

  // Listen for remote control events
  listenForRemoteControl();
}

// Show the permission dialog
function showPermissionDialog(clientCode) {
  permissionDialog.show();

  document.getElementById("accept-request").onclick = async () => {
    const permissions = {
      screenShare: allowScreenShare.checked,
      mouseControl: allowMouseControl.checked,
      keyboardControl: allowKeyboardControl.checked,
      fileTransfer: allowFileTransfer.checked,
    };

    if (allowAllAccess.checked) {
      permissions.screenShare = true;
      permissions.mouseControl = true;
      permissions.keyboardControl = true;
      permissions.fileTransfer = true;
    }

    await set(ref(rtdb, `sessions/${hostCode}/status`), {
      status: "accepted",
      permissions
    });

    console.log("Request accepted with permissions:", permissions);
    permissionDialog.hide();

    if (permissions.screenShare) startScreenSharing();
  };

  document.getElementById("reject-request").onclick = async () => {
    await set(ref(rtdb, `sessions/${hostCode}/status`), { status: "rejected" });
    console.log("Request rejected.");
    permissionDialog.hide();
  };
}

// Start screen sharing
async function startScreenSharing() {
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
    console.log("Screen sharing started.");

    stopShareBtn.style.display = "block";
    startShareBtn.style.display = "none";
  } catch (error) {
    console.error("Error starting screen sharing:", error);
  }
}

// Stop screen sharing
stopShareBtn.addEventListener("click", async () => {
  mediaStream.getTracks().forEach((track) => track.stop());
  await remove(ref(rtdb, `sessions/${hostCode}/stream`));

  console.log("Screen sharing stopped.");
  stopShareBtn.style.display = "none";
  startShareBtn.style.display = "block";
});

// Connect client
connectBtn.addEventListener("click", async () => {
  const clientCode = clientCodeInput.value.trim();
  if (!clientCode) {
    alert("Please enter a valid device code.");
    return;
  }

  console.log("Requesting to connect to host with code:", clientCode);
  const requestRef = ref(rtdb, `sessions/${clientCode}/request`);
  await set(requestRef, hostCode);

  const statusRef = ref(rtdb, `sessions/${clientCode}/status`);
  onValue(statusRef, (snapshot) => {
    if (snapshot.exists()) {
      const statusData = snapshot.val();
      if (statusData.status === "accepted") {
        console.log("Sharing request accepted.");
        clientCodeForControl = clientCode;
        startReceivingStream(clientCode);
        captureClientEvents(statusData.permissions);
      } else if (statusData.status === "rejected") {
        console.log("Sharing request rejected.");
        rejectedDialog.show();
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

// Listen for remote control events
function listenForRemoteControl() {
  const controlRef = ref(rtdb, `sessions/${hostCode}/controlEvents`);
  onValue(controlRef, (snapshot) => {
    if (snapshot.exists()) {
      const event = snapshot.val();
      simulateEvent(event);
    }
  });
}

// Simulate input events
function simulateEvent(event) {
  if (event.type === "mousemove") {
    console.log(`Simulating mousemove to (${event.x}, ${event.y})`);
  } else if (event.type === "click") {
    console.log(`Simulating click at (${event.x}, ${event.y})`);
  } else if (event.type === "keydown") {
    console.log(`Simulating keydown: ${event.key}`);
  } else if (event.type === "keyup") {
    console.log(`Simulating keyup: ${event.key}`);
  }
}

// Capture and send client-side events
function captureClientEvents(permissions) {
  if (permissions.mouseControl) {
    document.addEventListener("mousemove", (event) => {
      sendControlEvent({
        type: "mousemove",
        x: event.clientX,
        y: event.clientY,
      });
    });

    document.addEventListener("click", (event) => {
      sendControlEvent({
        type: "click",
        x: event.clientX,
        y: event.clientY,
      });
    });
  }

  if (permissions.keyboardControl) {
    document.addEventListener("keydown", (event) => {
      sendControlEvent({
        type: "keydown",
        key: event.key,
      });
    });

    document.addEventListener("keyup", (event) => {
      sendControlEvent({
        type: "keyup",
        key: event.key,
      });
    });
  }
}

// Send events to Firebase
function sendControlEvent(event) {
  const controlRef = ref(rtdb, `sessions/${clientCodeForControl}/controlEvents`);
  set(controlRef, event);
}

// Initialize the app
initializeHostCode();
