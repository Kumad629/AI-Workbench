import {doubaoCommand} from './doubao-adapter.js';
import {startWebRelay} from './web-relay.js';
startWebRelay({reader:doubaoCommand,provider:'doubao',name:'豆包'});
