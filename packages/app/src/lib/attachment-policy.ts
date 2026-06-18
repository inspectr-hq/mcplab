export const SUPPORTED_ATTACHMENT_IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
];

export const SUPPORTED_ATTACHMENT_DOCUMENT_MEDIA_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv'
];

export function isSupportedAttachmentMediaType(mediaType: string): boolean {
  return (
    SUPPORTED_ATTACHMENT_IMAGE_MEDIA_TYPES.includes(mediaType) ||
    SUPPORTED_ATTACHMENT_DOCUMENT_MEDIA_TYPES.includes(mediaType)
  );
}
