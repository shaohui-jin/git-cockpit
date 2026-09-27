const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitCockpitDesktop', {
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  onState: (cb) => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('desktop:state', listener);
    return () => ipcRenderer.removeListener('desktop:state', listener);
  },
  download: () => ipcRenderer.invoke('desktop:download'),
  install: () => ipcRenderer.invoke('desktop:install'),
  openRelease: () => ipcRenderer.invoke('desktop:open-release'),
  upgradeService: () => ipcRenderer.invoke('desktop:upgrade-service'),
  cancelDownload: () => ipcRenderer.invoke('desktop:cancel-download')
});
