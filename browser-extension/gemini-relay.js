import {standardChatCommand} from './standard-chat-adapter.js';
import {startWebRelay} from './web-relay.js';
startWebRelay({reader:standardChatCommand,provider:'gemini',name:'Gemini'});
