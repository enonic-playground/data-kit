// ? Two JWT config modes:
// ? 1. Key file (minimal): just `privateKeyPath` pointing to XP-generated JSON — subject/keyId extracted automatically
// ? 2. Explicit (custom PEM): `subject`, `keyId`, and `privateKeyPath` all specified manually

type JwtKeyFileConfig = {
    mode: 'keyFile';
    keyFilePath: string;
    expirationSeconds: number;
};

type JwtExplicitConfig = {
    mode: 'explicit';
    subject: string;
    keyId: string;
    privateKeyPath: string;
    expirationSeconds: number;
};

export type JwtConfig = JwtKeyFileConfig | JwtExplicitConfig;

const DEFAULT_EXPIRATION_SECONDS = 30;

export function getJwtConfig(): JwtConfig | undefined {
    const authMethod = app.config['managementApi.authMethod'];
    if (authMethod !== 'jwt') return undefined;

    const subject = app.config['managementApi.jwt.subject'];
    const keyId = app.config['managementApi.jwt.keyId'];
    const privateKeyPath = app.config['managementApi.jwt.privateKeyPath'];
    const expirationSeconds = parseInt(app.config['managementApi.jwt.expirationSeconds'] ?? '', 10);
    // biome-ignore lint/suspicious/noGlobalIsNan: Number.isNaN is not available in Nashorn
    const expiration = isNaN(expirationSeconds) ? DEFAULT_EXPIRATION_SECONDS : expirationSeconds;

    if (privateKeyPath == null) {
        throw new Error(
            'JWT auth is enabled (managementApi.authMethod=jwt) but managementApi.jwt.privateKeyPath is missing. ' +
            'Point it to an XP-generated key file (.json) or a PKCS8 PEM file.',
        );
    }

    if (subject != null && keyId != null) {
        return { mode: 'explicit', subject, keyId, privateKeyPath, expirationSeconds: expiration };
    }

    if (subject != null || keyId != null) {
        throw new Error(
            'JWT auth: managementApi.jwt.subject and managementApi.jwt.keyId must both be set for explicit mode, ' +
            'or both omitted to auto-detect from the key file.',
        );
    }

    return { mode: 'keyFile', keyFilePath: privateKeyPath, expirationSeconds: expiration };
}

export function generateBearerToken(config: JwtConfig): string {
    const jwtGenerator = __.newBean<JwtGenerator>('com.enonic.app.datakit.JwtGenerator');

    const token = config.mode === 'keyFile'
        ? jwtGenerator.generateTokenFromKeyFile(config.keyFilePath, config.expirationSeconds)
        : jwtGenerator.generateToken(config.subject, config.keyId, config.privateKeyPath, config.expirationSeconds);

    return `Bearer ${token}`;
}
