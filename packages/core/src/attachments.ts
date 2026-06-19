import type { ScenarioAttachment, SourceScenarioAttachment } from './types.js';

export const ATTACHMENT_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv'
};

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

export function attachmentTypeFromMediaType(mediaType: string): 'image' | 'document' {
  return mediaType.startsWith('image/') ? 'image' : 'document';
}

export function attachmentExtensionFromPath(path?: string): string {
  return path?.split('.').pop()?.toLowerCase() ?? '';
}

export function inferAttachmentMediaType(att: SourceScenarioAttachment): string | undefined {
  if (att.media_type) return att.media_type;
  if (!att.path) return undefined;
  return ATTACHMENT_MEDIA_TYPE_BY_EXTENSION[attachmentExtensionFromPath(att.path)];
}

export function supportsUrlOnlyAttachment(
  att: Pick<ScenarioAttachment, 'type' | 'media_type'>
): boolean {
  return att.type === 'image' || att.media_type === 'application/pdf';
}

export function validateRuntimeAttachmentContract(
  att: Pick<ScenarioAttachment, 'type' | 'media_type'> & { url?: string; data?: string },
  context: string
): void {
  if (att.url && !att.data && !supportsUrlOnlyAttachment(att)) {
    throw new Error(`${context} must be image/* or application/pdf when only url is provided`);
  }
}

export function isSupportedAttachmentMediaType(mediaType: string): boolean {
  return (
    SUPPORTED_ATTACHMENT_IMAGE_MEDIA_TYPES.includes(mediaType) ||
    SUPPORTED_ATTACHMENT_DOCUMENT_MEDIA_TYPES.includes(mediaType)
  );
}
