const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inputDialog', {
  submit(value) {
    ipcRenderer.send('input-dialog-response', value);
  }
});
