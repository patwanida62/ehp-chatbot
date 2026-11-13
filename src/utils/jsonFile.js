const fs = require('fs');

/** Reads a JSON array from disk; a missing file is an empty list. */
function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${filePath} must contain a JSON array`);
  return data;
}

/** Writes via a temp file + rename so a crash mid-write never leaves a half-written file. */
function writeJsonAtomically(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
}

module.exports = { readJsonArray, writeJsonAtomically };
