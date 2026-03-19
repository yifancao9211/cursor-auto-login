const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Cursor DB
  readAuth: () => ipcRenderer.invoke("cursor:readAuth"),

  // Cursor API
  fetchUsage: (token) => ipcRenderer.invoke("api:fetchUsage", token),
  fetchStripe: (token) => ipcRenderer.invoke("api:fetchStripe", token),
  fetchTeams: (token) => ipcRenderer.invoke("api:fetchTeams", token),

  // Account DB
  listAccounts: () => ipcRenderer.invoke("accounts:list"),
  listAccountsByStatus: (status) => ipcRenderer.invoke("accounts:listByStatus", status),
  upsertAccount: (account) => ipcRenderer.invoke("accounts:upsert", account),
  removeAccounts: (emails) => ipcRenderer.invoke("accounts:remove", emails),
  importTokensJson: (data) => ipcRenderer.invoke("accounts:importTokensJson", data),
  exportTokensJson: () => ipcRenderer.invoke("accounts:exportTokensJson"),
  exportFull: () => ipcRenderer.invoke("accounts:exportFull"),
  importFull: () => ipcRenderer.invoke("accounts:importFull"),
  refreshAllAccounts: () => ipcRenderer.invoke("accounts:refreshAll"),
  discoverTeam: () => ipcRenderer.invoke("accounts:discoverTeam"),

  // Token Exchange
  exchangeToken: (email) => ipcRenderer.invoke("accounts:exchangeToken", email),
  exchangeAllTokens: () => ipcRenderer.invoke("accounts:exchangeAllTokens"),

  // Switcher
  switchAccount: (account, options) => ipcRenderer.invoke("switcher:switch", account, options),
  smartSwitch: () => ipcRenderer.invoke("switcher:smartSwitch"),

  // Login
  batchLogin: (params) => ipcRenderer.invoke("login:batch", params),
  singleLogin: (params) => ipcRenderer.invoke("login:single", params),

  // Dialogs
  openFileDialog: (options) => ipcRenderer.invoke("dialog:openFile", options),
  saveFileDialog: (options) => ipcRenderer.invoke("dialog:saveFile", options),

  // Machine ID
  readCurrentMachineId: () => ipcRenderer.invoke("machineId:readCurrent"),
  resetRandomMachineId: () => ipcRenderer.invoke("machineId:resetRandom"),
  backupOriginalMachineId: () => ipcRenderer.invoke("machineId:backupOriginal"),
  restoreOriginalMachineId: () => ipcRenderer.invoke("machineId:restoreOriginal"),

  // Auto Check
  setAutoCheckInterval: (minutes) => ipcRenderer.invoke("autoCheck:setInterval", minutes),
  getAutoCheckStatus: () => ipcRenderer.invoke("autoCheck:getStatus"),
  runAutoCheckNow: () => ipcRenderer.invoke("autoCheck:runNow"),
  stopAutoCheck: () => ipcRenderer.invoke("autoCheck:stop"),
  toggleAutoCheck: () => ipcRenderer.invoke("autoCheck:toggle"),

  // Events from main
  onLoginProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("login:progress", handler);
    return () => ipcRenderer.removeListener("login:progress", handler);
  },
  onRefreshProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("refresh:progress", handler);
    return () => ipcRenderer.removeListener("refresh:progress", handler);
  },
  onAutoCheckStarted: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("autoCheck:started", handler);
    return () => ipcRenderer.removeListener("autoCheck:started", handler);
  },
  onAutoCheckFinished: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("autoCheck:finished", handler);
    return () => ipcRenderer.removeListener("autoCheck:finished", handler);
  },
  onOrgNewMembers: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("org:newMembers", handler);
    return () => ipcRenderer.removeListener("org:newMembers", handler);
  },
  onExchangeProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("exchange:progress", handler);
    return () => ipcRenderer.removeListener("exchange:progress", handler);
  },
});
