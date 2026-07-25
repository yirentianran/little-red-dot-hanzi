import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const curriculum = JSON.parse(readFileSync(new URL('../data/curriculum.json', import.meta.url), 'utf8'));

const expectedTitles = [
  '观潮', '走月亮', '现代诗二首', '繁星',
  '一个豆荚里的五粒豆', '夜间飞行的秘密', '呼风唤雨的世纪', '蝴蝶的家',
  '古诗三首', '爬山虎的脚', '蟋蟀的住宅',
  '盘古开天地', '精卫填海', '普罗米修斯', '女娲补天',
  '麻雀', '爬天都峰',
  '牛和鹅', '一只窝囊的大老虎', '陀螺',
  '古诗三首', '为中华之崛起而读书', '梅兰芳蓄须', '延安，我把你追寻',
  '王戎不取道旁李', '西门豹治邺', '故事二则'
];

const expectedUnitSections = [
  ['lesson-1', 'lesson-2', 'lesson-3', 'lesson-4'],
  ['lesson-5', 'lesson-6', 'lesson-7', 'lesson-8', 'garden-2'],
  ['lesson-9', 'lesson-10', 'lesson-11'],
  ['lesson-12', 'lesson-13', 'lesson-14', 'lesson-15', 'garden-4'],
  ['lesson-16', 'lesson-17'],
  ['lesson-18', 'lesson-19', 'lesson-20', 'garden-6'],
  ['lesson-21', 'lesson-22', 'lesson-23', 'lesson-24'],
  ['lesson-25', 'lesson-26', 'lesson-27', 'garden-8']
];

const expectedRecognizeCharacters = {
  'lesson-1': '盐薄屹昂顿鼎沸贯浩崩震霎余',
  'lesson-2': '鹅卵俗跃穗镀埂烁',
  'lesson-3': '巢苇罗眠霸占',
  'lesson-4': '昧坠怀',
  'lesson-5': '豌按僵预揭苔囚框溢',
  'lesson-6': '蝙蝠即锐系铛蝇证障碍荧屏',
  'lesson-7': '唤获赖潜亿索奥舶质哲兰',
  'lesson-8': '避撼喧雀檐',
  'garden-2': '驻钞培赌媒氛账贺樟杠狡猾',
  'lesson-9': '暮瑟缘降骚逊输',
  'lesson-10': '均柄蜗曲萎',
  'lesson-11': '宅隐毫慎址良掘搜倾骤置抛',
  'lesson-12': '劈缓浊丈隆肢躯液',
  'lesson-13': '帝少曰溺返',
  'lesson-14': '斯惨盗驰还恕坚押锁遭恶脏愤',
  'lesson-15': '措混项熄浆塌杀颂绩',
  'garden-4': '圃卉蕾蕊玫茉莉牡丹棠',
  'lesson-16': '嗅奈拯嘶哑庞',
  'lesson-17': '级链攀相辫呵',
  'lesson-18': '谓拳捶顽吁襟膊瓶怖凭欺掐',
  'lesson-19': '囊露羡角殷撇啊霉亏哄拙唉砸',
  'lesson-20': '钉兵败恨帅彻溃誉丑豪',
  'garden-6': '韭芥芹蒜椒藕薯芋',
  'lesson-21': '塞秦征将杰',
  'lesson-22': '崛范魏晰效淮惑惩斥',
  'lesson-23': '蓄迫租纠缠邀扰拒签订宁要妄',
  'lesson-24': '延昔茅炕旦媚',
  'lesson-25': '戎诸竞唯',
  'lesson-26': '豹娶媳巫绅旱徒吊磕凿溉',
  'lesson-27': '拜侯肤扎剂髓纪标',
  'garden-8': '纲授揍键谱锈沫砖矿综氧俱'
};

const expectedWriteCharacters = {
  'lesson-1': '潮据堤阔盼滚顿逐渐堵犹崩震霎余',
  'lesson-2': '淘牵鹅卵坑洼填庄稼俗跃葡萄稻熟',
  'lesson-5': '豌按舒适暗恐僵硬枪耐探愉曾沟',
  'lesson-6': '蚊即科横竖绳系蝇证研究达驾驶',
  'lesson-7': '唤纪技改程超亿核奥益联质哲任善',
  'lesson-9': '暮吟题侧峰庐缘降费须逊输',
  'lesson-10': '虎操占嫩顺均叠隙茎柄萎瞧固',
  'lesson-11': '宅临慎选择址良穴厅卧专卫较',
  'lesson-12': '睁翻斧劈缓浊丈撑竭累血液奔茂滋',
  'lesson-13': '帝曰溺返衔',
  'lesson-14': '悲惨兽佩坚违抗环锁既狠著愤获',
  'lesson-16': '嗅呆奈巢齿躯掩护幼搏庞量愣',
  'lesson-17': '级链颤攀猴念辫呵',
  'lesson-18': '摸甚跪捶绕顽脖脱概惹昏握摔凭掐',
  'lesson-19': '殷段俩练套裤逃亏挖撤堂砸锅',
  'lesson-20': '否旋况兵败椅仍尤恨帅预溃品丑豪',
  'lesson-21': '塞秦征词催醉杰亦雄项',
  'lesson-22': '肃晰振胸怀赞效凡顾训斥',
  'lesson-25': '戎尝诸竞唯',
  'lesson-26': '豹派娶媳妇淹逼浮旱徒扔饶骗灌溉'
};

