"""Google Workspace OpenID Connect id_token verification  --  standard library only.

The backend ships with no third-party dependencies, so this module implements
the small slice of JOSE/JWT that Google sign-in needs directly:

  * base64url decoding of the JWT header/payload;
  * RSASSA-PKCS1-v1_5 (``RS256``) signature verification using the modulus and
    exponent from Google's published JWKS (big-integer arithmetic via ``pow``);
  * the OIDC claim checks the workflow relies on: issuer, audience, expiry,
    verified e-mail, and an optional hosted-domain restriction.

Enable real sign-in by exporting::

    ITC_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
    ITC_ALLOWED_DOMAINS=upcebu.edu.ph          # optional, comma separated

Without a client id the API keeps the friction-free password/role demo login.
"""
import base64
import hashlib
import json
import os
import secrets
import threading
import time
import urllib.request

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

# DER prefix of the DigestInfo for SHA-256 (RFC 8017, section 9.2 note 1).
_SHA256_DIGESTINFO_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


class OidcError(Exception):
    """Raised when an id_token cannot be trusted."""


# ------------------------------------------------------------------ encoding
def b64url_decode(data):
    if isinstance(data, str):
        data = data.encode("ascii")
    data = data.strip()
    pad = b"=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(data + pad)
    except (ValueError, TypeError) as exc:
        raise OidcError("Malformed base64url segment.") from exc


def b64url_encode(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _segment_json(token, index):
    parts = token.split(".")
    if len(parts) != 3:
        raise OidcError("Not a compact JWS (expected three segments).")
    try:
        return json.loads(b64url_decode(parts[index]))
    except ValueError as exc:
        raise OidcError("JWT segment is not valid JSON.") from exc


def decode_header(token):
    return _segment_json(token, 0)


def decode_claims(token):
    return _segment_json(token, 1)


# --------------------------------------------------------------------- RSA
def jwk_to_numbers(jwk):
    """Return ``(n, e)`` ints from an RSA JWK dict."""
    try:
        n = int.from_bytes(b64url_decode(jwk["n"]), "big")
        e = int.from_bytes(b64url_decode(jwk["e"]), "big")
    except (KeyError, TypeError) as exc:
        raise OidcError("JWK is missing modulus/exponent.") from exc
    if n <= 0 or e <= 1:
        raise OidcError("Invalid RSA key parameters.")
    return n, e


def rsa_verify(signing_input, signature, n, e):
    """RSASSA-PKCS1-v1_5 with SHA-256. ``signing_input``/``signature`` are bytes."""
    k = (n.bit_length() + 7) // 8
    if len(signature) != k:
        return False
    s = int.from_bytes(signature, "big")
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    if len(em) < 11 or em[0] != 0x00 or em[1] != 0x01:
        return False
    i = 2
    while i < len(em) and em[i] == 0xFF:
        i += 1
    if i >= len(em) or em[i] != 0x00 or (i - 2) < 8:
        return False
    expected = _SHA256_DIGESTINFO_PREFIX + hashlib.sha256(signing_input).digest()
    return secrets.compare_digest(em[i + 1:], expected)


def rsa_sign(signing_input, n, d):
    """Produce an RS256 signature (used by the tests to mint local tokens)."""
    k = (n.bit_length() + 7) // 8
    digest = hashlib.sha256(signing_input).digest()
    t = _SHA256_DIGESTINFO_PREFIX + digest
    if len(t) > k - 11:
        raise OidcError("Key too small for RS256.")
    ps = b"\xff" * (k - len(t) - 3)
    em = b"\x00\x01" + ps + b"\x00" + t
    return pow(int.from_bytes(em, "big"), d, n).to_bytes(k, "big")


# ------------------------------------------------------------------- JWKS
class JwksCache:
    """Fetches and caches Google's JSON Web Key Set with a TTL."""

    def __init__(self, url=GOOGLE_JWKS_URL, ttl=3600, opener=None, timeout=6.0):
        self.url = url
        self.ttl = float(ttl)
        self.opener = opener or self._default_opener
        self.timeout = timeout
        self._lock = threading.Lock()
        self._keys = {}
        self._at = 0.0

    def _default_opener(self, url):
        req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))

    def _refresh(self, force=False):
        now = time.time()
        with self._lock:
            if not force and self._keys and now - self._at < self.ttl:
                return self._keys
            doc = self.opener(self.url) or {}
            keys = {}
            for jwk in doc.get("keys", []):
                if jwk.get("kid"):
                    keys[jwk["kid"]] = jwk
            if keys:
                self._keys = keys
                self._at = now
            return self._keys

    def get(self, kid):
        keys = self._refresh()
        if kid not in keys:
            keys = self._refresh(force=True)     # the key may have rotated
        if kid not in keys:
            raise OidcError("Unknown signing key (kid).")
        return keys[kid]


