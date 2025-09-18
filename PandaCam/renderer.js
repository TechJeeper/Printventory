// DOM Elements
const sdpPathInput = document.getElementById('sdp-path');
const browseBtn = document.getElementById('browse-btn');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusCircle = document.getElementById('status-circle');
const statusText = document.getElementById('status-text');
const messageBox = document.getElementById('message-box');

// Variables
let isWebcamRunning = false;
let selectedSdpPath = null;

// Functions
function showMessage(message, type = 'info') {
  messageBox.textContent = message;
  messageBox.className = 'message-box';
  
  if (type === 'error') {
    messageBox.classList.add('error');
  } else if (type === 'success') {
    messageBox.classList.add('success');
  }
  
  messageBox.classList.remove('hidden');
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    messageBox.classList.add('hidden');
  }, 5000);
}

function updateUIState() {
  if (isWebcamRunning) {
    statusCircle.classList.add('active');
    statusText.textContent = 'Running';
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } else {
    statusCircle.classList.remove('active');
    statusText.textContent = 'Not Running';
    startBtn.disabled = !selectedSdpPath;
    stopBtn.disabled = true;
  }
}

// Event Listeners
browseBtn.addEventListener('click', async () => {
  try {
    const filePath = await window.pandacam.selectSdpFile();
    
    if (filePath) {
      selectedSdpPath = filePath;
      sdpPathInput.value = filePath;
      updateUIState();
    }
  } catch (error) {
    showMessage(`Error selecting file: ${error.message}`, 'error');
  }
});

startBtn.addEventListener('click', async () => {
  try {
    const result = await window.pandacam.startWebcam(selectedSdpPath);
    
    if (result.success) {
      isWebcamRunning = true;
      showMessage(result.message, 'success');
    } else {
      showMessage(result.message, 'error');
    }
    
    updateUIState();
  } catch (error) {
    showMessage(`Error starting webcam: ${error.message}`, 'error');
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    const result = await window.pandacam.stopWebcam();
    
    if (result.success) {
      isWebcamRunning = false;
      showMessage(result.message, 'success');
    } else {
      showMessage(result.message, 'error');
    }
    
    updateUIState();
  } catch (error) {
    showMessage(`Error stopping webcam: ${error.message}`, 'error');
  }
});

// Initialize UI
updateUIState(); 