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
