const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['voiceArm','voiceModelStatus','voiceModelDownload','voiceModelCancel','voiceModelRemove','voiceTranscribe','voiceCancel','deleteConversation','conversationShare','copyConversation','openConversationSource','webChatHistory','webChatStatus','webChatSend','webChatCancel','webChatDisconnect','openYuanbao','openDoubao','snapshot','saveConnection','deleteConnection','testConnection','createConversation','updateConversation','send','cancel','retry','branch','saveExcerpt','deleteExcerpt','exportConversation','importConversation','importTranscript','browserBridgeInfo','copyBrowserPairing','copyText','resetBrowserBridge','openGemini','openChatGPT','openGrok','openBrowserExtensionDirectory']);
contextBridge.exposeInMainWorld('workbench', {
  call: (action, payload) => {
    if (!actions.has(action)) return Promise.reject(new Error('未知操作'));
    return ipcRenderer.invoke('workbench:call', action, payload);
  },
  subscribeImported: (callback) => {
    const listener=(_event,id)=>callback(id);
    ipcRenderer.on('workbench:browser-import',listener);
    return ()=>ipcRenderer.removeListener('workbench:browser-import',listener);
  },
  subscribe: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('workbench:update', listener);
    return () => ipcRenderer.removeListener('workbench:update', listener);
  }
});
