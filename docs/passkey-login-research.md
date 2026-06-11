# NodeWarden Passkey 登录研究记录

记录日期：2026-06-09  
研究范围：NodeWarden 自己的 server、web 登录/注册链路，以及官方 Bitwarden server、web、browser extension 对账户 passkey 登录的实现方式。

## 结论先放前面

NodeWarden 现在已经有完整的主密码注册、主密码登录、刷新 token、2FA、设备记录、官方客户端兼容的 `UserDecryptionOptions`，也支持 vault item 里的 `login.fido2Credentials` 字段。但它还没有“账户 passkey 登录”。现有 `src/utils/passkey.ts` 只有 base64url、challenge、clientData 解析这类工具函数，不能完成 FIDO2/WebAuthn 服务端注册和认证验证。

要支持“自己的 web 用 passkey 登录”和“官方/自定义浏览器扩展也能 passkey 登录”，不能只加一个登录按钮。必须补齐四块：

1. Server 端新增账户 WebAuthn credential 表、challenge/token 防重放机制、FIDO2 attestation/assertion 验证、`grant_type=webauthn`。
2. Server 响应里按 Bitwarden 形状返回 PRF 解密材料：登录 token 响应用单个 `UserDecryptionOptions.WebAuthnPrfOption`，sync 响应用多个 `UserDecryption.WebAuthnPrfOptions`。
3. NodeWarden web 新增 passkey 注册、管理、登录和 PRF 解锁 vault key 的客户端流程。
4. 扩展兼容要跟官方 Bitwarden endpoint 和 response shape 对齐。官方 browser extension 当前只在 Chromium 系浏览器开放 passkey 登录，因为 Firefox/Safari 扩展环境还不能按官方代码需要的方式覆盖 RP ID。

下面按代码链路展开。

## 术语边界

这里有三个容易混淆的东西，文档后面严格区分：

- 账户 passkey 登录：用户不用主密码，使用 WebAuthn/passkey 完成账号认证，并且用 PRF 解开 vault user key。官方 Bitwarden 叫 `WebAuthnLogin`。
- Vault item 里的 passkey：某个登录条目保存网站 passkey/FIDO2 credential 数据，对应 NodeWarden 的 `cipher.login.fido2Credentials`。这是“保险库保存别的网站 passkey”，不是“登录 NodeWarden 账号”。
- WebAuthn 2FA：主密码登录之后用安全密钥做第二因素。官方旧 web repo 里主要是这一类，不等于 passkey 登录。

## NodeWarden 现状

### 路由和入口

NodeWarden 后端是 Cloudflare Workers + D1。主入口 `src/index.ts` 初始化存储后进入 router。认证边界在：

- `src/router-public.ts`：公开接口，包含 `/identity/connect/token`、`/identity/accounts/prelogin`、`/api/accounts/register`。
- `src/router-authenticated.ts`：需要 access token 的接口，包含 profile、change password、TOTP、sync、vault、devices。
- `src/handlers/identity.ts`：OAuth/token 兼容入口。
- `src/handlers/accounts.ts`：注册、profile、密码变更、TOTP、API key 等账户接口。

目前公开路由没有：

- `GET /identity/accounts/webauthn/assertion-options`
- `POST /identity/connect/token` 的 `grant_type=webauthn`
- `POST /api/webauthn/attestation-options`
- `POST /api/webauthn/assertion-options`
- `GET/POST/PUT /api/webauthn`

### 注册链路

NodeWarden 自己 web 的注册入口在 `webapp/src/lib/api/auth.ts` 的 `registerAccount()`：

- 使用邮箱作为 salt，用 PBKDF2 派生 master key。
- 再用 PBKDF2(masterKey, password, 1) 得到 client master password hash。
- 随机生成 64 字节 vault symmetric key。
- 用 masterKey 经 HKDF 拆成 enc/mac，把 vault key 加密成 Bitwarden `Key`。
- 生成 RSA-OAEP key pair，把 private key 用 vault symmetric key 加密。
- POST `/api/accounts/register`，提交 `email`、`name`、`masterPasswordHash`、`key`、KDF 参数、invite code、`keys.publicKey`、`keys.encryptedPrivateKey`。

后端 `src/handlers/accounts.ts` 的 `handleRegister()`：

- 第一个用户自动成为 admin，后续用户需要 invite。
- 校验 `JWT_SECRET`、邮箱、KDF 下限、加密字符串形状、公钥/私钥。
- 不直接保存 client hash，而是 `AuthService.hashPasswordServer(masterPasswordHash, email)` 后保存到 `users.master_password_hash`。
- 保存 `users.key`、`users.private_key`、`users.public_key`、KDF 参数、`security_stamp`。

