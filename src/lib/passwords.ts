export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON_WEAK_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  '12345678910',
  'password123',
  'password1234',
  'password123!',
  'qwerty12345',
  'qwertyuiop',
  'letmein1234',
  'welcome1234',
  'admin123456',
  'administrator',
  'strangetheory',
  'strangetheory1',
  'strangetheory2026',
  'changeme123',
  'iloveyou123',
  'abc123456789',
  '1111111111',
  '0000000000',
  'aaaaaaaaaa',
  'passw0rd123',
  'monkey12345',
  'dragon12345',
  'baseball123',
  'football123',
  'trustno1123',
  'sunshine123',
  'princess123',
  'shadow12345',
  'master12345',
  'hello123456',
  'freedom1234',
  'whatever123',
  'qazwsxedcrf',
  '1q2w3e4r5t',
  '1q2w3e4r5t6y',
  'zaq12wsx3edc',
  'secret12345',
  'test1234567',
]);

export function validatePasswordStrength(
  password: string,
  context?: { email?: string; username?: string }
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters long.`;
  }

  const normalized = password.trim().toLowerCase().replace(/\s+/g, '');
  if (COMMON_WEAK_PASSWORDS.has(normalized)) {
    return 'Choose a stronger password — that password is on the common-password blocklist.';
  }
  if (/^(.)\1+$/.test(normalized)) {
    return 'Password cannot consist of a single repeated character.';
  }
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)+$/i.test(normalized)) {
    return 'Avoid simple keyboard or sequential character runs in your password.';
  }

  if (context?.username && context.username.trim().length >= 3) {
    const uname = context.username.trim().toLowerCase();
    if (normalized.includes(uname)) {
      return 'Password cannot contain your username.';
    }
  }
  if (context?.email && context.email.includes('@')) {
    const localPart = context.email.split('@')[0].trim().toLowerCase();
    if (localPart.length >= 4 && normalized.includes(localPart)) {
      return 'Password cannot contain your email address.';
    }
  }

  return null;
}
