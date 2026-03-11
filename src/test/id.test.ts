import { describe, it, expect } from 'vitest';
import { generateLogId } from '../utils/id';

describe('generateLogId', () => {
  it('returns a non-empty string', () => {
    const id = generateLogId();
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique ids on successive calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateLogId());
    }
    expect(ids.size).toBe(100);
  });

  it('contains only alphanumeric characters', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateLogId();
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it('starts with 6 random characters followed by a counter suffix', () => {
    const id = generateLogId();
    expect(id.length).toBeGreaterThanOrEqual(7);
  });
});
