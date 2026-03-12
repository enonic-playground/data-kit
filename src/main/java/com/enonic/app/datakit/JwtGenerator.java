package com.enonic.app.datakit;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.osgi.service.component.annotations.Component;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;

@Component(immediate = true)
public class JwtGenerator
{
    private String cachedKeyPath;

    private RSAPrivateKey cachedKey;

    public String generateToken( final String subject, final String keyId, final String privateKeyPath,
                                 final int expirationSeconds )
    {
        try
        {
            final RSAPrivateKey privateKey = getPrivateKey( privateKeyPath );
            final Instant now = Instant.now();

            return JWT.create()
                .withKeyId( keyId )
                .withSubject( subject )
                .withIssuedAt( now )
                .withExpiresAt( now.plusSeconds( expirationSeconds ) )
                .sign( Algorithm.RSA256( null, privateKey ) );
        }
        catch ( Exception e )
        {
            throw new RuntimeException( "Failed to generate JWT: " + e.getMessage(), e );
        }
    }

    public String generateTokenFromKeyFile( final String keyFilePath, final int expirationSeconds )
    {
        try
        {
            final String content = new String( Files.readAllBytes( Paths.get( keyFilePath ) ) );
            final String kid = extractJsonValue( content, "kid" );
            final String principalKey = extractJsonValue( content, "principalKey" );
            final String pemKey = extractJsonValue( content, "privateKey" );

            final RSAPrivateKey privateKey = parsePrivateKey( keyFilePath, pemKey );
            final Instant now = Instant.now();

            return JWT.create()
                .withKeyId( kid )
                .withSubject( principalKey )
                .withIssuedAt( now )
                .withExpiresAt( now.plusSeconds( expirationSeconds ) )
                .sign( Algorithm.RSA256( null, privateKey ) );
        }
        catch ( Exception e )
        {
            throw new RuntimeException( "Failed to generate JWT from key file: " + e.getMessage(), e );
        }
    }

    private String extractJsonValue( final String json, final String key )
    {
        final Pattern pattern = Pattern.compile( "\"" + key + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"" );
        final Matcher matcher = pattern.matcher( json );
        if ( matcher.find() )
        {
            return matcher.group( 1 )
                .replace( "\\n", "\n" )
                .replace( "\\\"", "\"" )
                .replace( "\\\\", "\\" );
        }
        throw new RuntimeException( "Key '" + key + "' not found in key file" );
    }

    private RSAPrivateKey getPrivateKey( final String path )
        throws Exception
    {
        if ( cachedKey != null && path.equals( cachedKeyPath ) )
        {
            return cachedKey;
        }

        final String pem = new String( Files.readAllBytes( Paths.get( path ) ) );
        return parsePrivateKey( path, pem );
    }

    private RSAPrivateKey parsePrivateKey( final String path, final String pem )
        throws Exception
    {
        if ( cachedKey != null && path.equals( cachedKeyPath ) )
        {
            return cachedKey;
        }

        final String base64 = pem
            .replace( "-----BEGIN PRIVATE KEY-----", "" )
            .replace( "-----END PRIVATE KEY-----", "" )
            .replaceAll( "\\s", "" );

        final byte[] decoded = Base64.getDecoder().decode( base64 );
        final PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec( decoded );
        final RSAPrivateKey privateKey = (RSAPrivateKey) KeyFactory.getInstance( "RSA" ).generatePrivate( spec );

        this.cachedKeyPath = path;
        this.cachedKey = privateKey;

        return privateKey;
    }
}
