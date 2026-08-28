import http from 'node:http';
import crypto from 'node:crypto';
import { saveCred, loadCred, deleteCred } from '../creds.mjs';
import { meteredFetch } from '../metering.mjs';

/**
 * 구글 데스크톱 앱 OAuth (루프백 방식).
 * client_secret JSON 을 가져와 두면, 로그인 시 브라우저 동의 → 127.0.0.1 콜백으로
 * 코드를 받아 refresh_token 을 키체인에 보관한다. 이후에는 자동 갱신.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
].join(' ');

/** client_secret_….json 내용을 검증해 저장한다. */
export function importClientSecret(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('JSON 파일이 아닙니다.');
  }
  const c = parsed.installed || parsed.web;
  if (!c?.client_id || !c?.client_secret) {
    throw new Error('OAuth 클라이언트 JSON 형식이 아닙니다 (installed.client_id 없음). 데스크톱 앱 유형으로 만든 클라이언트의 JSON인지 확인하세요.');
  }
  saveCred('google_client', { client_id: c.client_id, client_secret: c.client_secret });
  return { ok: true };
}

export function hasGoogleClient() {
  return !!loadCred('google_client');
}

export function googleLogout() {
  deleteCred('google_tokens');
}

/** 브라우저 동의 → 토큰 교환. openExternal 은 main 의 shell.openExternal. */
export function googleLogin(openExternal, timeoutMs = 180000) {
  const client = loadCred('google_client');
  if (!client) throw new Error('먼저 클라이언트 JSON을 가져오세요.');

  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(16).toString('hex');
    const server = http.createServer();
    const finish = (fn, arg) => {
      try {
        server.close();
      } catch {
        /* noop */
      }
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error('로그인 대기 시간(3분)이 지났습니다. 다시 시도하세요.')), timeoutMs);

    server.on('request', async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const deny = (msg) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<meta charset="utf-8"><body style="font-family:sans-serif"><h3>${msg}</h3><p>이 창을 닫고 딸기툴로 돌아가세요.</p></body>`);
      };
      if (u.searchParams.get('state') !== state) {
        deny('잘못된 요청입니다 (state 불일치).');
        return finish(reject, new Error('state 불일치 — 다시 시도하세요.'));
      }
      const code = u.searchParams.get('code');
      if (!code) {
        deny('로그인이 취소되었습니다.');
        return finish(reject, new Error(u.searchParams.get('error') || '로그인이 취소되었습니다.'));
      }
      try {
        const port = server.address().port;
        const body = new URLSearchParams({
          code,
          client_id: client.client_id,
          client_secret: client.client_secret,
          redirect_uri: `http://127.0.0.1:${port}/callback`,
          grant_type: 'authorization_code',
        });
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
        const tok = await r.json();
        if (!r.ok || !tok.access_token) throw new Error(tok.error_description || tok.error || '토큰 교환 실패');
        if (!tok.refresh_token) {
          const prev = loadCred('google_tokens');
          if (!prev?.refresh_token) throw new Error('refresh_token 을 받지 못했습니다. 구글 계정 보안 페이지에서 딸기툴 접근 권한을 지우고 다시 로그인하세요.');
          tok.refresh_token = prev.refresh_token;
        }
        saveCred('google_tokens', {
          refresh_token: tok.refresh_token,
          access_token: tok.access_token,
          expiry: Date.now() + (tok.expires_in || 3600) * 1000,
        });
        deny('✅ 딸기툴 구글 연결 완료');
        finish(resolve, { ok: true });
      } catch (e) {
        deny('토큰 교환에 실패했습니다: ' + e.message);
        finish(reject, e);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();
      openExternal(auth.toString());
    });
    server.on('error', (e) => finish(reject, e));
  });
}

/** 유효한 access_token 을 돌려준다 (만료 임박 시 자동 갱신). */
export async function googleAccessToken() {
  const tok = loadCred('google_tokens');
  if (!tok?.refresh_token) throw new Error('구글이 연결되어 있지 않습니다. 사이드바의 [🔗 연동 설정]에서 로그인하세요.');
  if (tok.access_token && tok.expiry > Date.now() + 60000) return tok.access_token;

  const client = loadCred('google_client');
  const body = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: tok.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const nt = await r.json();
  if (!r.ok || !nt.access_token) {
    throw new Error('구글 토큰 갱신 실패 — 연동 설정에서 다시 로그인하세요. (' + (nt.error || r.status) + ')');
  }
  saveCred('google_tokens', {
    refresh_token: tok.refresh_token,
    access_token: nt.access_token,
    expiry: Date.now() + (nt.expires_in || 3600) * 1000,
  });
  return nt.access_token;
}

export function googleConnected() {
  return !!loadCred('google_tokens')?.refresh_token;
}

/** 연결 확인 겸 사용자 표시 — Drive about 로 이메일을 가져온다. */
export async function googleWhoAmI() {
  const token = await googleAccessToken();
  const r = await meteredFetch('google', 'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', {
    headers: { authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || '확인 실패');
  return { name: d.user?.displayName, email: d.user?.emailAddress };
}
