const { workerData, parentPort } = require('node:worker_threads');
const { createStore } = require('./store.cjs');
const { Search } = require('./search.cjs');
const store = createStore(workerData.directory),
  search = new Search(store, () => {});
parentPort.on('message', (message) => {
  try {
    parentPort.postMessage({ id: message.id, results: search.query(message.query, message.kind) });
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: error.message });
  }
});
