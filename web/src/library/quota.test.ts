import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { STORAGE_QUOTA_PROBLEM } from '../api/scores';
import { describeFailure } from './text';

describe('storage quota', () => {
  it('tells a full storage space from a score that is too large', () => {
    expect(describeFailure(new ApiError(413, { problemType: STORAGE_QUOTA_PROBLEM })).key).toBe(
      'library.errorStorage',
    );
    expect(describeFailure(new ApiError(413)).key).toBe('library.errorTooLarge');
  });
});
