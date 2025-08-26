
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  runScraper: (query) => ipcRenderer.send('run-scraper', query),
  cancelScraper: () => ipcRenderer.send('cancel-scraper'),
  googleAuth: () => ipcRenderer.send('google-auth'),
  sendEmails: (data) => ipcRenderer.send('send-emails', data),
  cancelEmails: () => ipcRenderer.send('cancel-emails'),
  downloadExcel: (data) => ipcRenderer.send('download-excel', data),
  
  // Database functions
  getSentEmails: () => ipcRenderer.invoke('get-sent-emails'),
  checkEmailSent: (email) => ipcRenderer.invoke('check-email-sent', email),
  deleteEmailRecord: (id) => ipcRenderer.invoke('delete-email-record', id),
  
  onScraperStatus: (callback) => ipcRenderer.on('scraper-status', callback),
  onScraperProgress: (callback) => ipcRenderer.on('scraper-progress', callback),
  onScraperResults: (callback) => ipcRenderer.on('scraper-results', callback),
  onEstimatedTime: (callback) => ipcRenderer.on('estimated-time', callback),
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', callback),
  onAuthError: (callback) => ipcRenderer.on('auth-error', callback),
  onEmailStatus: (callback) => ipcRenderer.on('email-status', callback),
  onEmailProgress: (callback) => ipcRenderer.on('email-progress', callback),
  onDownloadStatus: (callback) => ipcRenderer.on('download-status', callback),
  
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
