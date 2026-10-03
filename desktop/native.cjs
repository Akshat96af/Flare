const { spawn } = require('node:child_process');
const path = require('node:path');
const scriptPath=name=>path.join(__dirname.replace(/app\.asar([\\/])/,'app.asar.unpacked$1'),name);
let user32, attributes,moveFile,lastError;
function win32() {
  if (process.platform !== 'win32') return null;
  if (!user32) {
    const koffi = require('koffi'),
      lib = koffi.load('user32.dll'),
      rect = koffi.struct('FlareRect', {
        left: 'long',
        top: 'long',
        right: 'long',
        bottom: 'long',
      });
    user32 = {
      key: lib.func('short __stdcall GetAsyncKeyState(int key)'),
      foreground: lib.func('void* __stdcall GetForegroundWindow()'),
      rect: lib.func('GetWindowRect', 'int', ['void*', koffi.out(koffi.pointer(rect))]),
    };
  }
  return user32;
}
function chordHeld(shortcut) {
  const native = win32();
  if (!native) return false;
  const parts = shortcut.split('+'),
    codes = {
      Alt: 0x12,
      Ctrl: 0x11,
      Control: 0x11,
      Shift: 0x10,
      Super: 0x5b,
      Win: 0x5b,
      Space: 0x20,
    };
  return parts.every((part) => {
    const code = codes[part] || (part.length === 1 ? part.toUpperCase().charCodeAt(0) : 0);
    return code > 0 && (native.key(code) & 0x8000) !== 0;
  });
}
function foregroundBounds() {
  try {
    const native = win32(),
      r = {};
    if (native && native.rect(native.foreground(), r))
      return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  } catch {}
  return null;
}
function fileAttributes(file) {
  if (process.platform !== 'win32') return 0;
  attributes ||= require('koffi')
    .load('kernel32.dll')
    .func('uint32 __stdcall GetFileAttributesW(str16 file)');
  return attributes(file);
}
function unsafeFile(file) {
  const flags = fileAttributes(file);
  return flags === 0xffffffff || (flags & (0x2 | 0x4 | 0x400 | 0x1000 | 0x400000)) !== 0;
}
function moveNative(from,to){
  if(process.platform!=='win32')return false;
  if(!moveFile){const lib=require('koffi').load('kernel32.dll');moveFile=lib.func('int __stdcall MoveFileExW(str16 from,str16 to,uint32 flags)');lastError=lib.func('uint32 __stdcall GetLastError()');}
  if(moveFile(from,to,8))return true;
  const code=lastError();if(code===17)return false;
  const error=new Error(code===80||code===183?'Destination already exists. Nothing was overwritten.':'Windows could not move this file (code '+code+').');error.code=code===80||code===183?'EEXIST':'EPERM';throw error;
}
function powershell(command, data = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath('windows.ps1'),
        command,
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '',
      err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Windows command timed out.'));
    }, timeout);
    child.stdout.on('data', (x) => (out += x));
    child.stderr.on('data', (x) => (err += x));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error(err.trim().slice(0, 300) || 'Windows command unavailable.'));
      try {
        resolve(JSON.parse(out.trim() || 'null'));
      } catch {
        reject(new Error('Windows returned an invalid response.'));
      }
    });
    child.stdin.end(JSON.stringify(data));
  });
}
module.exports = { chordHeld, foregroundBounds, powershell, fileAttributes, unsafeFile,scriptPath,moveNative };
