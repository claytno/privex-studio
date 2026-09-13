'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

async function loadUpdatePreferences(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return false;
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    return typeof value?.automaticUpdateChecks === 'boolean' ? value.automaticUpdateChecks : false;
  } catch (error) {
    // New installation defaults on. Corrupt/unreadable existing choices never silently opt in.
    return error.code === 'ENOENT';
  }
}

async function saveUpdatePreferences(file, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('Preferência de atualização inválida.');
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({automaticUpdateChecks: enabled}) + '\n', {flag: 'wx', mode: 0o600});
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, {force: true});
  }
}

module.exports = {loadUpdatePreferences, saveUpdatePreferences};
