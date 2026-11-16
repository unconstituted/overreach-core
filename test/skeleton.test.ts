import { describe, expect, it } from 'vitest';
import { ENGINE_NAME, ENGINE_VERSION } from '../src/core/version';

describe('skeleton', () => {
  it('exposes the engine name and a semantic version', () => {
    expect(ENGINE_NAME).toBe('Overreach Core');
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