const expectedPolyphonicReviews = [
  ['lesson-1', '薄', 'bó'],
  ['lesson-6', '系', 'jì'],
  ['lesson-8', '雀', 'qiǎo'],
  ['lesson-9', '降', 'xiáng'],
  ['lesson-10', '曲', 'qū'],
  ['lesson-13', '少', 'shào'],
  ['lesson-14', '还', 'huán'],
  ['lesson-14', '脏', 'zàng'],
  ['lesson-17', '相', 'xiàng'],
  ['lesson-18', '吁', 'yū'],
  ['lesson-19', '露', 'lòu'],
  ['lesson-19', '角', 'jué'],
  ['lesson-19', '啊', 'ā'],
  ['lesson-19', '哄', 'hōng'],
  ['lesson-19', '唉', 'āi'],
  ['lesson-20', '钉', 'dīng'],
  ['lesson-21', '将', 'jiàng'],
  ['lesson-23', '宁', 'nìng'],
  ['lesson-23', '要', 'yāo'],
  ['lesson-27', '扎', 'zhā'],
  ['lesson-27', '纪', 'jǐ']
];

const pinyinToneMarks = new Map([
  ['\u0304', '1'],
  ['\u0301', '2'],
  ['\u030c', '3'],
  ['\u0300', '4']
]);

function pinyinToAudioId(pinyin) {
  let tone = '5';
  let reading = '';

  for (const symbol of pinyin.toLowerCase().normalize('NFD')) {
    if (symbol === '\u0308') {
      if (reading.endsWith('u')) reading = `${reading.slice(0, -1)}v`;
      continue;
    }
    if (pinyinToneMarks.has(symbol)) {
      tone = pinyinToneMarks.get(symbol);
      continue;
    }
    reading += symbol;
  }

  return `${reading}${tone}`;
}

const sections = () => curriculum.units.flatMap(unit => unit.lessons);
const lessons = () => sections().filter(section => section.kind === 'lesson');

function entry(sectionId, group, character) {
  const section = sections().find(candidate => candidate.id === sectionId);
  assert.ok(section, `missing ${sectionId}`);
  const match = section[group].find(candidate => candidate.character === character);
  assert.ok(match, `missing ${sectionId}.${group} ${character}`);
  return match;
}

function expectedAuditRows() {
  return sections().flatMap(section => ['recognize', 'write'].flatMap(group => section[group].map(item => ({
    section: section.id,
    group,
    character: item.character,
    pinyin: item.pinyin,
    audio: item.audio,
    counting: group === 'write' ? 'write' : item.counted === false ? 'review' : 'new'
  }))));
}

function parseReadingsAudit(content) {
  const rows = [];
  let headerSeen = false;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line === '' || line.startsWith('#')) continue;
    if (!headerSeen) {
      assert.equal(line, 'section\tgroup\tcharacter\tpinyin\taudio\tcounting', 'TSV header');
      headerSeen = true;
      continue;
    }

    const values = line.split('\t');
    assert.equal(values.length, 6, `docs/curriculum-readings.tsv:${index + 1}`);
    rows.push({
      section: values[0],
      group: values[1],
      character: values[2],
      pinyin: values[3],
      audio: values[4],
      counting: values[5],
      lineNumber: index + 1
    });
  }

  assert.equal(headerSeen, true, 'TSV header missing');
  return rows;
}

function parseAuditSectionTable(content) {
  return content.split(/\r?\n/)
    .filter(line => /^\| [^|]+ \| (?:lesson|garden)-\d+ \|/.test(line))
    .map((line, index) => {
      const [unit, id, title, recognizeDisplayed, recognizeCounted, write, reviewed] = line
        .slice(1, -1)
        .split('|')
        .map(value => value.trim());
      return {
        unit,
        id,
        title,
        recognizeDisplayed: Number(recognizeDisplayed),
        recognizeCounted: Number(recognizeCounted),
        write: Number(write),
        reviewed,
        rowNumber: index + 1
      };
    });
}

