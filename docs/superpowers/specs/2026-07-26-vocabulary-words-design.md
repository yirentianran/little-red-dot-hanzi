# Vocabulary Words Design

## Purpose

Add short word examples for every curriculum character so children can connect pronunciation, glyph shape, and everyday usage while practicing stroke order and visual tracking.

The first version stays lightweight: it shows only word examples, without definitions, sentences, quizzes, or explicit same-pronunciation confusion drills.

## Scope

- Cover both `write` and `recognize` character groups.
- Add 2 to 3 vocabulary words per character when practical.
- Prefer words from or close to the textbook lesson context.
- Use common, age-appropriate words when lesson-context words are not enough.
- Keep all vocabulary data available offline with the existing static page.

## Non-Goals

- Do not add definitions in this version.
- Do not add example sentences in this version.
- Do not add same-pinyin comparison cards in this version.
- Do not add vocabulary editing UI in this version.
- Do not change stroke order animation, audio playback, routing, or lesson grouping behavior.

## Data Model

Each character entry gains a required `words` array:

```json
{
  "character": "潮",
  "pinyin": "cháo",
  "words": ["潮水", "浪潮", "涨潮"]
}
```

Rules:

- `words` contains strings only.
- Each word should include the current character.
- Prefer 2 or 3 words; allow 1 only when a reliable age-appropriate set is not available.
- Keep word order stable and deterministic.
- Preserve the existing curriculum structure by unit, lesson, and group.

## Interface

On the character detail view, show vocabulary near the existing pinyin and audio controls:

```text
潮
cháo
组词：潮水  浪潮  涨潮
```

The vocabulary line should be visually secondary to the character and pinyin, but easy to scan before or after stroke practice. It must fit on mobile without overlapping the writing board or controls.

The production data should include `words` for every character. As a rendering fallback, if a character has no `words` value, the vocabulary row should be omitted rather than showing an empty label.

## Data Flow

1. The runtime loads the existing offline curriculum data.
2. View-model creation passes each character entry's `words` array through unchanged.
3. The character detail renderer displays the words when present.
4. Tests verify the words are available in data and visible in both `write` and `recognize` character views.

## Validation

Automated checks should confirm:

- Every `write` and `recognize` entry has a valid `words` array.
- Each `words` array contains 1 to 3 non-empty strings.
- Each listed word includes the current character.
- Existing curriculum totals, audio references, and stroke geometry validation continue to pass.
- Character detail rendering includes the vocabulary row when words exist.
- Character detail rendering omits the row when words are absent.

## Future Extensions

The data model can later add explicit same-pronunciation confusion support without changing this first feature:

```json
{
  "character": "潮",
  "pinyin": "cháo",
  "words": ["潮水", "浪潮", "涨潮"],
  "confusable": ["朝", "嘲"]
}
```

That extension is intentionally out of scope for this version.
