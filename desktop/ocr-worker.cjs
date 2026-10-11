const { workerData, parentPort } = require('node:worker_threads');
(async () => {
  if (workerData.bytes) {
    const recognizer = require('./ocr.cjs').createRecognizer();
    try {
      const bytes = Buffer.from(workerData.bytes);
      if (bytes.length > 12 * 1024 * 1024) throw new Error('Screenshot exceeds 12 MB.');
      parentPort.postMessage({
        result: { text: await recognizer.recognize(bytes), pages: 1, truncated: false },
      });
    } finally {
      await recognizer.close();
    }
    return;
  }
  const result = await require('./ocr.cjs').readOcr(workerData.file, workerData.size, {
    maxPages: workerData.maxPages || 10,
    progress: (progress) => parentPort.postMessage({ progress }),
  });
  parentPort.postMessage({ result });
})().catch((error) => parentPort.postMessage({ error: error.message }));
