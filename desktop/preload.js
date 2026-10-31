const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("signalweb", {
  selectFolder: () => ipcRenderer.invoke("signalweb:select-folder"),
  getStartup: () => ipcRenderer.invoke("signalweb:get-startup"),
  setStartup: (enabled) => ipcRenderer.invoke("signalweb:set-startup", enabled),
});
