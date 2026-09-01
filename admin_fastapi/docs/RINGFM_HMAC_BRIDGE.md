# RingFM HMAC 服务身份接入

QKeer H5 只访问自己的 FastAPI。QKeer FastAPI 从已验证的 H5 session 取得
`app_user.id`，再使用以下请求头调用 RingFM：

```text
X-QKeer-User-Id
X-QKeer-Timestamp
X-QKeer-Nonce
X-QKeer-Signature
```

双方配置相同的独立密钥：

```env
RINGFM_BRIDGE_SECRET=<openssl rand -hex 32>
```

RingFM 的 FastAPI 鉴权依赖可按以下方式实现。该检查必须放在现有 Bearer Token
返回 `401 auth_required` 之前；HMAC 成功时直接返回当前业务用户。

```python
import hashlib
import hmac
import time

from fastapi import Header, HTTPException, Request


MAX_CLOCK_SKEW_SECONDS = 60


def verify_qkeer_bridge(
    request: Request,
    x_qkeer_user_id: str | None = Header(default=None),
    x_qkeer_timestamp: str | None = Header(default=None),
    x_qkeer_nonce: str | None = Header(default=None),
    x_qkeer_signature: str | None = Header(default=None),
) -> int | None:
    headers = (x_qkeer_user_id, x_qkeer_timestamp, x_qkeer_nonce, x_qkeer_signature)
    if not any(headers):
        return None  # 继续走原 Bearer/Cookie 鉴权
    if not all(headers):
        raise HTTPException(status_code=401, detail="bridge_headers_incomplete")
    try:
        user_id = int(x_qkeer_user_id)
        timestamp = int(x_qkeer_timestamp)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="bridge_identity_invalid")
    if user_id <= 0 or abs(int(time.time()) - timestamp) > MAX_CLOCK_SKEW_SECONDS:
        raise HTTPException(status_code=401, detail="bridge_signature_expired")

    canonical = "\n".join((
        request.method.upper(),
        request.url.path,
        str(user_id),
        str(timestamp),
        x_qkeer_nonce,
    ))
    expected = hmac.new(
        settings.RINGFM_BRIDGE_SECRET.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, x_qkeer_signature.lower()):
        raise HTTPException(status_code=401, detail="bridge_signature_invalid")
    return user_id
```

验签后必须再执行：

1. 查询 `app_user.id = user_id`；
2. 检查删除标志和账户状态；
3. 映射或创建 `auth_users.linked_user_id = app_user.id`；
4. 后续查询只能使用验签得到的用户，不能接受 query/body 中的用户 ID；
5. 可选：将 nonce 以 60 秒 TTL 写入 RingFM Redis，拒绝重复 nonce。

上线配置：

```env
# QKeer FastAPI
RINGFM_BASE_URL=https://www.qkeering.com
RINGFM_BRIDGE_SECRET=<same-secret>
RINGFM_TIMEOUT_SECONDS=12

# RingFM
RINGFM_BRIDGE_SECRET=<same-secret>
```

配置后重启两端服务。不要将密钥提交到 Git、日志或错误响应。
