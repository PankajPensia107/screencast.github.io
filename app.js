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

// Function to generate a unique device code with numbers only
async function generateUniqueCode() {
  let code;
  let isUnique = false;

  while (!isUnique) {
    code = Math.floor(Math.random() * 1000000).toString().padStart(6, '0'); // Generate a 6-digit number
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
  hostCodeDisplay.innerText += hostCode; // Display the generated code

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

  // Start listening for remote control events
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
      allAccess: allowAllAccess.checked
    };

    if (permissions.allAccess) {
      permissions.screenShare = true;
      permissions.mouseControl = true;
      permissions.keyboardControl = true;
      permissions.fileTransfer = true;
    }

    permissionDialog.hide(); // Hide the modal when accepted
    set(ref(rtdb, `sessions/${hostCode}/status`), { status: "accepted", permissions });
    console.log("Request accepted with permissions:", permissions);
    startScreenSharing(); // Automatically start screen sharing
  };

  document.getElementById("reject-request").onclick = async () => {
    permissionDialog.hide(); // Hide the modal when rejected
    set(ref(rtdb, `sessions/${hostCode}/status`), "rejected");
    console.log("Request rejected.");
  };
}

// Start screen sharing directly after acceptance
function startScreenSharing() {
  sharingStartTime = Date.now();
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
    stopShareBtn.style.display = "block"; // Show Stop Sharing button
    startShareBtn.style.display = "none"; // Hide Start Sharing button
    connectBtn.style.display = "none";
  } catch (error) {
    console.error("Error starting screen sharing:", error);
  }
});

// Stop screen sharing
stopShareBtn.addEventListener("click", async () => {
  mediaStream.getTracks().forEach((track) => track.stop());
  await remove(ref(rtdb, `sessions/${hostCode}/stream`));

  const sharingEndTime = Date.now();
  const sharingDuration = ((sharingEndTime - sharingStartTime) / 1000).toFixed(2); // in seconds
  alert(`Screen sharing stopped. Duration: ${sharingDuration} seconds.`);

  console.log("Screen sharing stopped.");
  stopShareBtn.style.display = "none"; // Hide Stop Sharing button
  startShareBtn.style.display = "none"; // Show Start Sharing button
  connectBtn.style.display = "block";
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

// Listen for remote control events from the client
function listenForRemoteControl() {
  const controlRef = ref(rtdb, `sessions/${hostCode}/controlEvents`);
  onValue(controlRef, (snapshot) => {
    if (snapshot.exists() && allowMouseControl.checked) {
      const event = snapshot.val();
      simulateEvent(event); // Simulate the received event on the host's PC
    }
  });
}

// Simulate received input events on the host's PC
function simulateEvent(event) {
  if (event.type === "mousemove") {
    console.log(`Simulating mousemove to (${event.x}, ${event.y})`);
  } else if (event.type === "click") {
    console.log(`Simulating click at (${event.x}, ${event.y})`);
  } else if (event.type === "keypress") {
    console.log(`Simulating keypress: ${event.key}`);
  }
}

// Capture client-side events and send them to Firebase
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
    document.addEventListener("keypress", (event) => {
      sendControlEvent({
        type: "keypress",
        key: event.key,
      });
    });
  }
}

// Send captured events to Firebase
function sendControlEvent(event) {
  const controlRef = ref(rtdb, `sessions/${clientCodeForControl}/controlEvents`);
  set(controlRef, event);
}

// Initialize the app
initializeHostCode();