结论：账户 passkey 注册不是替代账号注册，而是“用户已登录后在安全设置里新增一个可登录 credential”。仍然需要已有 vault user key 来生成 PRF keyset。

### 主密码登录链路

NodeWarden 自己 web 的登录入口是 `webapp/src/lib/app-auth.ts` 的 `performPasswordLogin()`：

- 先 `deriveLoginHashLocally()` 得到 masterKey 和 client hash。
- 调 `loginWithPassword()` POST `/identity/connect/token`。
- token 成功后 `completeLogin()` 用 `token.Key` 和本地 masterKey 解开 vault key。
- 保存离线解锁记录。

`webapp/src/lib/api/auth.ts` 也有 `deriveLoginHash()` 和 `getPreloginKdfConfig()` 会调用 `/identity/accounts/prelogin`，但当前 `performPasswordLogin()` 走的是本地 fallback iterations。passkey 登录不应复用这条 masterKey 路径，因为 passkey 登录没有主密码，拿不到 password-derived masterKey。

后端 `src/handlers/identity.ts` 的 `handleToken()` 当前支持：

- `grant_type=password`
- `grant_type=client_credentials`
- `grant_type=refresh_token`

密码登录成功后会：

- 验证 IP 登录频率和用户状态。
- `AuthService.verifyPassword()` 验证 client hash。
- 处理 TOTP 或 remember 2FA token。
- 记录/更新 device。
- 生成 access token 和 refresh token。
- 返回 `Key`、`PrivateKey`、`AccountKeys`、KDF 参数、`UserDecryptionOptions`。

### UserDecryptionOptions 和 sync

NodeWarden 的 `src/utils/user-decryption.ts` 当前只构造主密码解锁：

- `HasMasterPassword: true`
- `MasterPasswordUnlock`
- `TrustedDeviceOption: null`
- `KeyConnectorOption: null`

`src/types/index.ts` 的 sync 类型里预留了 `UserDecryption.WebAuthnPrfOption?: null`，但当前 `src/handlers/sync.ts` 实际只返回 `MasterPasswordUnlock`，没有账户 passkey PRF 解密选项。

passkey 登录必须新增两类 shape：

- 登录 token 响应：`UserDecryptionOptions.WebAuthnPrfOption`，只返回本次认证所用 credential 的 PRF 解密材料。
- sync 响应：`UserDecryption.WebAuthnPrfOptions`，返回该用户所有已启用 PRF keyset 的 passkey 解密材料，供官方客户端锁定/解锁和 key rotation 使用。

### 现有 passkey 相关代码

NodeWarden 已支持 vault item 里的 FIDO2/passkey 字段：

- `src/types/index.ts`：`CipherLogin.fido2Credentials`
- `src/handlers/ciphers.ts`：读写 cipher 时保留/规范化 `fido2Credentials`
- `webapp/src/lib/api/vault.ts`：加密/解密 vault item 内的 `fido2Credentials`
- `webapp/src/lib/types.ts`：`CipherLoginPasskey`

这部分是“保存网站 passkey”，不是账户登录。

`src/utils/passkey.ts` 只有：

- `bytesToBase64Url()`
- `base64UrlToBytes()`
- `randomChallenge()`
- `parseClientDataJSON()`

缺少的核心能力：

- attestation verification
- assertion verification
- authenticator public key 格式处理
- signature verification
- sign counter 更新
- userHandle 与 user id 绑定验证
- origin/RP ID 验证
- challenge 过期和防重放

### 数据库和备份影响

NodeWarden schema 在这些地方需要同步：

- `migrations/0001_init.sql`
- `src/services/storage-schema.ts`
- `wrangler.toml` migrations
- `src/services/backup-archive.ts`
- `src/services/backup-import.ts`
- `shared/backup-schema` 相关类型

当前表里没有账户 passkey credential，也没有 WebAuthn challenge 表。`devices` 表保存设备 trust/key 信息，不适合混入 passkey credential，因为 WebAuthn credential 需要自己的 public key、credential id、counter、AAGUID、PRF keyset 等字段。

## 官方 Bitwarden server 参考

上游代码位置：

- `.codex-upstream/bitwarden-server`
- 研究时 HEAD：`574f3fd`

官方 server 里也有两个 WebAuthn 概念：

- 传统 WebAuthn 2FA：`TwoFactorController`、`WebAuthnTokenProvider`
- 账户 passkey 登录：`WebAuthnLogin`

