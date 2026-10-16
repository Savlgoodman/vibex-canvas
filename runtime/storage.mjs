import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

const BASE_DIR = join(homedir(), '.vibex', 'vibex-canvas');
const DATA_FILE = join(BASE_DIR, 'data.json');
const IMAGES_DIR = join(BASE_DIR, 'images');
const AGENT_DIR = join(BASE_DIR, 'agent-records');
const AGENT_IMAGES_DIR = join(AGENT_DIR, 'images');
const AGENT_RECORDS_FILE = join(AGENT_DIR, 'records.json');

function ensureDirs() {
  for (const dir of [BASE_DIR, IMAGES_DIR, AGENT_DIR, AGENT_IMAGES_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function readData() {
  ensureDirs();
  if (!existsSync(DATA_FILE)) return { tasks: [], activeTaskId: null };
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { tasks: [], activeTaskId: null };
  }
}

function writeData(data) {
  ensureDirs();
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function readAgentRecords() {
  ensureDirs();
  if (!existsSync(AGENT_RECORDS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(AGENT_RECORDS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeAgentRecords(records) {
  ensureDirs();
  writeFileSync(AGENT_RECORDS_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

/**
 * Save a data URL image to disk.
 * @param {string} dataUrl - data:image/png;base64,...
 * @param {string} dir - target directory
 * @param {string} prefix - filename prefix
 * @param {number} index - image index for multi-image generation
 * @returns {string} absolute file path
 */
function saveImageToDisk(dataUrl, dir, prefix, index = 0) {
  ensureDirs();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const ext = detectExtension(dataUrl);
  const filename = `${prefix}-${index}${ext}`;
  const filePath = join(dir, filename);

  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('无效的图片数据');
  const buffer = Buffer.from(base64, 'base64');
  writeFileSync(filePath, buffer);
  return filePath;
}

function detectExtension(dataUrl) {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif)/);
  if (!match) return '.png';
  const mime = match[1];
  return mime === 'jpeg' || mime === 'jpg' ? '.jpg' : `.${mime}`;
}

export const storage = {
  get dataDir() { return BASE_DIR; },
  get imagesDir() { return IMAGES_DIR; },
  get agentDir() { return AGENT_DIR; },
  get agentImagesDir() { return AGENT_IMAGES_DIR; },

  readData,
  writeData,
  readAgentRecords,
  writeAgentRecords,
  saveImageToDisk,
  ensureDirs,
};
