const PATH_COMMANDS = new Map([
  ['M', 2], ['m', 2], ['L', 2], ['l', 2], ['H', 1], ['h', 1], ['V', 1], ['v', 1],
  ['C', 6], ['c', 6], ['S', 4], ['s', 4], ['Q', 4], ['q', 4], ['T', 2], ['t', 2],
  ['A', 7], ['a', 7], ['Z', 0], ['z', 0]
]);
const PATH_TOKEN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

const asArray = value => Array.isArray(value) ? value : [];
const asRecord = value => value && typeof value === 'object' ? value : {};

function isValidPath(path) {
  if (typeof path !== 'string' || path.trim() === '') return false;

  const tokens = path.match(PATH_TOKEN) ?? [];
  if (tokens.length === 0 || !/^[Mm]$/.test(tokens[0])) return false;
  if (path.replace(PATH_TOKEN, '').replace(/[\s,]/g, '') !== '') return false;

  let command;
  let argumentsForCommand = [];

  const argumentsAreValid = () => {
    const expected = PATH_COMMANDS.get(command);
    if (expected === undefined) return false;
    if (expected === 0) return argumentsForCommand.length === 0;
    if (argumentsForCommand.length < expected || argumentsForCommand.length % expected !== 0) return false;

    if (command === 'A' || command === 'a') {
      return argumentsForCommand.every((argument, index) => {
        const isArcFlag = index % expected === 3 || index % expected === 4;
        return !isArcFlag || argument === '0' || argument === '1';
      });
    }

    return true;
  };

  for (const token of tokens) {
    if (/^[a-zA-Z]$/.test(token)) {
      if (command && !argumentsAreValid()) return false;
      if (!PATH_COMMANDS.has(token)) return false;
      command = token;
      argumentsForCommand = [];
      continue;
    }

    if (!command || !Number.isFinite(Number(token))) return false;
    argumentsForCommand.push(token);
  }

  return Boolean(command) && argumentsAreValid();
}

function hasValidMedianPoints(median) {
  return Array.isArray(median)
    && median.length >= 2
    && median.every(point => Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(point[0])
      && Number.isFinite(point[1]));
}

export function validateLibrary(curriculum, characters, audioIds) {
  const errors = [];
  const lessonIds = new Set();
  const geometryByCharacter = asRecord(characters);
  const availableAudioIds = audioIds instanceof Set ? audioIds : new Set(audioIds ?? []);

  for (const unit of asArray(asRecord(curriculum).units)) {
    for (const lesson of asArray(asRecord(unit).lessons)) {
      const lessonRecord = asRecord(lesson);
      const lessonId = lessonRecord.id ?? '<missing lesson id>';
      if (lessonIds.has(lessonId)) errors.push(`duplicate lesson id: ${lessonId}`);
      lessonIds.add(lessonId);

      for (const group of ['recognize', 'write']) {
        const seenCharacters = new Set();
        for (const candidate of asArray(lessonRecord[group])) {
          const entry = asRecord(candidate);
          const character = typeof entry.character === 'string' ? entry.character : '';
          const label = `${lessonId} ${character || '<missing character>'}`;

          if (Array.from(character).length !== 1) errors.push(`${label}: character must be one code point`);
          if (seenCharacters.has(character)) errors.push(`${label}: duplicate in ${group}`);
          seenCharacters.add(character);

          if (typeof entry.pinyin !== 'string' || entry.pinyin.trim() === '') {
            errors.push(`${label}: missing or blank pinyin`);
          } else if (entry.pinyin !== entry.pinyin.normalize('NFC')) {
            errors.push(`${label}: pinyin must be NFC-normalized pinyin`);
          }

          if (typeof entry.audio !== 'string' || entry.audio.trim() === '' || !availableAudioIds.has(entry.audio)) {
            errors.push(`${label}: missing audio ${entry.audio ?? '<missing audio id>'}`);
          }

          const geometry = geometryByCharacter[character];
          if (!geometry || typeof geometry !== 'object') {
            errors.push(`${label}: missing geometry`);
            continue;
          }

          const hasStrokes = Array.isArray(geometry.strokes);
          const hasMedians = Array.isArray(geometry.medians);
          const strokes = hasStrokes ? geometry.strokes : [];
          const medians = hasMedians ? geometry.medians : [];
          if (!hasStrokes) errors.push(`${label}: strokes must be an array`);
          if (!hasMedians) errors.push(`${label}: medians must be an array`);
          if (!Number.isInteger(geometry.strokeCount) || geometry.strokeCount <= 0) {
            errors.push(`${label}: strokeCount must be a positive integer`);
          }
          if (geometry.strokeCount !== strokes.length || geometry.strokeCount !== medians.length) {
            errors.push(`${label}: strokeCount does not match strokes and medians`);
          }

          strokes.forEach((stroke, index) => {
            if (!isValidPath(stroke)) errors.push(`${label}: malformed stroke ${index + 1} path`);
          });
          medians.forEach((median, index) => {
            if (!hasValidMedianPoints(median)) {
              errors.push(`${label}: median ${index + 1} must contain at least two numeric coordinate points`);
            }
          });
        }
      }
    }
  }

  return errors;
}