本项目要参考的是后者。

### 公开 passkey 登录入口

`src/Identity/Controllers/AccountsController.cs`

- `GET /accounts/webauthn/assertion-options`
- 返回 `WebAuthnLoginAssertionOptionsResponseModel`
- response 包含：
  - `options`
  - `token`
- token 使用 `WebAuthnLoginAssertionOptionsTokenable`
- scope 为 `Authentication`
- token 生命周期约 17 分钟

`src/Identity/IdentityServer/RequestValidators/WebAuthnGrantValidator.cs`

- 新增 OAuth extension grant：`grant_type=webauthn`
- 从 form 读取：
  - `token`
  - `deviceResponse`
- 解开 token，校验 scope 必须是 `Authentication`
- 反序列化 `AuthenticatorAssertionRawResponse`
- 调用 `AssertWebAuthnLoginCredential`
- 把成功认证的 credential 传给 `UserDecryptionOptionsBuilder.WithWebAuthnLoginCredential(credential)`
- 之后走通用登录成功逻辑，返回 access/refresh token 和账号加密状态。

`src/Identity/IdentityServer/ApiClient.cs`

- official identity client 的 allowed grant types 包含 `WebAuthnGrantValidator.GrantType`。

`TwoFactorAuthenticationValidator` 里有一个重要行为：FIDO2 user verification 已经被视为第二因素，所以 passkey 登录成功后官方不会再要求额外 2FA。NodeWarden 之后需要明确策略：要兼容官方客户端，应把 passkey 登录视作已满足 2FA，否则官方 `LoginViaWebAuthnComponent` 会显示“不支持 passkey 2FA”的错误。

### 账户 passkey 管理接口

`src/Api/Auth/Controllers/WebAuthnController.cs`

官方 authenticated API：

- `GET /webauthn`：列出账户 passkey credentials。
- `POST /webauthn/attestation-options`：主密码/secret verification 后生成 credential create options 和 token。
- `POST /webauthn/assertion-options`：主密码/secret verification 后生成 assertion options 和 token，用于给已有 credential 启用/更新 PRF keyset。
- `POST /webauthn`：保存新 credential。
- `PUT /webauthn`：更新 credential 的 PRF encryption keyset。
- `POST /webauthn/{id}/delete`：删除 credential。

官方创建 credential 时保存：

- `name`
- `token`
- `deviceResponse`
- `supportsPrf`
- 可选 `encryptedUserKey`
- 可选 `encryptedPublicKey`
- 可选 `encryptedPrivateKey`

官方最多允许 5 个账户 passkey credentials。

### 官方 WebAuthnCredential 表

`src/Core/Auth/Entities/WebAuthnCredential.cs`

字段：

- `Id`
- `UserId`
- `Name`
- `PublicKey`
- `CredentialId`
- `Counter`
- `Type`
- `AaGuid`
- `EncryptedUserKey`
- `EncryptedPrivateKey`
- `EncryptedPublicKey`
- `SupportsPrf`
- `CreationDate`
- `RevisionDate`

SQLite migration：`util/SqliteMigrations/Migrations/20231213032045_WebAuthnLoginCredentials.cs`

表名是 `WebAuthnCredential`，对 `User` 做 cascade delete，并按 `UserId` 建索引。

`GetPrfStatus()`：

- `Unsupported`：`SupportsPrf` 为 false。
- `Supported`：credential 支持 PRF，但还没有完整 encrypted keyset。
- `Enabled`：`EncryptedUserKey`、`EncryptedPrivateKey`、`EncryptedPublicKey` 都存在。

### 官方创建和认证策略

`GetWebAuthnLoginCredentialCreateOptionsCommand.cs`

- 使用 Fido2NetLib。
- `user.id` 是用户 id bytes。
- `user.name/displayName` 使用用户邮箱。
- 排除当前用户已有 credential ids。
- `residentKey: required`
- `userVerification: required`
- `attestation: none`

`GetWebAuthnLoginCredentialAssertionOptionsCommand.cs`

- `allowCredentials` 传空数组。
- `userVerification: required`
- 空 allow list 代表使用 discoverable credentials，也就是 passkey 登录页可以不先输入邮箱。

`CreateWebAuthnLoginCredentialCommand.cs`

- 限制每用户最多 5 个。
- 检查 credential id 在该用户下不能重复。
- FIDO `MakeNewCredentialAsync` 验证 attestation。
- 保存 credential id/public key/counter/type/AAGUID/PRF keyset。

`AssertWebAuthnLoginCredentialCommand.cs`

