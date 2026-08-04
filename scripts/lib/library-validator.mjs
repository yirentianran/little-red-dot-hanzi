const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateLibrary(catalog, characterDocument, audioIds) {
  const errors = [];
  if (!isRecord(catalog) || catalog.schemaVersion !== 2) return ['catalog.schemaVersion: must equal 2'];
  if (!Array.isArray(catalog.stages)) return ['catalog.stages: must be an array'];
  if (!Array.isArray(catalog.sets)) return ['catalog.sets: must be an array'];
  if (!isRecord(characterDocument?.characters)) return ['characters.characters: must be an object'];
  const availableAudio = audioIds instanceof Set ? audioIds : new Set(audioIds || []);
  const stageIds = new Set();
  const referencedSetIds = new Set();
  for (const [stageIndex, stage] of catalog.stages.entries()) {
    const stagePath = `stages[${stageIndex}]`;
    if (!isRecord(stage) || typeof stage.id !== 'string') { errors.push(`${stagePath}: invalid stage`); continue; }
    if (stageIds.has(stage.id)) errors.push(`${stagePath}.id: duplicate ${stage.id}`);
    stageIds.add(stage.id);
    if (!Array.isArray(stage.setIds) || stage.setIds.length === 0) {
      errors.push(`${stagePath}.setIds: must be a non-empty array`); continue;
    }
    for (const setId of stage.setIds) {
      if (referencedSetIds.has(setId)) errors.push(`${stagePath}.setIds: duplicate reference ${setId}`);
      referencedSetIds.add(setId);
    }
  }

  const setIds = new Set();
  const characters = new Set();
  let entryCount = 0;
  for (const [setIndex, set] of catalog.sets.entries()) {
    const setPath = `sets[${setIndex}]`;
    if (!isRecord(set) || typeof set.id !== 'string') { errors.push(`${setPath}: invalid set`); continue; }
    if (setIds.has(set.id)) errors.push(`${setPath}.id: duplicate ${set.id}`);
    setIds.add(set.id);
    if (!Array.isArray(set.entries)) { errors.push(`${setPath}.entries: must be an array`); continue; }
    const local = new Set();
    for (const [entryIndex, entry] of set.entries.entries()) {
      entryCount += 1;
      const label = `${setPath}.entries[${entryIndex}]`;
      if (!isRecord(entry) || typeof entry.character !== 'string' || Array.from(entry.character).length !== 1) {
        errors.push(`${label}.character: must be one code point`); continue;
      }
      if (local.has(entry.character)) errors.push(`${label}.character: duplicate in set`);
      if (characters.has(entry.character)) errors.push(`${label}.character: duplicate in catalog`);
      local.add(entry.character); characters.add(entry.character);
      if (typeof entry.pinyin !== 'string' || !entry.pinyin.trim()) errors.push(`${label}.pinyin: missing`);
      if (!Array.isArray(entry.words) || entry.words.length !== 2
        || entry.words.some(word => typeof word !== 'string' || !word.includes(entry.character))) {
        errors.push(`${label}.words: must contain two words using the character`);
      }
      if (!availableAudio.has(entry.audio)) errors.push(`${label}.audio: missing ${entry.audio}`);
      const geometry = characterDocument.characters[entry.character];
      if (!isRecord(geometry)) errors.push(`${label}: missing geometry`);
      else if (!Number.isInteger(geometry.strokeCount) || geometry.strokeCount !== geometry.strokes?.length
        || geometry.strokeCount !== geometry.medians?.length) errors.push(`${label}: malformed geometry`);
    }
  }
  for (const setId of setIds) if (!referencedSetIds.has(setId)) errors.push(`sets: unreferenced set ${setId}`);
  for (const setId of referencedSetIds) if (!setIds.has(setId)) errors.push(`stages: missing set ${setId}`);
  const extraGeometry = Object.keys(characterDocument.characters).filter(character => !characters.has(character));
  if (extraGeometry.length) errors.push(`characters: ${extraGeometry.length} unreferenced entries`);
  if (entryCount === 0) errors.push('catalog: must contain entries');
  return errors;
}
