const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set([
  'snapshot',
  'settings',
  'search',
  'open',
  'preview',
  'file-permission',
  'folder-permission',
  'document-summary',
  'file-actions',
  'file-ocr',
  'ocr-info',
  'file-ocr-cancel',
  'ocr-enhance',
  'offline-voice-info',
  'offline-voice-install',
  'offline-voice-cancel',
  'document-find',
  'result-action',
  'share-pick',
  'share-start',
  'share-status',
  'share-stop',
  'share-copy',
  'pick',
  'drives',
  'index',
  'clipboard-clear',
  'models',
  'model-catalog',
  'ai-test',
  'ai-save',
  'ai-plan',
  'ai-cancel',
  'music-resolve',
  'web-fallback',
  'tool-plan',
  'execute',
  'history',
  'undo',
  'cancel',
  'hide',
  'resize',
  'launcher-ready',
  'voice-status',
  'voice-start',
  'voice-stop',
  'voice-cancel',
  'voice-transcribe',
  'voice-recorded',
  'voice-submit',
  'local-info',
  'local-install',
  'local-pull',
  'local-cancel',
  'quit',
]);
contextBridge.exposeInMainWorld('flare', {
  call: (method, data) => {
    if (!allowed.has(method)) return Promise.reject(new Error('Unsupported command.'));
    return ipcRenderer.invoke('flare:call', method, data);
  },
  on: (event, callback) => {
    if (
      ![
        'activation',
        'shown',
        'dismiss',
        'hold',
        'voice',
        'voice-ready',
        'index',
        'operation',
        'theme',
        'model-download',
        'offline-download',
        'ocr-progress',
        'clipboard',
        'share',
        'settings',
      ].includes(event)
    )
      throw new Error('Unsupported event.');
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('flare:' + event, handler);
    return () => ipcRenderer.removeListener('flare:' + event, handler);
  },
});