- 先用 challenge cache 防重放。
- 从 assertion response 的 `userHandle` 解析出 user id。
- 加载该用户所有 WebAuthn credentials。
- 用 credential id 找到记录。
- FIDO `MakeAssertionAsync` 验证签名、challenge、origin、RP ID、user verification。
- 成功后更新 counter。

### 官方 PRF 解密协议

`src/Core/Auth/Models/Api/Response/UserDecryptionOptions.cs`

`WebAuthnPrfDecryptionOption` 字段：

- `EncryptedPrivateKey`
- `EncryptedUserKey`
- `CredentialId`
- `Transports`

`src/Identity/IdentityServer/UserDecryptionOptionsBuilder.cs`

- `WithWebAuthnLoginCredential()` 只在 credential 的 PRF status 是 `Enabled` 时加入 `WebAuthnPrfOption`。
- 如果 credential 没有 PRF keyset，passkey 只能认证账号，不能解开 vault。

`src/Api/Vault/Models/Response/SyncResponseModel.cs`

- sync response 会把所有 enabled PRF credentials 放进 `UserDecryption.WebAuthnPrfOptions`。

## 官方 Bitwarden web/browser client 参考

上游代码位置：

- `.codex-upstream/bitwarden-clients`
- `.codex-upstream/bitwarden-browser`
- 两者研究时 HEAD 都是 `825f9be`，browser repo 内容和 clients monorepo 对应。

旧的 `.codex-upstream/bitwarden-web` 主要有 WebAuthn connector 和 2FA 设置页，没有现代账户 passkey 登录主流程。账户 passkey 登录应以 `bitwarden-clients` 为准。

### 登录按钮可见性

`libs/auth/src/angular/login/default-login-component.service.ts`

- 默认只对 `ClientType.Web` 开启 passkey 登录。

`apps/browser/src/auth/popup/login/extension-login-component.service.ts`

- browser extension 覆盖逻辑：只对 Chromium 开启。
- 注释说明 Firefox 和 Safari 不能在扩展里覆盖 relying party ID。
- 官方代码引用了 W3C webextensions issue 238、Mozilla bug 1956484、Apple forum thread 774351。

结论：NodeWarden 后端即使完全兼容官方 passkey API，官方扩展也只有 Chromium 系会显示 passkey 登录入口。

### Passkey 登录页

`libs/angular/src/auth/login-via-webauthn/login-via-webauthn.component.ts`

流程：

1. 进入 `/login-with-passkey` 后自动开始认证。
2. 调 `webAuthnLoginService.getCredentialAssertionOptions()`。
3. 调 `webAuthnLoginService.assertCredential(options)` 触发 `navigator.credentials.get()`。
4. 调 `webAuthnLoginService.logIn(assertion)` 走 identity token grant。
5. 如果 `authResult.requiresTwoFactor` 为 true，显示“客户端不支持 passkey 2FA”错误。
6. 只有本地 `keyService.userKey$(authResult.userId)` 已经拿到 user key，才运行 login success handler。
7. 成功路由：
   - Web：`/vault`
   - Browser：`/tabs/vault`
   - Desktop：`/vault`

Browser popout 下还会在成功后重新打开普通 popup 并关闭 popout。

### 客户端 passkey 登录请求

`libs/common/src/auth/services/webauthn-login/webauthn-login-api.service.ts`

- GET `${identityUrl}/accounts/webauthn/assertion-options`
- 如果 NodeWarden 的 identityUrl 是站点 origin + `/identity`，实际路径就是 `/identity/accounts/webauthn/assertion-options`。

`libs/common/src/auth/services/webauthn-login/webauthn-login.service.ts`

- `navigator.credentials.get({ publicKey: options })`
- 会主动加 PRF extension：
  - salt 是 `SHA-256("passwordless-login")`
  - extension shape 是 `extensions.prf.eval.first`
- 从 `credential.getClientExtensionResults().prf.results.first` 取 PRF 输出。
- 用 `WebAuthnLoginPrfKeyService.createSymmetricKeyFromPrf()` 转成 PRF key。
- 构造 `WebAuthnLoginAssertionResponseRequest`。
- 明确检查 `deviceResponse.extensions` 里不能含 `prf`，避免把 PRF 输出泄漏给服务端。

`libs/common/src/auth/services/webauthn-login/webauthn-login-prf-key.service.ts`

- salt 常量：`passwordless-login`
- 先 SHA-256。
- 再用 HKDF expand 拆成 64 字节：
  - `"enc"` 32 bytes
  - `"mac"` 32 bytes

