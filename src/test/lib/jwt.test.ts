import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGenerateToken = vi.fn();
const mockGenerateTokenFromKeyFile = vi.fn();

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__ = {
    newBean: vi.fn(() => ({
      generateToken: mockGenerateToken,
      generateTokenFromKeyFile: mockGenerateTokenFromKeyFile,
    })),
  };
});

import { generateBearerToken, getJwtConfig } from '../../main/resources/lib/jwt';

const KEY_FILE_CONFIG = {
  'managementApi.authMethod': 'jwt',
  'managementApi.jwt.privateKeyPath': '/path/to/key.json',
};

const EXPLICIT_CONFIG = {
  'managementApi.authMethod': 'jwt',
  'managementApi.jwt.subject': 'user:system:admin',
  'managementApi.jwt.keyId': 'my-key-id',
  'managementApi.jwt.privateKeyPath': '/path/to/private-key.pem',
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).app = { config: { ...KEY_FILE_CONFIG } };
});

describe('getJwtConfig', () => {
  test('returns undefined when authMethod is not jwt', () => {
    (globalThis as Record<string, unknown>).app = { config: {} };
    expect(getJwtConfig()).toBeUndefined();
  });

  test('returns undefined when authMethod is basic', () => {
    (globalThis as Record<string, unknown>).app = {
      config: { 'managementApi.authMethod': 'basic' },
    };
    expect(getJwtConfig()).toBeUndefined();
  });

  test('returns keyFile config when only privateKeyPath is set', () => {
    expect(getJwtConfig()).toEqual({
      mode: 'keyFile',
      keyFilePath: '/path/to/key.json',
      expirationSeconds: 30,
    });
  });

  test('returns explicit config when subject, keyId, and privateKeyPath are all set', () => {
    (globalThis as Record<string, unknown>).app = { config: { ...EXPLICIT_CONFIG } };
    expect(getJwtConfig()).toEqual({
      mode: 'explicit',
      subject: 'user:system:admin',
      keyId: 'my-key-id',
      privateKeyPath: '/path/to/private-key.pem',
      expirationSeconds: 30,
    });
  });

  test('uses custom expirationSeconds when set', () => {
    (globalThis as Record<string, unknown>).app = {
      config: { ...KEY_FILE_CONFIG, 'managementApi.jwt.expirationSeconds': '60' },
    };
    expect(getJwtConfig()).toEqual(expect.objectContaining({ expirationSeconds: 60 }));
  });

  test('throws when privateKeyPath is missing', () => {
    (globalThis as Record<string, unknown>).app = {
      config: { 'managementApi.authMethod': 'jwt' },
    };
    expect(() => getJwtConfig()).toThrow('privateKeyPath is missing');
  });

  test('throws when only subject is set without keyId', () => {
    (globalThis as Record<string, unknown>).app = {
      config: { ...KEY_FILE_CONFIG, 'managementApi.jwt.subject': 'user:system:admin' },
    };
    expect(() => getJwtConfig()).toThrow('must both be set');
  });

  test('throws when only keyId is set without subject', () => {
    (globalThis as Record<string, unknown>).app = {
      config: { ...KEY_FILE_CONFIG, 'managementApi.jwt.keyId': 'my-key-id' },
    };
    expect(() => getJwtConfig()).toThrow('must both be set');
  });
});

describe('generateBearerToken', () => {
  test('uses generateTokenFromKeyFile for keyFile mode', () => {
    mockGenerateTokenFromKeyFile.mockReturnValue('jwt-from-keyfile');

    const result = generateBearerToken({
      mode: 'keyFile',
      keyFilePath: '/path/to/key.json',
      expirationSeconds: 30,
    });

    expect(mockGenerateTokenFromKeyFile).toHaveBeenCalledWith('/path/to/key.json', 30);
    expect(mockGenerateToken).not.toHaveBeenCalled();
    expect(result).toBe('Bearer jwt-from-keyfile');
  });

  test('uses generateToken for explicit mode', () => {
    mockGenerateToken.mockReturnValue('jwt-explicit');

    const result = generateBearerToken({
      mode: 'explicit',
      subject: 'user:system:admin',
      keyId: 'my-key-id',
      privateKeyPath: '/path/to/key.pem',
      expirationSeconds: 45,
    });

    expect(mockGenerateToken).toHaveBeenCalledWith(
      'user:system:admin',
      'my-key-id',
      '/path/to/key.pem',
      45,
    );
    expect(mockGenerateTokenFromKeyFile).not.toHaveBeenCalled();
    expect(result).toBe('Bearer jwt-explicit');
  });

  test('creates bean via __.newBean with correct class name', () => {
    mockGenerateTokenFromKeyFile.mockReturnValue('token');

    generateBearerToken({ mode: 'keyFile', keyFilePath: '/key.json', expirationSeconds: 30 });

    const newBean = (__ as { newBean: ReturnType<typeof vi.fn> }).newBean;
    expect(newBean).toHaveBeenCalledWith('com.enonic.app.datakit.JwtGenerator');
  });
});
