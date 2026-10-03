const {parentPort,workerData}=require('node:worker_threads');
require('./convert.cjs').render(workerData.item,workerData.plan).then(()=>parentPort.postMessage({size:workerData.item.outputSize})).catch(error=>parentPort.postMessage({error:error.message}));