`libs/common/src/auth/models/request/identity-token/webauthn-login-token.request.ts`

form encoded token 请求字段：

- `grant_type=webauthn`
- `token=<server assertion options token>`
- `deviceResponse=<JSON string>`
- 还会带 common device request 字段。

`libs/common/src/auth/services/webauthn-login/request/webauthn-login-assertion-response.request.ts`

`deviceResponse` shape：

- `id`
- `rawId`
- `type`
- `extensions: {}`
- `response.authenticatorData`
- `response.signature`
- `response.clientDataJSON`
- `response.userHandle`

全部二进制字段使用 base64url。

### 客户端如何用 PRF 解 vault key

`libs/auth/src/common/login-strategies/webauthn-login.strategy.ts`

- `setMasterKey()` 是空实现，因为 passkey 登录没有主密码 masterKey。
- `setUserKey()`：
  - 如果 token response 有 `key`，保存为 master-key-encrypted user key，兼容主密码解锁。
  - 如果 `userDecryptionOptions.webAuthnPrfOption` 存在，且本地 assertion 得到了 `prfKey`：
    1. 用 PRF key unwrap `encryptedPrivateKey`。
    2. 用 private key decapsulate `encryptedUserKey`。
    3. 得到 user key，写入 `keyService`。

核心约束：服务端永远看不到 PRF 输出。服务端只保存和返回被 PRF 相关密钥加密后的 keyset。

### 官方 web 设置页注册 passkey

`apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin-api.service.ts`

调用的 API：

- `POST /webauthn/attestation-options`
- `POST /webauthn/assertion-options`
- `POST /webauthn`
- `GET /webauthn`
- `POST /webauthn/{id}/delete`
- `PUT /webauthn`

`apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin.service.ts`

创建流程：

1. 用户做 secret verification。
2. 请求 attestation options。
3. `navigator.credentials.create({ publicKey: options })`，并带 `extensions.prf = {}`。
4. 从 client extension results 判断 `supportsPrf`。
5. 如果要用于 vault encryption，再立即做一次 `navigator.credentials.get()`：
   - `allowCredentials` 锁定刚创建的 credential。
   - 使用同一个 challenge、rpId、timeout、userVerification。
   - 带 PRF eval salt。
6. 用 PRF key 和当前 user key 创建 rotateable keyset。
7. 保存 credential，带上 `encryptedUserKey`、`encryptedPublicKey`、`encryptedPrivateKey`。

删除流程需要 secret verification。启用 encryption 的流程是对已有 credential 做 assertion，再创建并 PUT keyset。

`apps/web/src/app/auth/core/enums/webauthn-login-credential-prf-status.enum.ts`

- `Enabled = 0`
- `Supported = 1`
- `Unsupported = 2`

## NodeWarden 应实现的协议形状

### 公开登录流程

目标兼容官方客户端和 NodeWarden 自己 web：

1. `GET /identity/accounts/webauthn/assertion-options`
   - 生成 discoverable credential assertion options。
   - `allowCredentials: []`
   - `userVerification: "required"`
   - 返回 `{ options, token }`。
   - token 绑定 challenge、scope=`Authentication`、RP ID、origin/audience、过期时间。

2. Browser/web 调 `navigator.credentials.get()`。
   - NodeWarden 自己 web 也要使用 PRF extension。
   - PRF salt 必须和官方一致：`SHA-256("passwordless-login")`。

3. `POST /identity/connect/token`
   - 支持 `grant_type=webauthn`。
   - 接收 `token`、`deviceResponse`、device fields。
   - 解 token，校验 challenge/scope/过期。
   - 验证 assertion。
   - 从 `userHandle` 找到 user id。
   - 从 credential id 找到 passkey record。
   - 更新 counter。
   - 记录/更新 device。
   - 返回 access/refresh token、`AccountKeys`、`UserDecryptionOptions.WebAuthnPrfOption`。

如果用户启用了 TOTP，建议为了官方兼容先遵循 Bitwarden：passkey 的 user verification 视作已满足第二因素。否则官方 passkey 登录页会进入 unsupported 2FA 错误状态。

### 账户 passkey 管理流程

建议对齐官方 API，同时在 NodeWarden 内部可挂到 `/api/webauthn`：

- `GET /api/webauthn`
- `POST /api/webauthn/attestation-options`
- `POST /api/webauthn/assertion-options`
- `POST /api/webauthn`
- `PUT /api/webauthn`
- `POST /api/webauthn/:id/delete`

为了官方客户端兼容，可能还需要接受无 `/api` 前缀的 aliases：