test('identifies the approved 2019 PEP textbook edition', () => {
  assert.equal(curriculum.schemaVersion, 1);
  assert.deepEqual(curriculum.book, {
    publisher: '人民教育出版社',
    approvalYear: 2019,
    grade: 4,
    volume: '上册'
  });
});

test('contains all eight units and 27 numbered lessons in textbook order', () => {
  assert.equal(curriculum.units.length, 8);
  assert.deepEqual(lessons().map(lesson => lesson.title), expectedTitles);
  assert.deepEqual(lessons().map(lesson => lesson.number), Array.from({ length: 27 }, (_, index) => index + 1));
});

test('maps lessons and language gardens to their exact units', () => {
  assert.deepEqual(
    curriculum.units.map(unit => unit.lessons.map(section => section.id)),
    expectedUnitSections
  );
});

test('matches every ordered appendix character sequence exactly', () => {
  for (const section of sections()) {
    assert.equal(
      section.recognize.map(item => item.character).join(''),
      expectedRecognizeCharacters[section.id],
      `${section.id}.recognize`
    );
    assert.equal(
      section.write.map(item => item.character).join(''),
      expectedWriteCharacters[section.id] ?? '',
      `${section.id}.write`
    );
  }
});

test('includes the four language-garden literacy groups without write entries', () => {
  const gardens = sections().filter(section => section.kind === 'garden');
  assert.deepEqual(gardens.map(section => section.id), ['garden-2', 'garden-4', 'garden-6', 'garden-8']);
  assert.deepEqual(gardens.map(section => section.title), ['语文园地二', '语文园地四', '语文园地六', '语文园地八']);
  for (const garden of gardens) {
    assert.equal(Object.hasOwn(garden, 'number'), false, `${garden.id}.number`);
    assert.deepEqual(garden.write, [], `${garden.id}.write`);
  }
});

test('preserves all displayed readings while matching the two appendix totals', () => {
  const recognize = sections().flatMap(section => section.recognize);
  const polyphonicReviews = recognize.filter(item => item.counted === false);

  assert.equal(recognize.length, 271);
  assert.equal(recognize.filter(item => item.counted !== false).length, 250);
  assert.equal(polyphonicReviews.length, 21);
  assert.deepEqual(
    sections().flatMap(section => section.recognize
      .filter(item => item.counted === false)
      .map(item => [section.id, item.character, item.pinyin])),
    expectedPolyphonicReviews
  );
  assert.equal(sections().reduce((sum, section) => sum + section.write.length, 0), 250);
});

test('matches every curriculum entry to the human-reviewable readings audit', () => {
  const content = readFileSync(new URL('../docs/curriculum-readings.tsv', import.meta.url), 'utf8');
  const actualRows = parseReadingsAudit(content);
  const expectedRows = expectedAuditRows();

  for (const [index, expected] of expectedRows.entries()) {
    const actual = actualRows[index];
    const label = `${expected.section}/${expected.group}/${expected.character} at TSV line ${actual?.lineNumber ?? '<missing>'}`;
    assert.deepEqual(actual && {
      section: actual.section,
      group: actual.group,
      character: actual.character,
      pinyin: actual.pinyin,
      audio: actual.audio,
      counting: actual.counting
    }, expected, label);
  }
  const extra = actualRows[expectedRows.length];
  assert.equal(
    actualRows.length,
    expectedRows.length,
    extra
      ? `unexpected ${extra.section}/${extra.group}/${extra.character} at TSV line ${extra.lineNumber}`
      : 'TSV ended before all 521 curriculum entries'
  );
  assert.equal(actualRows.length, 521, 'TSV row count');
});

test('keeps the audit document section checklist synchronized with curriculum data', () => {
  const content = readFileSync(new URL('../docs/data-audit.md', import.meta.url), 'utf8');
  assert.match(content, /`docs\/curriculum-readings\.tsv`/);
  assert.match(content, /人工核对[^。]*审计基准/);

  const actualRows = parseAuditSectionTable(content);
  const expectedRows = curriculum.units.flatMap(unit => unit.lessons.map(section => ({
    unit: unit.title,
    id: section.id,
    title: section.title,
    recognizeDisplayed: section.recognize.length,
    recognizeCounted: section.recognize.filter(item => item.counted !== false).length,
    write: section.write.length,
    reviewed: '[x]'
  })));

  for (const [index, expected] of expectedRows.entries()) {
    const actual = actualRows[index];
    const label = `${expected.id} at audit checklist row ${actual?.rowNumber ?? '<missing>'}`;
    assert.deepEqual(actual && {
      unit: actual.unit,
      id: actual.id,
      title: actual.title,
      recognizeDisplayed: actual.recognizeDisplayed,
      recognizeCounted: actual.recognizeCounted,
      write: actual.write,
      reviewed: actual.reviewed
    }, expected, label);
  }
  const extra = actualRows[expectedRows.length];
  assert.equal(
    actualRows.length,
    expectedRows.length,
    extra ? `unexpected ${extra.id} at audit checklist row ${extra.rowNumber}` : 'audit checklist ended early'
  );
});

