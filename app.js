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

// Generate a unique device code
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
  hostCodeDisplay.innerText = hostCode;

  const hostDoc = doc(db, "sessions", hostCode);
  await setDoc(hostDoc, { status: "available", hostCode });

  sharingRequestRef = ref(rtdb, `sessions/${hostCode}/request`);
  onValue(sharingRequestRef, (snapshot) => {
    if (snapshot.exists()) {
      showPermissionDialog(snapshot.val());
    }
  });

  listenForRemoteControl();
}

// Show permission dialog
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

    permissionDialog.hide();
    set(ref(rtdb, `sessions/${hostCode}/status`), { status: "accepted", permissions });
    startScreenSharing();
  };

  document.getElementById("reject-request").onclick = async () => {
    permissionDialog.hide();
    set(ref(rtdb, `sessions/${hostCode}/status`), "rejected");
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

  const requestRef = ref(rtdb, `sessions/${clientCode}/request`);
  await set(requestRef, hostCode);

  const statusRef = ref(rtdb, `sessions/${clientCode}/status`);
  onValue(statusRef, (snapshot) => {
    if (snapshot.exists()) {
      const statusData = snapshot.val();
      if (statusData.status === "accepted") {
        clientCodeForControl = clientCode;
        startReceivingStream(clientCode);
        captureClientEvents(statusData.permissions);
      } else if (statusData.status === "rejected") {
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

// Simulate input events on host screen
function simulateEvent(event) {
  const rect = remoteScreen.getBoundingClientRect();
  if (event.type === "mousemove") {
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: event.x * rect.width + rect.left,
      clientY: event.y * rect.height + rect.top
    });
    remoteScreen.dispatchEvent(mouseEvent);
  } else if (event.type === "click") {
    const clickEvent = new MouseEvent("click", {
      clientX: event.x * rect.width + rect.left,
      clientY: event.y * rect.height + rect.top
    });
    remoteScreen.dispatchEvent(clickEvent);
  } else if (event.type === "keypress") {
    const keyEvent = new KeyboardEvent("keypress", { key: event.key });
    document.dispatchEvent(keyEvent);
  }
}

// Capture client events and send them to Firebase
function captureClientEvents(permissions) {
  if (permissions.mouseControl) {
    document.addEventListener("mousemove", (event) => {
      sendControlEvent({
        type: "mousemove",
        x: event.clientX / window.innerWidth,
        y: event.clientY / window.innerHeight
      });
    });

    document.addEventListener("click", (event) => {
      sendControlEvent({
        type: "click",
        x: event.clientX / window.innerWidth,
        y: event.clientY / window.innerHeight
      });
    });
  }

  if (permissions.keyboardControl) {
    document.addEventListener("keypress", (event) => {
      sendControlEvent({ type: "keypress", key: event.key });
    });
  }
}

// Send control events to Firebase
function sendControlEvent(event) {
  const controlRef = ref(rtdb, `sessions/${clientCodeForControl}/controlEvents`);
  set(controlRef, event);
}

// Initialize the app
initializeHostCode();
