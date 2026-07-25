const PATH_COMMANDS = new Map([
  ['M', 2], ['m', 2], ['L', 2], ['l', 2], ['H', 1], ['h', 1], ['V', 1], ['v', 1],
  ['C', 6], ['c', 6], ['S', 4], ['s', 4], ['Q', 4], ['q', 4], ['T', 2], ['t', 2],
  ['A', 7], ['a', 7], ['Z', 0], ['z', 0]
]);
const PATH_TOKEN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasNonBlankString = value => typeof value === 'string' && value.trim() !== '';

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
      for (let index = 0; index < argumentsForCommand.length; index += expected) {
        const radiusX = Number(argumentsForCommand[index]);
        const radiusY = Number(argumentsForCommand[index + 1]);
        const largeArcFlag = argumentsForCommand[index + 3];
        const sweepFlag = argumentsForCommand[index + 4];
        if (!Number.isFinite(radiusX) || radiusX < 0 || !Number.isFinite(radiusY) || radiusY < 0) return false;
        if ((largeArcFlag !== '0' && largeArcFlag !== '1') || (sweepFlag !== '0' && sweepFlag !== '1')) return false;
      }
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
      && point.length === 2
      && Number.isFinite(point[0])
      && Number.isFinite(point[1]));
}

export function validateLibrary(curriculum, characterDocument, audioIds) {
  const errors = [];
  if (!isRecord(curriculum)) {
    errors.push('curriculum: must be an object');
    return errors;
  }
  if (!Array.isArray(curriculum.units)) {
    errors.push('curriculum.units: must be an array');
    return errors;
  }
  if (!isRecord(characterDocument)) {
    errors.push('characters: must be an object');
    return errors;
  }

  if (characterDocument.schemaVersion !== 1) {
    errors.push('characters.schemaVersion: must equal 1');
  }

  const notice = characterDocument.modificationNotice;
  if (!isRecord(notice)) {
    errors.push('characters.modificationNotice: must be an object');
  } else {
    for (const field of ['date', 'source', 'license']) {
      if (!hasNonBlankString(notice[field])) {
        errors.push(`characters.modificationNotice.${field}: must be a non-blank string`);
      }
    }
    if (!Array.isArray(notice.changes)
      || notice.changes.length === 0
      || !notice.changes.every(hasNonBlankString)) {
      errors.push('characters.modificationNotice.changes: must be a non-empty array of non-blank strings');
    }
  }

  if (!isRecord(characterDocument.characters)) {
    errors.push('characters.characters: must be an object');
    return errors;
  }

  const lessonIds = new Set();
  const unitIds = new Set();
  const geometryByCharacter = characterDocument.characters;
  const availableAudioIds = audioIds instanceof Set ? audioIds : new Set(audioIds ?? []);

  for (const [unitIndex, unit] of curriculum.units.entries()) {
    const unitPosition = `unit ${unitIndex + 1}`;
    if (!isRecord(unit)) {
      errors.push(`${unitPosition}: must be an object`);
      continue;
    }

    const unitId = hasNonBlankString(unit.id) ? unit.id : undefined;
    if (!unitId) errors.push(`${unitPosition}: missing or blank id`);
    else if (unitIds.has(unitId)) errors.push(`duplicate unit id: ${unitId}`);
    if (unitId) unitIds.add(unitId);

    if (!Array.isArray(unit.lessons)) {
      errors.push(`${unitId ?? unitPosition}: lessons must be an array`);
      continue;
    }

    for (const [lessonIndex, lesson] of unit.lessons.entries()) {
      const lessonPosition = `lesson ${lessonIndex + 1} in ${unitId ?? unitPosition}`;
      if (!isRecord(lesson)) {
        errors.push(`${lessonPosition}: must be an object`);
        continue;
      }

      const lessonId = hasNonBlankString(lesson.id) ? lesson.id : undefined;
      if (!lessonId) errors.push(`${lessonPosition}: missing or blank id`);
      if (lessonIds.has(lessonId)) errors.push(`duplicate lesson id: ${lessonId}`);
      if (lessonId) lessonIds.add(lessonId);

      for (const group of ['recognize', 'write']) {
        if (!Array.isArray(lesson[group])) {
          errors.push(`${lessonId ?? lessonPosition}: ${group} must be an array`);
          continue;
        }

        const seenCharacters = new Set();
        for (const candidate of lesson[group]) {
          const entry = isRecord(candidate) ? candidate : {};
          const character = typeof entry.character === 'string' ? entry.character : '';
          const label = `${lessonId ?? lessonPosition} ${character || '<missing character>'}`;

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
