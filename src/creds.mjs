import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';

/**
 * 자격증명 보관소. OS 키체인 기반 암호화(safeStorage)로 디스크에 저장한다.
 * 값은 절대 로그에 남기지 않는다.
 */

const DIR = path.join(process.env.PB_CONFIG_DIR || path.join(os.homedir(), '.ddalgi-tool'), 'credentials');

function fileFor(name) {
  return path.join(DIR, name + '.cred');
}

export function saveCred(name, obj) {
  fs.mkdirSync(DIR, { recursive: true });
  const json = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(json);
    fs.writeFileSync(fileFor(name), JSON.stringify({ enc: true, data: enc.toString('base64') }));
  } else {
    // 키체인을 못 쓰는 환경(리눅스 일부 등) — 평문 저장을 표시해 둔다.
    fs.writeFileSync(fileFor(name), JSON.stringify({ enc: false, data: Buffer.from(json).toString('base64') }));
  }
}

export function loadCred(name) {
  try {
    const raw = JSON.parse(fs.readFileSync(fileFor(name), 'utf-8'));
    const buf = Buffer.from(raw.data, 'base64');
    const json = raw.enc ? safeStorage.decryptString(buf) : buf.toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function hasCred(name) {
  try {
    return fs.existsSync(fileFor(name));
  } catch {
    return false;
  }
}

export function deleteCred(name) {
  try {
    fs.rmSync(fileFor(name), { force: true });
  } catch {
    /* noop */
  }
}

/**
 * 키체인을 못 쓰는 상태(예: ad-hoc 서명 패키지 앱이 키체인 접근을 거부당한 경우)에서
 * 평문(enc:false)으로 저장됐던 토큰을, 키체인이 되는 실행에서 다시 암호화한다.
 * 치유된 항목 이름 배열을 돌려준다. 앱 시작 때 1회 호출.
 */
export function reencryptPlaintextCreds() {
  if (!safeStorage.isEncryptionAvailable()) return [];
  let files = [];
  try {
    files = fs.readdirSync(DIR).filter((f) => f.endsWith('.cred'));
  } catch {
    return [];
  }
  const healed = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8'));
      if (raw.enc) continue;
      const json = Buffer.from(raw.data, 'base64').toString('utf-8');
      JSON.parse(json); // 깨진 파일이면 여기서 걸러진다
      const enc = safeStorage.encryptString(json);
      fs.writeFileSync(path.join(DIR, f), JSON.stringify({ enc: true, data: enc.toString('base64') }));
      healed.push(f.replace(/\.cred$/, ''));
    } catch {
      /* 항목 하나가 실패해도 나머지는 계속 */
    }
  }
  return healed;
}

/** 이 실행에서 키체인 기반 암호화가 가능한지 (경고 표시용) */
export function credEncryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}
