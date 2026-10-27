"""Authentication + sessions for the ITC Maintenance backend.

Prototype-grade but honest: users live in SQLite, passwords are PBKDF2-hashed,
and every API call resolves a bearer token to a role.  The role *is* the
authority  --  the client can never declare its own role on a mutating call.

Two ways in:

* **Google Workspace**  --  ``POST /api/login {"credential": "<id_token>"}``.  The
  id_token is verified in :mod:`oidc`; the verified e-mail must already belong
  to a provisioned user, otherwise the API answers ``not_provisioned``.
* **Demo login**  --  ``{"username","password"}`` or the friction-free
  ``{"role": "coordinator"}`` shorthand, accepted only when the server has demo
  mode on (loopback by default, or an explicit ``--demo`` / ``ITC_DEMO_MODE=1``).

Demo personas (seeded automatically, password `itc`):

    areyes  A. Delos Reyes   requester
    kramos  K. Ramos         coordinator
    jtan    J. Tan           technician
    mreyes  M. Reyes         management
"""
import hashlib
import secrets

from db import now_iso

DEMO_PASSWORD = "itc"
DEMO_DOMAIN = "upcebu.edu.ph"

DEMO_USERS = [
    {"username": "areyes", "name": "A. Delos Reyes", "role": "requester",
     "office": "Records Office", "email": "a.delosreyes@" + DEMO_DOMAIN, "phone": "+63 917 000 0001"},
    {"username": "kramos", "name": "K. Ramos", "role": "coordinator",
     "office": "IT Office", "email": "k.ramos@" + DEMO_DOMAIN, "phone": "+63 917 000 0002"},
    {"username": "jtan", "name": "J. Tan", "role": "technician",
     "office": "IT Office", "email": "j.tan@" + DEMO_DOMAIN, "phone": "+63 917 000 0003"},
    {"username": "mreyes", "name": "M. Reyes", "role": "management",
     "office": "IT Office", "email": "m.reyes@" + DEMO_DOMAIN, "phone": "+63 917 000 0004"},
]
DEMO_USERNAMES = {u["username"] for u in DEMO_USERS}


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 120_000)
    return salt + "$" + dk.hex()


def verify_password(password, stored):
    try:
        salt, expected = stored.split("$", 1)
    except (ValueError, AttributeError):
        return False
    return secrets.compare_digest(hash_password(password, salt), stored)


def ensure_users(conn):
    """Seed demo personas and back-fill contact columns on older databases."""
    if not conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]:
        for u in DEMO_USERS:
            conn.execute(
                "INSERT INTO users (username, name, role, office, email, phone, pw_hash) "
                "VALUES (?,?,?,?,?,?,?)",
                (u["username"], u["name"], u["role"], u["office"], u["email"],
                 u["phone"], hash_password(DEMO_PASSWORD)))
        conn.commit()
        return
    for u in DEMO_USERS:
        row = conn.execute("SELECT id, email, phone FROM users WHERE username = ?",
                           (u["username"],)).fetchone()
        if row and (not row["email"] or not row["phone"]):
            conn.execute("UPDATE users SET email = COALESCE(email, ?), "
                         "phone = COALESCE(phone, ?) WHERE id = ?",
                         (u["email"], u["phone"], row["id"]))
    conn.commit()


def _user_dict(row):
    return {"id": row["id"], "username": row["username"], "name": row["name"],
            "role": row["role"], "office": row["office"], "email": row["email"],
            "phone": row["phone"]}


def _issue(conn, row):
    token = secrets.token_urlsafe(24)
    conn.execute("INSERT INTO sessions (token, user_id, role, created_at) VALUES (?,?,?,?)",
                 (token, row["id"], row["role"], now_iso()))
    # housekeeping: drop sessions older than a day (re-login happens per page load)
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    conn.execute("DELETE FROM sessions WHERE created_at < ?", (cutoff,))
    conn.commit()
    return {"ok": True, "token": token, "user": _user_dict(row)}


def _inactive(row):
    try:
        return row["active"] == 0
    except (IndexError, KeyError, TypeError):
        return False


def login(conn, username=None, password=None, role=None):
    """Return {ok, token, user} on success, else {ok:False, msg}."""
    row = None
    if username:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if not row or not verify_password(password or "", row["pw_hash"]):
            return {"ok": False, "msg": "Invalid username or password."}
        if _inactive(row):
            return {"ok": False, "msg": "This account is deactivated. Contact the System Administrator."}
    elif role:
        row = conn.execute(
            "SELECT * FROM users WHERE role = ? AND active = 1 ORDER BY id LIMIT 1", (role,)).fetchone()
        if not row:
            return {"ok": False, "msg": "Unknown role: %s" % role}
        if _inactive(row):
            return {"ok": False, "msg": "This account is deactivated. Contact the System Administrator."}
    else:
        return {"ok": False, "msg": "Provide username/password or a role."}
    return _issue(conn, row)


def login_google(conn, claims):
    """Sign in from verified Google id_token claims (see :mod:`oidc`).

    The account must already be provisioned with a role.  An in-domain account
    with no profile is refused, so the UI can show "Access not granted".
    """
    email = (claims.get("email") or "").strip().lower()
    if not email:
        return {"ok": False, "msg": "Google token has no e-mail."}
    row = conn.execute("SELECT * FROM users WHERE lower(email) = ?", (email,)).fetchone()
    if not row:
        return {"ok": False, "code": "not_provisioned",
                "msg": "No role has been provisioned for %s. Contact the IT Office." % email}
    if _inactive(row):
        return {"ok": False, "msg": "This account is deactivated. Contact the System Administrator."}
    return _issue(conn, row)


def resolve(conn, token):
    if not token:
        return None
    row = conn.execute(
        "SELECT u.id, u.username, u.name, u.role, u.office, u.email, u.phone, u.active FROM sessions s "
        "JOIN users u ON u.id = s.user_id WHERE s.token = ?", (token,)).fetchone()
    if not row or _inactive(row):
        return None
    return _user_dict(row)


def change_password(conn, user_id, old_password, new_password):
    """Change the signed-in user's password. Returns {ok, msg}."""
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return {"ok": False, "msg": "User not found."}
    if _inactive(row):
        return {"ok": False, "msg": "This account is deactivated."}
    new_password = new_password or ""
    if len(new_password) < 4:
        return {"ok": False, "msg": "New password must be at least 4 characters."}
    if row["pw_hash"] and not verify_password(old_password or "", row["pw_hash"]):
        return {"ok": False, "msg": "Current password is incorrect."}
    conn.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (hash_password(new_password), user_id))
    conn.commit()
    return {"ok": True, "msg": "Password updated."}


def contacts_for(conn, role, office=None):
    """Notification recipients: users of ``role`` (optionally office-scoped).

    Falls back to every user of that role when nobody matches the office, so a
    single-office prototype still delivers to the one account that holds it.
    """
    if role in (None, "any", "system"):
        return []
    rows = conn.execute(
        "SELECT name, email, phone, role, office FROM users WHERE role = ? ORDER BY id",
        (role,)).fetchall()
    if office:
        scoped = [r for r in rows if (r["office"] or "") == office]
        if scoped:
            rows = scoped
    return [{"name": r["name"], "email": r["email"], "phone": r["phone"],
             "role": r["role"], "office": r["office"]} for r in rows]


def logout(conn, token):
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
