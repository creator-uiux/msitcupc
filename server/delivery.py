"""Notification delivery  --  in-app, e-mail and SMS (standard library only).

The workflow engine writes in-app notifications into the dataset. This module
takes those same notifications and *delivers* them to the people who need them,
over channels chosen by the operator:

  * ``outbox``   --  always on; records every delivery for audit / the demo UI;
  * ``console``  --  prints to stdout (handy when developing);
  * ``email``    --  SMTP (``smtplib``), configured via ``ITC_SMTP_*``;
  * ``sms``      --  a generic JSON webhook (``urllib``), configured via ``ITC_SMS_*``.

Configuration (environment)::

    ITC_NOTIFY_CHANNELS=outbox,email        # default: outbox
    ITC_SMTP_HOST=smtp.example.edu  ITC_SMTP_PORT=587
    ITC_SMTP_USER=...  ITC_SMTP_PASS=...  ITC_SMTP_FROM=it-helpdesk@upcebu.edu.ph
    ITC_SMTP_TLS=1                          # STARTTLS (default 1)
    ITC_SMS_WEBHOOK=https://sms.example/send   ITC_SMS_TOKEN=...

Delivery never raises into the engine: a failing channel is recorded with
``ok = False`` and the error text, and the other channels still run.
"""
import json
import os
import smtplib
import threading
import urllib.request
from email.message import EmailMessage

from db import now_iso

DEFAULT_SUBJECT = "ITC Maintenance System notification"


class Delivery:
    """Routes notifications to contacts over the configured channels."""

    def __init__(self, channels=None, conn=None, resolve=None,
                 email_sender=None, sms_sender=None, console_sender=None,
                 max_outbox=400):
        self.channels = list(channels or ["outbox"])
        self.conn = conn
        self.resolve = resolve              # callable(role, office) -> [contact]
        self.email_sender = email_sender or self._smtp_send
        self.sms_sender = sms_sender or self._sms_post
        self.console_sender = console_sender or self._console_print
        self.max_outbox = max_outbox
        self._lock = threading.Lock()

    # ------------------------------------------------------------- resolution
    def recipients(self, notif):
        if not self.resolve:
            return []
        try:
            return list(self.resolve(notif.get("role"), notif.get("office")) or [])
        except Exception:
            return []

    # ---------------------------------------------------------------- deliver
    def deliver(self, notif):
        """Deliver one notification. Returns the list of delivery records."""
        records = []
        recipients = self.recipients(notif)
        for contact in recipients:
            to_email = contact.get("email")
            to_phone = contact.get("phone")
            for channel in self.channels:
                rec = {
                    "at": now_iso(), "channel": channel, "role": notif.get("role"),
                    "to_name": contact.get("name"), "to": to_email or to_phone or "",
                    "subject": DEFAULT_SUBJECT, "text": notif.get("text", ""),
                    "ticket_id": notif.get("ticketId"), "job_id": notif.get("jobId"),
                    "ok": True, "error": "",
                }
                try:
                    if channel == "outbox":
                        pass                                   # recording is enough
                    elif channel == "console":
                        self.console_sender(rec)
                    elif channel == "email":
                        if not to_email:
                            continue
                        self.email_sender(to_email, rec["subject"], rec["text"])
                    elif channel == "sms":
                        if not to_phone:
                            continue
                        self.sms_sender(to_phone, rec["text"])
                    else:
                        continue
                except Exception as exc:                       # never break the engine
                    rec["ok"] = False
                    rec["error"] = "%s: %s" % (type(exc).__name__, exc)
                records.append(rec)
        self._record(records)
        return records

    # ---------------------------------------------------------------- storage
    def _record(self, records):
        if not records:
            return
        if self.conn is not None:
            with self._lock:
                for r in records:
                    self.conn.execute(
                        "INSERT INTO deliveries (at, channel, role, to_name, to_addr, "
                        "subject, text, ticket_id, job_id, ok, error) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (r["at"], r["channel"], r["role"], r["to_name"], r["to"],
                         r["subject"], r["text"], r["ticket_id"], r["job_id"],
                         1 if r["ok"] else 0, r["error"]))
                self.conn.execute(
                    "DELETE FROM deliveries WHERE id NOT IN "
                    "(SELECT id FROM deliveries ORDER BY id DESC LIMIT ?)", (self.max_outbox,))
                self.conn.commit()

    def outbox(self, limit=100):
        if self.conn is None:
            return []
        rows = self.conn.execute(
            "SELECT * FROM deliveries ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [{
            "id": r["id"], "at": r["at"], "channel": r["channel"], "role": r["role"],
            "toName": r["to_name"], "to": r["to_addr"], "subject": r["subject"],
            "text": r["text"], "ticketId": r["ticket_id"], "jobId": r["job_id"],
            "ok": bool(r["ok"]), "error": r["error"] or "",
        } for r in rows]

    def stats(self):
        counts = {c: 0 for c in self.channels}
        if self.conn is not None:
            for r in self.conn.execute("SELECT channel, COUNT(*) c FROM deliveries GROUP BY channel"):
                counts[r["channel"]] = r["c"]
        return counts

    # --------------------------------------------------------------- channels
    def _console_print(self, rec):
        print("[notify:%s] %s -> %s :: %s" % (rec["channel"], rec["role"], rec["to"],
                                              rec["text"]))

    def _smtp_send(self, to_addr, subject, text):
        host = os.environ.get("ITC_SMTP_HOST")
        if not host:
            raise RuntimeError("ITC_SMTP_HOST is not configured")
        port = int(os.environ.get("ITC_SMTP_PORT") or 587)
        user = os.environ.get("ITC_SMTP_USER")
        password = os.environ.get("ITC_SMTP_PASS")
        sender = os.environ.get("ITC_SMTP_FROM") or user or "it-helpdesk@localhost"
        use_tls = (os.environ.get("ITC_SMTP_TLS", "1") not in ("0", "false", "False"))
        msg = EmailMessage()
        msg["From"] = sender
        msg["To"] = to_addr
        msg["Subject"] = subject
        msg.set_content(text)
        with smtplib.SMTP(host, port, timeout=8) as srv:
            if use_tls:
                srv.starttls()
            if user:
                srv.login(user, password or "")
            srv.send_message(msg)

    def _sms_post(self, to_phone, text):
        url = os.environ.get("ITC_SMS_WEBHOOK")
        if not url:
            raise RuntimeError("ITC_SMS_WEBHOOK is not configured")
        payload = json.dumps({"to": to_phone, "text": text}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, method="POST",
                                     headers={"Content-Type": "application/json"})
        token = os.environ.get("ITC_SMS_TOKEN")
        if token:
            req.add_header("Authorization", "Bearer " + token)
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310
            resp.read()


def channels_from_env(env=None):
    env = os.environ if env is None else env
    raw = (env.get("ITC_NOTIFY_CHANNELS") or "outbox").strip()
    channels = [c.strip().lower() for c in raw.split(",") if c.strip()]
    known = {"outbox", "console", "email", "sms"}
    out = [c for c in channels if c in known]
    if "outbox" not in out:
        out.append("outbox")
    return out
