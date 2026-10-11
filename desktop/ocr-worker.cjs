const { workerData, parentPort } = require('node:worker_threads');
(async () => {
  const result = await require('./ocr.cjs').readOcr(workerData.file, workerData.size, {
    maxPages: workerData.maxPages || 10,
    progress: (progress) => parentPort.postMessage({ progress }),
  });
  parentPort.postMessage({ result });
})().catch((error) => parentPort.postMessage({ error: error.message }));