test('uses unique unit metadata and section ids', () => {
  const unitIds = curriculum.units.map(unit => unit.id);
  const unitTitles = curriculum.units.map(unit => unit.title);
  const sectionIds = sections().map(section => section.id);

  assert.equal(new Set(unitIds).size, unitIds.length);
  assert.equal(new Set(unitTitles).size, unitTitles.length);
  assert.equal(new Set(sectionIds).size, sectionIds.length);
  assert.deepEqual(unitIds, Array.from({ length: 8 }, (_, index) => `unit-${index + 1}`));
  assert.deepEqual(unitTitles, Array.from({ length: 8 }, (_, index) => `第${'一二三四五六七八'[index]}单元`));
});

test('uses the required record shape for lessons and gardens', () => {
  for (const section of sections()) {
    assert.ok(Array.isArray(section.recognize), `${section.id}.recognize`);
    assert.ok(Array.isArray(section.write), `${section.id}.write`);

    if (section.kind === 'lesson') {
      assert.match(section.id, /^lesson-([1-9]|1\d|2[0-7])$/);
      assert.equal(section.id, `lesson-${section.number}`);
      assert.equal(typeof section.number, 'number');
    } else {
      assert.equal(section.kind, 'garden');
      assert.match(section.id, /^garden-[2468]$/);
      assert.equal(Object.hasOwn(section, 'number'), false);
    }
  }
});

test('stores one normalized Han code point and a matching audio id for every entry', () => {
  for (const section of sections()) {
    for (const group of ['recognize', 'write']) {
      for (const item of section[group]) {
        assert.ok(item.counted === undefined || item.counted === false, `${section.id}.${group} ${item.character}.counted`);
        if (group === 'write') assert.equal(item.counted, undefined, `${section.id}.write ${item.character}.counted`);
        assert.equal(Array.from(item.character).length, 1, `${section.id}.${group} ${item.character}`);
        assert.match(item.character, /^\p{Script=Han}$/u, `${section.id}.${group} ${item.character}`);
        assert.equal(item.pinyin, item.pinyin.normalize('NFC'), `${section.id}.${group} ${item.character}`);
        assert.match(item.pinyin, /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿ]+$/u, `${section.id}.${group} ${item.character}`);
        assert.match(item.audio, /^[a-z]+[1-5]$/, `${section.id}.${group} ${item.character}`);
        assert.equal(item.audio, pinyinToAudioId(item.pinyin), `${section.id}.${group} ${item.character}`);
      }
    }
  }

  assert.equal(pinyinToAudioId('nǚ'), 'nv3');
  assert.equal(pinyinToAudioId('lüè'), 'lve4');
});

test('does not duplicate a character within a section classification', () => {
  for (const section of sections()) {
    for (const group of ['recognize', 'write']) {
      const characters = section[group].map(item => item.character);
      assert.equal(new Set(characters).size, characters.length, `${section.id}.${group}`);
    }
  }
});

test('preserves contextual readings and 2019 edition discriminators', () => {
  assert.equal(lessons().find(lesson => lesson.id === 'lesson-6').title, '夜间飞行的秘密');

  const expectedRecognize = [
    ['lesson-6', '系', 'jì'],
    ['lesson-8', '雀', 'qiǎo'],
    ['lesson-13', '少', 'shào'],
    ['lesson-14', '还', 'huán'],
    ['lesson-17', '相', 'xiàng'],
    ['lesson-19', '露', 'lòu'],
    ['lesson-19', '角', 'jué'],
    ['lesson-23', '宁', 'nìng'],
    ['lesson-23', '要', 'yāo'],
    ['lesson-27', '纪', 'jǐ']
  ];
  for (const [lessonId, character, pinyin] of expectedRecognize) {
    assert.deepEqual(entry(lessonId, 'recognize', character), {
      character,
      pinyin,
      audio: pinyinToAudioId(pinyin),
      counted: false
    });
  }

  assert.deepEqual(entry('lesson-9', 'write', '降'), {
    character: '降',
    pinyin: 'xiáng',
    audio: 'xiang2'
  });
  assert.deepEqual(entry('lesson-12', 'write', '血'), {
    character: '血',
    pinyin: 'xuè',
    audio: 'xue4'
  });
});
