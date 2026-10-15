export const webProviderInfo={
 yuanbao:{name:'元宝',open:'openYuanbao',images:true,scan:true},
 doubao:{name:'豆包',open:'openDoubao',images:true,scan:true},
 grok:{name:'Grok',open:'openGrok',images:false,scan:false},
 chatgpt:{name:'ChatGPT',open:'openChatGPT',images:false,scan:false},
 gemini:{name:'Gemini',open:'openGemini',images:false,scan:false}
};
export type WebProvider=keyof typeof webProviderInfo;
export const providerByName=(name:string):WebProvider|undefined=>(Object.keys(webProviderInfo) as WebProvider[]).find(id=>webProviderInfo[id].name===name);
