import {yuanbaoCommand} from './yuanbao-adapter.js';
import {startWebRelay} from './web-relay.js';
startWebRelay({reader:yuanbaoCommand,provider:'yuanbao',name:'元宝'});
