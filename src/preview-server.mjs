import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

/**
 * 작업 폴더를 127.0.0.1 에만 서비스하는 최소 정적 서버.
 * file:// 로 열면 fetch/XHR 이 막히는 프로토타입도 그대로 돌아가게 하려고 둔다.
 */
export class PreviewServer {
  server = null;
  root = null;
  port = 0;

  /** 작업 폴더를 지정하고 서버를 띄운다(이미 떠 있으면 루트만 교체). */
  async serve(root) {
    this.root = fs.realpathSync(root);
    if (this.server) return this.port;

    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      // 포트 0 = OS가 빈 포트를 골라 준다. 루프백에만 바인딩한다.
      this.server.listen(0, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }

  urlFor(relPath) {
    if (!this.port) return '';
    const enc = String(relPath)
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    return `http://127.0.0.1:${this.port}/${enc}`;
  }

  handle(req, res) {
    // 루프백 외 접근 차단(같은 기기 안에서만 쓰는 서버).
    const remote = req.socket.remoteAddress || '';
    if (!remote.includes('127.0.0.1') && remote !== '::1' && !remote.endsWith(':127.0.0.1')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('method not allowed');
      return;
    }

    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }

    const target = path.join(this.root, rel);
    // 심볼릭 링크·상위 경로(..)로 작업 폴더 밖을 읽지 못하게 실제 경로로 검사한다.
    let real;
    try {
      real = fs.realpathSync(target);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    if (real !== this.root && !real.startsWith(this.root + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    let st;
    try {
      st = fs.statSync(real);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    if (st.isDirectory()) {
      const idx = path.join(real, 'index.html');
      if (fs.existsSync(idx)) {
        real = idx;
        st = fs.statSync(real);
      } else {
        res.writeHead(404).end('not found');
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(real).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      // 미리보기는 항상 최신이어야 하므로 캐시를 끈다.
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(real)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  close() {
    try {
      this.server?.close();
    } catch {
      /* noop */
    }
    this.server = null;
    this.port = 0;
  }
}