- `/webauthn`
- `/webauthn/attestation-options`
- `/webauthn/assertion-options`
- `/webauthn/:id/delete`

NodeWarden 自己 web 可以直接用 `/api/webauthn`，官方 web/browser 客户端会按它自己的 API base 组装 `/webauthn`。

### 建议新增表

按 NodeWarden 命名风格，建议用小写 snake_case：

```sql
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  type TEXT,
  aa_guid TEXT,
  transports TEXT,
  encrypted_user_key TEXT,
  encrypted_public_key TEXT,
  encrypted_private_key TEXT,
  supports_prf INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentials_user_credential
  ON webauthn_credentials(user_id, credential_id);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
  ON webauthn_credentials(user_id);
```

如果要更严格防止同一个 credential id 被跨用户重复注册，也可以加全局 unique index `credential_id`。官方代码至少检查同用户唯一；实际安全上更建议全局唯一，因为 credential id 本身应该唯一标识 authenticator credential。

PRF status 不必落库为枚举，可以由字段计算：

- `supports_prf = 0` => `Unsupported`
- `supports_prf = 1` 且三段 encrypted key 不全 => `Supported`
- `supports_prf = 1` 且三段 encrypted key 全存在 => `Enabled`

### Challenge/token 存储

官方 server 用 protected token 携带 options，再用 challenge cache 防重放。NodeWarden 在 Workers/D1 里建议组合：

- token：HMAC/JWT 样式，绑定 `scope`、`challenge`、`userId?`、`rpId`、`createdAt`、`expiresAt`。
- D1 表或 KV：记录 challenge 是否使用过，至少字段 `challenge_hash`、`scope`、`user_id`、`expires_at`、`used_at`。
- 登录 assertion options 是公开接口，不绑定 user id；create/update/delete 管理流程应绑定 user id。
- 验证成功后立即 mark used。

建议 scopes：

- `Authentication`
- `CreateCredential`
- `UpdateKeySet`

官方还有 `PrfRegistration` 语义，NodeWarden 可以用 `CreateCredential` 覆盖，只要 token 逻辑严谨即可。

### 服务端 WebAuthn 验证库

NodeWarden 当前没有 FIDO2/WebAuthn 服务端验证依赖。不要手写签名和 attestation 解析。

候选：`@simplewebauthn/server`。官方文档当前说明它提供 `generateRegistrationOptions`、`verifyRegistrationResponse`、`generateAuthenticationOptions`、`verifyAuthenticationResponse`，并记录了 RP ID、origin、credential public key、counter、transports 等数据结构。文档地址：https://simplewebauthn.dev/docs/packages/server

注意：NodeWarden 跑在 Cloudflare Workers，不是普通 Node server。正式选库前需要做一次构建/runtime 验证，确认包不会依赖 Workers 不支持的 Node API。这个验证属于实现阶段，不在本研究文档里写测试程序。

## NodeWarden web 需要改的地方

### 登录页

当前登录 UI 在 `webapp/src/components/AuthViews.tsx`，状态和行为主要由 `webapp/src/App.tsx`、`webapp/src/lib/app-auth.ts` 管。

新增：

- 登录页增加“使用 passkey 登录”按钮。
- 新增 `performPasskeyLogin()`：
  1. GET `/identity/accounts/webauthn/assertion-options`
  2. 转换 server options 里的 base64url challenge/user id/credential id 为 ArrayBuffer。
  3. `navigator.credentials.get()`，带 PRF salt。
  4. POST `/identity/connect/token`，`grant_type=webauthn`。
  5. 从 response 的 `UserDecryptionOptions.WebAuthnPrfOption` 取 encrypted keyset。
  6. 用本地 PRF key 解出 user key。
  7. 构造 `SessionState` 并进入 app。

不能复用 `completeLogin(token, email, masterKey, fallbackKdfIterations)`，因为它要求 masterKey。应新增 passkey 专用 complete 函数。

### 设置页

当前账户/安全相关 UI 在 `webapp/src/components/SettingsPage.tsx` 一带。

新增：

- Passkey 列表。
- 新建 passkey dialog。
- 删除 passkey。
- 对支持 PRF 但未启用 encryption 的 passkey，提供“启用用于登录解锁”的操作。

自己 web 的新建流程要和官方一致：

1. 已登录状态下先验证主密码或现有 session secret。
2. 请求 attestation options。
3. `navigator.credentials.create()` 带 `extensions.prf = {}`。
4. 如果用户希望这个 passkey 可直接解锁 vault，再对刚创建 credential 做一次 `navigator.credentials.get()` 获取 PRF 输出。
5. 用 PRF key 加密/封装当前 user key，发送到 server 保存。

