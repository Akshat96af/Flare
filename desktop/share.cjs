const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');

function addresses() {
  return [
    ...new Set(
      Object.values(os.networkInterfaces())
        .flat()
        .filter(
          (item) =>
            item &&
            item.family === 'IPv4' &&
            !item.internal &&
            /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address),
        )
        .map((item) => item.address),
    ),
  ];
}
const sameFile = (a, b) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

class QuickShare {
  constructor(onChange = () => {}, networkAddresses = addresses) {
    this.onChange = onChange;
    this.addresses = networkAddresses;
    this.selections = new Map();
    this.current = null;
    this.starting = false;
    this.revision = 0;
  }
  async select(file) {
    const resolved = path.resolve(file);
    if (/^\\\\/.test(resolved))
      throw new Error('Choose a file on this computer, not a network share.');
    const real = await fs.realpath(resolved),
      stat = await fs.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || real.toLowerCase() !== resolved.toLowerCase())
      throw new Error('Choose a regular file, not a linked location.');
    const id = randomBytes(18).toString('base64url');
    this.selections.clear();
    this.selections.set(id, { file: real, stat });
    return { id, name: path.basename(real), size: stat.size };
  }
  status() {
    const current = this.current;
    return current
      ? {
          active: true,
          name: current.name,
          size: current.stat.size,
          url: current.url,
          expiresAt: current.expiresAt,
          downloads: current.downloads,
          addresses: this.addresses(),
        }
      : { active: false, addresses: this.addresses() };
  }
  async start(id, address) {
    if (this.starting || this.current)
      throw new Error('Stop the current share before starting another.');
    const selected = this.selections.get(id);
    if (!selected) throw new Error('Choose the file again before sharing.');
    if (!this.addresses().includes(address))
      throw new Error('Connect to a private Wi-Fi or Ethernet network first.');
    this.starting = true;
    const revision = this.revision;
    try {
      const stat = await fs.lstat(selected.file);
      if (
        !stat.isFile() ||
        !sameFile(stat, selected.stat) ||
        (await fs.realpath(selected.file)) !== selected.file
      )
        throw new Error('This file changed. Choose it again.');
      if (revision !== this.revision) throw new Error('Sharing cancelled.');
      const token = randomBytes(32).toString('base64url');
      const current = {
        ...selected,
        name: path.basename(selected.file),
        expiresAt: Date.now() + 10 * 60000,
        downloads: 0,
        requests: 0,
        sockets: new Set(),
        streams: new Set(),
        url: '',
        server: null,
        timer: null,
      };
      const server = http.createServer(async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; frame-ancestors 'none'; sandbox",
        );
        if (
          this.current !== current ||
          Date.now() >= current.expiresAt ||
          req.url !== '/' + token ||
          req.headers.host !== new URL(current.url).host
        ) {
          res.writeHead(404).end();
          return;
        }
        if (!['GET', 'HEAD'].includes(req.method)) {
          res.writeHead(405, { Allow: 'GET, HEAD' }).end();
          return;
        }
        if (current.requests >= 3) {
          res.writeHead(429).end();
          return;
        }
        current.requests++;
        let handle;
        try {
          const link = await fs.lstat(current.file);
          if (
            !link.isFile() ||
            !sameFile(link, current.stat) ||
            (await fs.realpath(current.file)) !== current.file
          )
            throw new Error('Changed file');
          handle = await fs.open(current.file, 'r');
          if (!sameFile(await handle.stat(), current.stat) || this.current !== current)
            throw new Error('Changed file');
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Length', current.stat.size);
          res.setHeader(
            'Content-Disposition',
            'attachment; filename="download"; filename*=UTF-8\'\'' +
              encodeURIComponent(current.name).replace(
                /['()*]/g,
                (c) => '%' + c.charCodeAt(0).toString(16),
              ),
          );
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          const stream = handle.createReadStream({ autoClose: true });
          handle = null;
          current.streams.add(stream);
          await new Promise((resolve) => {
            const end = () => {
              stream.destroy();
              current.streams.delete(stream);
              resolve();
            };
            stream.on('error', () => res.destroy());
            res.once('close', end);
            res.once('finish', () => {
              current.downloads++;
              this.onChange(this.status());
            });
            stream.pipe(res);
          });
        } catch {
          if (!res.headersSent) res.writeHead(410).end();
          else res.destroy();
        } finally {
          await handle?.close();
          current.requests--;
        }
      });
      current.server = server;
      server.requestTimeout = 15000;
      server.headersTimeout = 10000;
      server.maxConnections = 8;
      server.on('connection', (socket) => {
        current.sockets.add(socket);
        socket.on('close', () => current.sockets.delete(socket));
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, address, resolve);
      });
      if (revision !== this.revision) {
        current.sockets.forEach((socket) => socket.destroy());
        await new Promise((resolve) => server.close(resolve));
        throw new Error('Sharing cancelled.');
      }
      current.url = `http://${address}:${server.address().port}/${token}`;
      this.current = current;
      current.timer = setTimeout(() => this.stop(), 10 * 60000);
      current.timer.unref();
      this.onChange(this.status());
      return this.status();
    } finally {
      this.starting = false;
    }
  }
  async stop() {
    this.revision++;
    const current = this.current;
    if (!current) return this.status();
    this.current = null;
    clearTimeout(current.timer);
    current.streams.forEach((stream) => stream.destroy());
    current.sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => current.server.close(resolve));
    this.onChange(this.status());
    return this.status();
  }
}
module.exports = { QuickShare, addresses };
