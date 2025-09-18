const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pandacam', {
  // Functions to communicate with the main process
  selectSdpFile: () => ipcRenderer.invoke('select-sdp-file'),
  startWebcam: (sdpFilePath) => ipcRenderer.invoke('start-webcam', sdpFilePath),
  stopWebcam: () => ipcRenderer.invoke('stop-webcam')
}); 