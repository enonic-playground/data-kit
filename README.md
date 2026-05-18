# data-kit

XP data management application for admins

## Management API Authentication

Data Kit uses the XP Management API (port 4848) for snapshot operations. The API requires authentication with an admin user.

Auth is resolved in this order:

1. Browser `Authorization` header (forwarded from the logged-in admin session)
2. JWT service account from `.cfg` (recommended)
3. Basic Auth from `.cfg` (legacy, discouraged since XP 7.15.0)

### JWT Authentication (recommended)

1. Open the **Users** app in XP admin
2. Select (or create) a user with the `system.admin` role
3. In the user detail page, click **Add** under Keys, name it, and click **Generate**
4. The private key downloads as a `.json` file — store it outside the repository
5. Create `$XP_HOME/config/com.enonic.app.datakit.cfg`:

```properties
managementApi.authMethod = jwt
managementApi.jwt.privateKeyPath = /absolute/path/to/key.json
```

The `subject` and `keyId` are read from the key file automatically. If you use a custom PEM key instead of XP's generated JSON, set all properties explicitly:

```properties
managementApi.authMethod = jwt
managementApi.jwt.subject = user:system:admin
managementApi.jwt.keyId = your-key-id
managementApi.jwt.privateKeyPath = /absolute/path/to/private-key.pem
managementApi.jwt.expirationSeconds = 30
```

### Basic Auth (legacy)

```properties
managementApi.user = su
managementApi.password = password
```
