import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MEDIA_TYPE_BY_EXTENSION,
  SUPPORTED_ATTACHMENT_DOCUMENT_MEDIA_TYPES as CORE_DOCUMENT_TYPES,
  SUPPORTED_ATTACHMENT_IMAGE_MEDIA_TYPES as CORE_IMAGE_TYPES,
  isSupportedAttachmentMediaType as coreIsSupported
} from '../../../core/src/attachments';
import {
  SUPPORTED_ATTACHMENT_DOCUMENT_MEDIA_TYPES,
  SUPPORTED_ATTACHMENT_IMAGE_MEDIA_TYPES,
  isSupportedAttachmentMediaType
} from './attachment-policy';

describe('attachment policy drift guard', () => {
  it('matches core supported media types', () => {
    expect(SUPPORTED_ATTACHMENT_IMAGE_MEDIA_TYPES).toEqual(CORE_IMAGE_TYPES);
    expect(SUPPORTED_ATTACHMENT_DOCUMENT_MEDIA_TYPES).toEqual(CORE_DOCUMENT_TYPES);
  });

  it('matches core support predicate for all known media types', () => {
    const knownMediaTypes = new Set([
      ...Object.values(ATTACHMENT_MEDIA_TYPE_BY_EXTENSION),
      'application/octet-stream',
      'image/svg+xml'
    ]);

    for (const mediaType of knownMediaTypes) {
      expect(isSupportedAttachmentMediaType(mediaType)).toBe(coreIsSupported(mediaType));
    }
  });
});