### 客户端加密能力

NodeWarden web 当前已经有：

- PBKDF2
- HKDF expand
- Bitwarden EncString 加解密
- RSA-OAEP private key 加密

但 passkey PRF keyset 需要和官方策略对齐：

- PRF key 是 64 字节 symmetric key，前 32 enc、后 32 mac。
- `encryptedPrivateKey` 用 PRF key wrap 一个 decapsulation private key。
- `encryptedUserKey` 用对应 public key encapsulate user key。
- `encryptedPublicKey` 用于 key rotation。

这里需要认真复用或补齐 NodeWarden 现有 crypto helper，避免做出和官方客户端无法互解的 keyset。

## 扩展兼容要求

### 官方 browser extension

官方 extension passkey 登录入口在：

- `apps/browser/src/auth/popup/login/extension-login-component.service.ts`
- 只在 Chromium 开启。

如果要官方/派生扩展能对 NodeWarden passkey 登录：

- identity URL 必须能访问 `/accounts/webauthn/assertion-options`。
- token URL 必须支持 `grant_type=webauthn`。
- API URL 必须能访问 `/webauthn` 管理接口。
- response 大小写和字段名要同时照顾 PascalCase/camelCase，NodeWarden 当前 token response 已经在一些字段上双写，这个风格应继续沿用。
- passkey 登录成功时必须返回可解开 vault 的 `webAuthnPrfOption`，否则官方组件虽然认证成功，也不会进入可用 vault。

### RP ID 和 origin

自己的 web：

- RP ID 通常是站点 host，例如 `vault.example.com`。
- origin 是 `https://vault.example.com`。

官方 browser extension：

- 扩展页面 origin 是 `chrome-extension://...`。
- 官方之所以只开 Chromium，是因为 Chromium extension 具备它需要的 RP ID 覆盖能力。
- NodeWarden server 验证 assertion 时必须允许正确的 origin/RP ID 组合。这里不能简单只接受当前 request origin，否则扩展登录会失败。

建议配置化：

- `WEBAUTHN_RP_ID`
- `WEBAUTHN_RP_NAME`
- `WEBAUTHN_ALLOWED_ORIGINS`

默认可以从 request URL 推导 web origin，但生产建议显式配置。

## 安全约束

- 所有账户 passkey 必须 `userVerification: required`。
- 登录 assertion 使用 discoverable credential，`userHandle` 必须能解析成 user id 并和 credential 记录一致。
- challenge 必须有过期时间和一次性使用标记。
- PRF 输出绝不能传给 server，也不能写入日志。
- token 里要绑定 scope，防止 attestation token 被拿去 authentication 用。
- counter 要更新。遇到 counter 异常时至少记录 audit event，是否阻断要结合 multi-device passkey 现实处理。
- 每用户 credential 数量限制建议沿用官方 5 个。
- 删除/新增/启用 encryption 必须要求已登录用户二次验证。
- 密码变更、user key rotation 后，所有 enabled PRF credentials 的 keyset 也要 rotation，否则 passkey 登录会解不开新 vault key。
- 备份导出/导入必须包含账户 passkey 表，否则恢复后 passkey 登录会全部失效。
- 审计日志建议新增：
  - `auth.passkey.login.success`
  - `auth.passkey.login.failed`
  - `account.passkey.create`
  - `account.passkey.delete`
  - `account.passkey.encryption.enable`
  - `account.passkey.rotate`

## 建议实施顺序

### 第一阶段：后端基础

1. 新增 `webauthn_credentials` 和 challenge 表。
2. 新增 storage repo。
3. 接入 WebAuthn 服务端验证库。
4. 实现 assertion options 和 `grant_type=webauthn`。
5. token response 加 `WebAuthnPrfOption` shape。

这阶段先能让“已有手工塞入的 enabled credential”完成登录验证，但还不做 UI。

### 第二阶段：账户 passkey 管理 API

1. 实现 `/api/webauthn` 和 `/webauthn` aliases。
2. 实现 attestation options、save credential、list、delete、enable/update encryption。
3. 加 audit event。
4. 接入 backup export/import。
5. sync response 加 `WebAuthnPrfOptions`。

### 第三阶段：NodeWarden 自己 web

1. 登录页 passkey 按钮和 `performPasskeyLogin()`。
2. Passkey 设置页。
3. PRF keyset 创建、保存、删除、启用 encryption。
4. 浏览器能力判断和错误提示。

