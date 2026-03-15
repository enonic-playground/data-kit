package com.enonic.app.datakit

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import org.osgi.service.component.annotations.Component
import java.nio.file.Path
import java.security.KeyFactory
import java.security.interfaces.RSAPrivateKey
import java.security.spec.PKCS8EncodedKeySpec
import java.time.Instant
import java.util.Base64
import kotlin.io.path.readText

private val JWT_JSON_STRING_REGEX = """"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"""".toRegex()

@Component(immediate = true)
class JwtGenerator {
    @Volatile
    private var cachedEntry: Pair<String, RSAPrivateKey>? = null

    fun generateToken(
        subject: String,
        keyId: String,
        privateKeyPath: String,
        expirationSeconds: Int,
    ): String {
        return try {
            val privateKey = getPrivateKey(privateKeyPath)
            signToken(subject, keyId, privateKey, expirationSeconds)
        } catch (e: Exception) {
            throw RuntimeException("Failed to generate JWT: ${e.message}", e)
        }
    }

    fun generateTokenFromKeyFile(keyFilePath: String, expirationSeconds: Int): String {
        return try {
            val content = Path.of(keyFilePath).readText()
            val keyId = extractJsonValue(content, "kid")
            val principalKey = extractJsonValue(content, "principalKey")
            val pemKey = extractJsonValue(content, "privateKey")

            val privateKey = parsePrivateKey(keyFilePath, pemKey)
            signToken(principalKey, keyId, privateKey, expirationSeconds)
        } catch (e: Exception) {
            throw RuntimeException("Failed to generate JWT from key file: ${e.message}", e)
        }
    }

    private fun signToken(
        subject: String,
        keyId: String,
        privateKey: RSAPrivateKey,
        expirationSeconds: Int,
    ): String {
        val now = Instant.now()

        return JWT.create()
            .withKeyId(keyId)
            .withSubject(subject)
            .withIssuedAt(now)
            .withExpiresAt(now.plusSeconds(expirationSeconds.toLong()))
            .sign(Algorithm.RSA256(null, privateKey))
    }

    private fun extractJsonValue(json: String, key: String): String {
        for (match in JWT_JSON_STRING_REGEX.findAll(json)) {
            if (match.groupValues[1] == key) {
                return match.groupValues[2].unescapeJsonString()
            }
        }

        throw RuntimeException("Key '$key' not found in key file")
    }

    private fun getPrivateKey(path: String): RSAPrivateKey {
        cachedKeyFor(path)?.let { return it }

        val pem = Path.of(path).readText()
        return parsePrivateKey(path, pem)
    }

    @Synchronized
    private fun parsePrivateKey(path: String, pem: String): RSAPrivateKey {
        cachedKeyFor(path)?.let { return it }

        val base64 = pem
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .filterNot(Char::isWhitespace)

        val decoded = Base64.getDecoder().decode(base64)
        val spec = PKCS8EncodedKeySpec(decoded)
        val privateKey = KeyFactory.getInstance("RSA").generatePrivate(spec) as RSAPrivateKey

        cachedEntry = path to privateKey

        return privateKey
    }

    private fun cachedKeyFor(path: String): RSAPrivateKey? {
        val (cachedPath, cachedKey) = cachedEntry ?: return null
        if (path != cachedPath) return null
        return cachedKey
    }
}

private val JSON_UNESCAPE_REGEX = """\\(.)""".toRegex()

private fun String.unescapeJsonString(): String =
    JSON_UNESCAPE_REGEX.replace(this) { match ->
        when (match.groupValues[1]) {
            "n" -> "\n"
            "\"" -> "\""
            "\\" -> "\\"
            else -> match.groupValues[1]
        }
    }
