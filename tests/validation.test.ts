import { describe, expect, it } from 'vitest';
import { validateAiBaseUrl } from '../src/domain/validation';

describe('AI 地址安全校验', () => {
  it('正式环境拒绝 HTTP、本机和 URL 中的密码', () => {
    expect(() => validateAiBaseUrl('http://example.com/v1', true)).toThrow('HTTPS');
    expect(() => validateAiBaseUrl('https://localhost/v1', true)).toThrow('本机');
    expect(() => validateAiBaseUrl('https://name:secret@example.com/v1', true)).toThrow('账号或密码');
  });

  it('接受普通 HTTPS 兼容接口', () => {
    expect(validateAiBaseUrl('https://api.example.com/v1/', true).hostname).toBe('api.example.com');
  });
});
