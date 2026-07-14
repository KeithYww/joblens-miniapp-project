export type SensitiveDataType = 'mobile' | 'id_card' | 'bank_card';

const MAINLAND_MOBILE_PATTERN = /(^|\D)1[3-9]\d{9}(?!\d)/;
const ID_CARD_PATTERN = /(^|\D)(\d{17}[\dXx]|\d{15})(?!\d)/g;
const LONG_NUMBER_PATTERN = /(?:\d[ -]?){15,18}\d/g;

function isValidMainlandIdCard(candidate: string): boolean {
  if (/^\d{15}$/.test(candidate)) return true;
  if (!/^\d{17}[\dXx]$/.test(candidate)) return false;

  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = candidate.slice(0, 17).split('').reduce(
    (total, digit, index) => total + Number(digit) * weights[index],
    0,
  );
  return checks[sum % 11] === candidate[17].toUpperCase();
}

function passesLuhn(candidate: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    let digit = Number(candidate[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function detectSensitiveData(value: string): SensitiveDataType[] {
  if (!value) return [];
  const detected = new Set<SensitiveDataType>();

  if (MAINLAND_MOBILE_PATTERN.test(value)) detected.add('mobile');

  ID_CARD_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(ID_CARD_PATTERN)) {
    if (isValidMainlandIdCard(match[2])) detected.add('id_card');
  }

  LONG_NUMBER_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(LONG_NUMBER_PATTERN)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 16 && digits.length <= 19 && passesLuhn(digits)) {
      detected.add('bank_card');
    }
  }

  return [...detected];
}
