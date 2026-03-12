declare interface JwtGenerator {
    generateToken: (subject: string, keyId: string, privateKeyPath: string, expirationSeconds: number) => string;
    generateTokenFromKeyFile: (keyFilePath: string, expirationSeconds: number) => string;
}

interface XpBeans {
    'com.enonic.app.datakit.JwtGenerator': JwtGenerator;
}
