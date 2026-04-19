import { describe, expect, it } from 'vitest';
import { extractPlaceholders } from '../lib/yaml-placeholders.js';

describe('extractPlaceholders', () => {
  it('returns empty array for empty string', () => {
    expect(extractPlaceholders('')).toEqual([]);
  });

  it('extracts two distinct placeholders in order', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal placeholder syntax
    expect(extractPlaceholders('echo ${FOO} ${BAR}')).toEqual(['FOO', 'BAR']);
  });

  it('deduplicates repeated placeholders (first-encounter order)', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal placeholder syntax
    expect(extractPlaceholders('${FOO} ${FOO} ${BAR}')).toEqual(['FOO', 'BAR']);
  });

  it('extracts name from placeholder with default value', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal placeholder syntax
    expect(extractPlaceholders('${FOO:hello} world')).toEqual(['FOO']);
  });

  it('ignores lowercase-only identifiers (uppercase-only rule)', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal placeholder syntax
    expect(extractPlaceholders('${fooLowerNotValid}')).toEqual([]);
  });

  it('accepts underscore and digit suffixes in name', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal placeholder syntax
    expect(extractPlaceholders('${A_B1} ${C2}')).toEqual(['A_B1', 'C2']);
  });

  it('deduplicates across default-value and plain form', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal placeholder syntax
    expect(extractPlaceholders('echo ${FOO:default} ${FOO} ${BAR}')).toEqual(['FOO', 'BAR']);
  });

  it('handles YAML multiline with multiple placeholders', () => {
    const yaml = `
run:
  cmd: echo \${GREETING:hello}
  target: \${HOST}
  retries: \${RETRIES:3}
`;
    expect(extractPlaceholders(yaml)).toEqual(['GREETING', 'HOST', 'RETRIES']);
  });
});