# ------------------------------------------------------------- verification
def _as_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes")


def _audience_ok(aud, client_id):
    if isinstance(aud, (list, tuple)):
        return client_id in aud
    return aud == client_id


def _domain_ok(claims, allowed_domains):
    if not allowed_domains:
        return True
    domains = [d.strip().lower().lstrip("@") for d in allowed_domains if d.strip()]
    if not domains:
        return True
    hd = str(claims.get("hd") or "").strip().lower()
    if hd and hd in domains:
        return True
    email = str(claims.get("email") or "")
    if "@" in email and email.rsplit("@", 1)[1].lower() in domains:
        return True
    return False


def verify_id_token(token, client_id, allowed_domains=None, jwks=None,
                    now=None, leeway=120, require_email=True):
    """Verify a Google id_token and return its claims.

    ``jwks`` may be a ``{kid: jwk}`` mapping (tests / injected keys) or a
    :class:`JwksCache`. When omitted, the module-level Google cache is used.
    """
    if not client_id:
        raise OidcError("No Google client id configured.")
    header = decode_header(token)
    if header.get("alg") != "RS256":
        raise OidcError("Unexpected signing algorithm: %s" % header.get("alg"))
    kid = header.get("kid")
    if not kid:
        raise OidcError("JWT header has no kid.")

    if jwks is None:
        jwks = _default_cache()
    if isinstance(jwks, JwksCache):
        jwk = jwks.get(kid)
    else:
        if kid not in jwks:
            raise OidcError("Unknown signing key (kid).")
        jwk = jwks[kid]

    signing_input, signature = _split_signature(token)
    n, e = jwk_to_numbers(jwk)
    if not rsa_verify(signing_input, signature, n, e):
        raise OidcError("Signature verification failed.")

    claims = decode_claims(token)
    now = time.time() if now is None else now

    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise OidcError("Unexpected issuer: %s" % claims.get("iss"))
    if not _audience_ok(claims.get("aud"), client_id):
        raise OidcError("Token audience does not match this client.")
    try:
        exp = float(claims["exp"])
    except (KeyError, TypeError, ValueError) as exc:
        raise OidcError("Token has no valid expiry.") from exc
    if now - leeway > exp:
        raise OidcError("Token has expired.")
    iat = claims.get("iat")
    if iat is not None:
        try:
            if float(iat) - leeway > now:
                raise OidcError("Token is not valid yet.")
        except (TypeError, ValueError):
            raise OidcError("Token has an invalid iat.")
    if require_email and not claims.get("email"):
        raise OidcError("Token has no e-mail claim.")
    if claims.get("email") and not _as_bool(claims.get("email_verified", True)):
        raise OidcError("E-mail is not verified.")
    if not _domain_ok(claims, allowed_domains):
        raise OidcError("Account is outside the allowed domains.")
    return claims


def _split_signature(token):
    parts = token.split(".")
    if len(parts) != 3:
        raise OidcError("Not a compact JWS.")
    signing_input = ("%s.%s" % (parts[0], parts[1])).encode("ascii")
    return signing_input, b64url_decode(parts[2])


_default_lock = threading.Lock()
_default = None


def _default_cache():
    global _default
    with _default_lock:
        if _default is None:
            _default = JwksCache()
        return _default


# ------------------------------------------------------------------- config
def config_from_env(env=None):
    """Return ``(client_id, allowed_domains)`` from the environment."""
    env = os.environ if env is None else env
    client_id = (env.get("ITC_GOOGLE_CLIENT_ID") or "").strip()
    raw = env.get("ITC_ALLOWED_DOMAINS") or "upcebu.edu.ph"
    domains = [d.strip() for d in raw.split(",") if d.strip()]
    return client_id, domains
