import {grokCommand} from './grok-adapter.js';
import {startWebRelay} from './web-relay.js';
startWebRelay({reader:grokCommand,provider:'grok',name:'Grok'});
