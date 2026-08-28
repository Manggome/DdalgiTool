import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CONFIG_DIR = process.env.PB_CONFIG_DIR || path.join(os.homedir(), '.ddalgi-tool');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const LOG_FILE = path.join(CONFIG_DIR, 'startup.log');

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function flog(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* 로그 실패는 무시 */
  }
}

/** 작업 폴더가 쓸 수 있는 상태인지 확인. */
export function isUsableDir(p) {
  try {
    return !!p && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
