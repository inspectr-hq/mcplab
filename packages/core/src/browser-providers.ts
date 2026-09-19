export type BrowserProviderConfidence = 'high' | 'medium' | 'low';

export interface ShadowLocator {
  segments: string[];
}

export interface BrowserProviderProfile {
  schemaVersion: 1;
  id: string;
  name: string;
  match: { origins: string[] };
  composer: {
    locator: ShadowLocator;
    inputMode: 'input' | 'textarea' | 'contenteditable';
  };
  submit: {
    action: 'click' | 'enter';
    locator?: ShadowLocator;
  };
  assistantMessages: {
    locator: ShadowLocator;
    textLocator?: ShadowLocator;
  };
  completion: {
    generatingLocator?: ShadowLocator;
    idleLocator?: ShadowLocator;
    stabilityMs: number;
  };
  newConversation?: {
    action: 'click' | 'navigate';
    locator?: ShadowLocator;
    url?: string;
  };
  learned: {
    sourceOrigin: string;
    createdAt: string;
    updatedAt: string;
    confidence: Record<string, BrowserProviderConfidence>;
  };
}

type RawRecord = Record<string, unknown>;

function record(value: unknown, label: string): RawRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid browser provider ${label}.`);
  return value as RawRecord;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Invalid browser provider ${label}.`);
  return value.trim();
}

function locator(value: unknown, label: string): ShadowLocator {
  const source = record(value, label);
  if (
    !Array.isArray(source.segments) ||
    source.segments.length === 0 ||
    source.segments.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new Error(`Invalid browser provider ${label} locator.`);
  }
  return { segments: source.segments.map((item) => String(item).trim()) };
}

function optionalLocator(value: unknown, label: string): ShadowLocator | undefined {
  return value === undefined ? undefined : locator(value, label);
}

function origin(value: unknown, label: string): string {
  const parsed = new URL(stringValue(value, label));
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Invalid browser provider ${label} origin.`);
  }
  return parsed.origin;
}

export function validateBrowserProviderProfile(value: unknown): BrowserProviderProfile {
  const source = record(value, 'profile');
  if (
    Object.prototype.hasOwnProperty.call(source, 'script') ||
    Object.prototype.hasOwnProperty.call(source, 'scriptSource')
  ) {
    throw new Error('Executable browser provider profiles are not supported.');
  }
  if (source.schemaVersion !== 1) throw new Error('Unsupported browser provider profile schema.');
  const id = stringValue(source.id, 'id');
  const name = stringValue(source.name, 'name');
  const match = record(source.match, 'match');
  if (!Array.isArray(match.origins) || match.origins.length === 0)
    throw new Error('Browser provider match origins are required.');
  const origins = match.origins.map((item) => origin(item, 'match'));
  const composer = record(source.composer, 'composer');
  const inputMode = composer.inputMode;
  if (inputMode !== 'input' && inputMode !== 'textarea' && inputMode !== 'contenteditable')
    throw new Error('Invalid browser provider composer input mode.');
  const submit = record(source.submit, 'submit');
  if (submit.action !== 'click' && submit.action !== 'enter')
    throw new Error('Invalid browser provider submit action.');
  if (submit.action === 'click' && !submit.locator)
    throw new Error('Browser provider click submit locator is required.');
  const assistant = record(source.assistantMessages, 'assistantMessages');
  const completion = record(source.completion, 'completion');
  if (
    typeof completion.stabilityMs !== 'number' ||
    !Number.isFinite(completion.stabilityMs) ||
    completion.stabilityMs < 250
  )
    throw new Error('Invalid browser provider completion stability.');
  const learned = record(source.learned, 'learned');
  const confidence = record(learned.confidence ?? {}, 'confidence');
  for (const value of Object.values(confidence))
    if (value !== 'high' && value !== 'medium' && value !== 'low')
      throw new Error('Invalid browser provider confidence.');
  const result: BrowserProviderProfile = {
    schemaVersion: 1,
    id,
    name,
    match: { origins },
    composer: { locator: locator(composer.locator, 'composer'), inputMode },
    submit: { action: submit.action, locator: optionalLocator(submit.locator, 'submit') },
    assistantMessages: {
      locator: locator(assistant.locator, 'assistantMessages'),
      textLocator: optionalLocator(assistant.textLocator, 'assistantMessages text')
    },
    completion: {
      generatingLocator: optionalLocator(completion.generatingLocator, 'generating'),
      idleLocator: optionalLocator(completion.idleLocator, 'idle'),
      stabilityMs: completion.stabilityMs
    },
    learned: {
      sourceOrigin: origin(learned.sourceOrigin, 'source'),
      createdAt: stringValue(learned.createdAt ?? new Date().toISOString(), 'createdAt'),
      updatedAt: stringValue(
        learned.updatedAt ?? learned.createdAt ?? new Date().toISOString(),
        'updatedAt'
      ),
      confidence: confidence as BrowserProviderProfile['learned']['confidence']
    }
  };
  if (source.newConversation !== undefined) {
    const newConversation = record(source.newConversation, 'newConversation');
    if (newConversation.action !== 'click' && newConversation.action !== 'navigate')
      throw new Error('Invalid browser provider new conversation action.');
    if (newConversation.action === 'click' && !newConversation.locator)
      throw new Error('Browser provider new conversation locator is required.');
    if (newConversation.action === 'navigate' && typeof newConversation.url !== 'string')
      throw new Error('Browser provider navigation URL is required.');
    result.newConversation = {
      action: newConversation.action,
      locator: optionalLocator(newConversation.locator, 'newConversation'),
      url: typeof newConversation.url === 'string' ? newConversation.url : undefined
    };
  }
  return result;
}

export function parseBrowserProviderProfiles(
  value: unknown
): Record<string, BrowserProviderProfile> {
  const source = record(value ?? {}, 'profiles');
  const profiles: Record<string, BrowserProviderProfile> = {};
  for (const [id, raw] of Object.entries(source)) {
    const profile = record(raw, id);
    const composer = record(profile.composer, `${id} composer`);
    const submit = record(profile.submit, `${id} submit`);
    const assistant = record(profile.assistant_messages, `${id} assistant_messages`);
    const completion = record(profile.completion, `${id} completion`);
    const learned = record(profile.learned ?? {}, `${id} learned`);
    const normalized = validateBrowserProviderProfile({
      ...profile,
      id,
      schemaVersion: profile.schema_version,
      composer: { ...composer, inputMode: composer.input_mode },
      submit,
      assistantMessages: { locator: assistant.locator, textLocator: assistant.text_locator },
      completion: {
        generatingLocator: completion.generating_locator,
        idleLocator: completion.idle_locator,
        stabilityMs: completion.stability_ms
      },
      newConversation: profile.new_conversation,
      learned: {
        sourceOrigin: learned.source_origin,
        createdAt: learned.created_at,
        updatedAt: learned.updated_at,
        confidence: learned.confidence
      }
    });
    profiles[id] = normalized;
  }
  return profiles;
}
