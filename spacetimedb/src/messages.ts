// The private care-team conversation shared by the patient, the nurse, and
// approved family members. Pure helpers; the reducer and the UI both use them.

export const MESSAGE_MAX = 1000;

export const MESSAGE_ROLE_LABEL: Record<string, string> = {
  patient: 'Patient',
  nurse: 'Nurse',
  family: 'Family',
};

/**
 * Conversation channels. 'team' is visible to the whole care circle; 'nurse' is
 * private between the patient and the nurse; 'family' is private between the
 * patient and approved family. The patient is in every channel.
 */
export const MESSAGE_CHANNELS = ['team', 'nurse', 'family'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_CHANNEL_LABEL: Record<MessageChannel, string> = {
  team: 'Everyone',
  nurse: 'Nurse only',
  family: 'Family only',
};

export function isMessageChannel(v: string): v is MessageChannel {
  return (MESSAGE_CHANNELS as readonly string[]).includes(v);
}

/** The channels a role can read and post to, in tab order. */
export function channelsForRole(role: 'patient' | 'nurse' | 'family'): readonly MessageChannel[] {
  if (role === 'patient') return MESSAGE_CHANNELS;
  if (role === 'nurse') return ['team', 'nurse'];
  return ['team', 'family'];
}

/** Posting rule shared by the reducer and the composer UI. */
export function canPostToChannel(role: 'patient' | 'nurse' | 'family', channel: MessageChannel): boolean {
  return channelsForRole(role).includes(channel);
}

/** Trim and validate a message body; throws a user-facing error on bad input. */
export function cleanMessageBody(raw: string): string {
  const body = raw.trim().replace(/\n{3,}/g, '\n\n');
  if (!body) throw new Error('Write a message first');
  if (body.length > MESSAGE_MAX) throw new Error(`Keep messages under ${MESSAGE_MAX} characters`);
  return body;
}
