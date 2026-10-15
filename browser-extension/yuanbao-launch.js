import {webProviders} from './web-providers.js';
export const openYuanbaoRelay=(browser,tabId)=>openWebRelay(browser,tabId,'yuanbao');
export async function openWebRelay(browser,tabId,provider){
 if(!['yuanbao','doubao','grok','chatgpt','gemini'].includes(provider))throw new Error('未知网页平台');
 if(!Number.isInteger(tabId)||tabId<0)throw new Error('请先打开'+webProviders[provider].name+'标签页');
 const url=browser.runtime.getURL(provider+'.html')+'?tabId='+tabId;
 // Reuse the same relay for this target tab; a second relay would replace its binding.
 const existing=(await browser.tabs.query({})).find(tab=>tab.url===url);
 const relay=existing?await browser.tabs.update(existing.id,{active:true}):await browser.tabs.create({url,active:true});
 if(Number.isInteger(relay.windowId)&&browser.windows?.update)await browser.windows.update(relay.windowId,{focused:true});
 return {reused:!!existing};
}