### 第四阶段：扩展兼容

1. 用官方 browser extension 的 Chromium passkey 登录流程校对 endpoint。
2. 校对 `/config` 里 identity/api/web vault URL。
3. 校对 RP ID、allowed origins。
4. 必要时加兼容字段或 alias route。

按用户要求，本阶段只需要代码跑通不报错；不在这里写可视化测试或测试程序。

## 待实现清单

- [ ] 设计并落库 `webauthn_credentials`。
- [ ] 设计并落库 WebAuthn challenge/replay cache。
- [ ] 选定并验证 Workers 可用的 WebAuthn server library。
- [ ] `GET /identity/accounts/webauthn/assertion-options`。
- [ ] `POST /identity/connect/token` 支持 `grant_type=webauthn`。
- [ ] `UserDecryptionOptions.WebAuthnPrfOption`。
- [ ] `UserDecryption.WebAuthnPrfOptions`。
- [ ] `/api/webauthn` 管理接口。
- [ ] `/webauthn` 官方客户端 alias。
- [ ] NodeWarden web passkey 登录入口。
- [ ] NodeWarden web passkey 管理页。
- [ ] key rotation 时同步 rotate PRF keysets。
- [ ] backup export/import 覆盖新表。
- [ ] audit logs 覆盖 passkey 管理和登录。

## 关键文件索引

NodeWarden：

- `src/router-public.ts`
- `src/router-authenticated.ts`
- `src/handlers/accounts.ts`
- `src/handlers/identity.ts`
- `src/handlers/sync.ts`
- `src/services/auth.ts`
- `src/services/storage-schema.ts`
- `src/services/storage-user-repo.ts`
- `src/services/storage-device-repo.ts`
- `src/utils/passkey.ts`
- `src/utils/user-decryption.ts`
- `src/types/index.ts`
- `webapp/src/lib/api/auth.ts`
- `webapp/src/lib/app-auth.ts`
- `webapp/src/components/AuthViews.tsx`
- `webapp/src/components/SettingsPage.tsx`

Bitwarden server：

- `.codex-upstream/bitwarden-server/src/Identity/Controllers/AccountsController.cs`
- `.codex-upstream/bitwarden-server/src/Identity/IdentityServer/RequestValidators/WebAuthnGrantValidator.cs`
- `.codex-upstream/bitwarden-server/src/Identity/IdentityServer/ApiClient.cs`
- `.codex-upstream/bitwarden-server/src/Api/Auth/Controllers/WebAuthnController.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/Entities/WebAuthnCredential.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/GetWebAuthnLoginCredentialCreateOptionsCommand.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/GetWebAuthnLoginCredentialAssertionOptionsCommand.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/CreateWebAuthnLoginCredentialCommand.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/UserFeatures/WebAuthnLogin/Implementations/AssertWebAuthnLoginCredentialCommand.cs`
- `.codex-upstream/bitwarden-server/src/Core/Auth/Models/Api/Response/UserDecryptionOptions.cs`
- `.codex-upstream/bitwarden-server/util/SqliteMigrations/Migrations/20231213032045_WebAuthnLoginCredentials.cs`

Bitwarden clients/browser：

- `.codex-upstream/bitwarden-clients/libs/auth/src/angular/login/default-login-component.service.ts`
- `.codex-upstream/bitwarden-clients/apps/browser/src/auth/popup/login/extension-login-component.service.ts`
- `.codex-upstream/bitwarden-clients/libs/angular/src/auth/login-via-webauthn/login-via-webauthn.component.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/webauthn-login-api.service.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/webauthn-login.service.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/webauthn-login-prf-key.service.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/models/request/identity-token/webauthn-login-token.request.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/request/webauthn-login-response.request.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/services/webauthn-login/request/webauthn-login-assertion-response.request.ts`
- `.codex-upstream/bitwarden-clients/libs/auth/src/common/login-strategies/webauthn-login.strategy.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin-api.service.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/webauthn-login-admin.service.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/request/save-credential.request.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/request/enable-credential-encryption.request.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/services/webauthn-login/request/webauthn-login-attestation-response.request.ts`
- `.codex-upstream/bitwarden-clients/apps/web/src/app/auth/core/enums/webauthn-login-credential-prf-status.enum.ts`
- `.codex-upstream/bitwarden-clients/libs/common/src/auth/models/response/user-decryption-options/webauthn-prf-decryption-option.response.ts`
- `.codex-upstream/bitwarden-clients/libs/auth/src/common/models/domain/user-decryption-options.ts`

