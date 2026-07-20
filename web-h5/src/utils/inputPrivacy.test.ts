import { describe, expect, it } from 'vitest';
import { detectSensitiveData } from './inputPrivacy';

describe('detectSensitiveData', () => {
  it('detects supported sensitive identifiers', () => {
    expect(detectSensitiveData('联系电话 13800138000')).toContain('mobile');
    expect(detectSensitiveData('身份证 11010519491231002X')).toContain('id_card');
    expect(detectSensitiveData('银行卡 4539 1488 0343 6467')).toContain('bank_card');
  });

  it('does not flag ordinary job description numbers', () => {
    expect(detectSensitiveData('薪资 30-60K，要求 3 年经验，每周工作 5 天')).toEqual([]);
  });
});
