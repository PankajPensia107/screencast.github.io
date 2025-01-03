// Import necessary Firebase modules
import { db, rtdb } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.21.0/firebase-firestore.js";
import { ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/9.21.0/firebase-database.js";
import { Peer } from "https://esm.sh/peerjs@1.5.4?bundle-deps";

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
let peer;
let connections = {};

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

  // Initialize PeerJS
  peer = new Peer(hostCode, { debug: 3 });

  peer.on("open", () => {
    console.log("PeerJS initialized with code:", hostCode);
  });

  peer.on("connection", (conn) => {
    console.log(`New connection from ${conn.peer}`);
    connections[conn.peer] = conn;
    conn.on("data", (data) => handleClientData(conn.peer, data));
  });

  peer.on("call", (call) => {
    console.log("Incoming call from", call.peer);
    startScreenSharing().then((mediaStream) => {
      if (mediaStream) {
        call.answer(mediaStream);
      } else {
        console.error("No media stream to answer call");
      }
    });
  });
}

// Handle client data
function handleClientData(clientCode, data) {
  if (data.type === "permissionsRequest") {
    showPermissionDialog(clientCode, data);
  } else if (data.type === "controlEvent") {
    simulateEvent(data.event);
  }
}

// Show the permission dialog
function showPermissionDialog(clientCode, request) {
  permissionDialog.show();

  document.getElementById("accept-request").onclick = () => {
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

    connections[clientCode].send({ type: "permissionsGranted", permissions });
    console.log("Request accepted with permissions:", permissions);
    permissionDialog.hide();
  };

  document.getElementById("reject-request").onclick = () => {
    connections[clientCode].send({ type: "permissionsDenied" });
    console.log("Request rejected.");
    permissionDialog.hide();
  };
}

// Start screen sharing
async function startScreenSharing() {
  try {
    const mediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    console.log("Screen sharing started.");

    stopShareBtn.style.display = "block";
    startShareBtn.style.display = "none";

    return mediaStream;
  } catch (error) {
    console.error("Error starting screen sharing:", error);
    return null;
  }
}

// Stop screen sharing
stopShareBtn.addEventListener("click", () => {
  Object.values(connections).forEach((conn) => conn.close());
  peer.disconnect();
  console.log("Screen sharing stopped.");

  stopShareBtn.style.display = "none";
  startShareBtn.style.display = "block";
});

// Connect client
connectBtn.addEventListener("click", () => {
  const clientCode = clientCodeInput.value.trim();
  if (!clientCode) {
    alert("Please enter a valid device code.");
    return;
  }

  const conn = peer.connect(clientCode);
  conn.on("open", () => {
    console.log("Connected to host with code:", clientCode);

    conn.send({ type: "permissionsRequest" });
    conn.on("data", (data) => {
      if (data.type === "permissionsGranted") {
        console.log("Permissions granted:", data.permissions);
        startReceivingStream(clientCode, data.permissions);
      } else if (data.type === "permissionsDenied") {
        console.log("Permissions denied.");
        rejectedDialog.show();
      }
    });
  });
});

function startReceivingStream(clientCode, permissions) {
  if (!clientCode || !permissions) {
    console.error("Invalid clientCode or permissions:", clientCode, permissions);
    return;
  }

  // Only attempt to start a call if permissions allow screen sharing
  if (permissions.screenShare) {
    const call = peer.call(clientCode, undefined); // Call without sending a stream
    call.on("stream", (remoteStream) => {
      console.log("Receiving remote stream from client:", clientCode);
      const video = document.createElement("video");
      video.srcObject = remoteStream;
      video.autoplay = true;
      video.controls = false;
      remoteScreen.innerHTML = ""; // Clear existing content
      remoteScreen.appendChild(video);
    });

    call.on("error", (err) => {
      console.error("Error during PeerJS call:", err);
    });

    call.on("close", () => {
      console.log("Call with client closed.");
    });
  } else {
    console.error("Permissions do not allow screen sharing");
  }

  // Activate mouse and keyboard control if permissions allow
  captureClientEvents(permissions);
}

// Simulate input events
function simulateEvent(event) {
  if (event.type === "mousemove") {
    const simulatedEvent = new MouseEvent("mousemove", {
      clientX: event.x,
      clientY: event.y,
      bubbles: true,
      cancelable: true,
      view: window
    });
    document.dispatchEvent(simulatedEvent);
    console.log(`Simulated mousemove to (${event.x}, ${event.y})`);
  } else if (event.type === "mousedown" || event.type === "mouseup") {
    const simulatedEvent = new MouseEvent(event.type, {
      clientX: event.x,
      clientY: event.y,
      bubbles: true,
      cancelable: true,
      view: window
    });
    document.dispatchEvent(simulatedEvent);
    console.log(`Simulated ${event.type} at (${event.x}, ${event.y})`);
  }
}

// Capture and send client-side events
function captureClientEvents(permissions) {
  if (permissions.mouseControl) {
    document.addEventListener("mousemove", (event) => {
      sendControlEvent({
        type: "mousemove",
        x: event.clientX,
        y: event.clientY
      });
    });

    document.addEventListener("mousedown", (event) => {
      sendControlEvent({
        type: "mousedown",
        x: event.clientX,
        y: event.clientY
      });
    });

    document.addEventListener("mouseup", (event) => {
      sendControlEvent({
        type: "mouseup",
        x: event.clientX,
        y: event.clientY
      });
    });
  }

  if (permissions.keyboardControl) {
    document.addEventListener("keydown", (event) => {
      sendControlEvent({
        type: "keydown",
        key: event.key
      });
    });

    document.addEventListener("keyup", (event) => {
      sendControlEvent({
        type: "keyup",
        key: event.key
      });
    });
  }
}

// Send events to host
function sendControlEvent(event) {
  Object.values(connections).forEach((conn) => conn.send({ type: "controlEvent", event }));
}

// Initialize the app
initializeHostCode();
