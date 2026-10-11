export async function recordingWav(blob: Blob): Promise<number[]> {
  const decoder = new AudioContext();
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * 16000);
    if (!frames || frames > 16000 * 30) throw new Error('Keep voice recordings below 30 seconds.');
    const offline = new OfflineAudioContext(1, frames, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const audio = (await offline.startRendering()).getChannelData(0);
    const buffer = new ArrayBuffer(44 + audio.length * 2);
    const view = new DataView(buffer);
    const ascii = (offset: number, value: string) =>
      [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    ascii(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, audio.length * 2, true);
    audio.forEach((sample, i) =>
      view.setInt16(
        44 + i * 2,
        Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)),
        true,
      ),
    );
    return Array.from(new Uint8Array(buffer));
  } finally {
    await decoder.close();
  }
}
