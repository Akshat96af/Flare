function validatedWav(bytes) {
  if (
    !Array.isArray(bytes) ||
    bytes.length < 46 ||
    bytes.length > 960044 ||
    bytes.some((x) => !Number.isInteger(x) || x < 0 || x > 255)
  )
    throw new Error('Invalid voice recording.');
  const buffer = Buffer.from(bytes);
  if (
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE' ||
    buffer.toString('ascii', 12, 16) !== 'fmt ' ||
    buffer.readUInt32LE(16) !== 16 ||
    buffer.readUInt16LE(20) !== 1 ||
    buffer.readUInt16LE(22) !== 1 ||
    buffer.readUInt32LE(24) !== 16000 ||
    buffer.readUInt32LE(28) !== 32000 ||
    buffer.readUInt16LE(32) !== 2 ||
    buffer.readUInt16LE(34) !== 16 ||
    buffer.toString('ascii', 36, 40) !== 'data' ||
    buffer.readUInt32LE(40) !== buffer.length - 44 ||
    buffer.readUInt32LE(4) !== buffer.length - 8 ||
    (buffer.length - 44) % 2
  )
    throw new Error('Expected mono 16kHz PCM voice audio.');
  return buffer;
}
module.exports = { validatedWav };
