let counter = 0;

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomChars(len: number): string {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function generateLogId(): string {
  counter++;
  return `${randomChars(6)}${counter.toString(36)}`;
}
