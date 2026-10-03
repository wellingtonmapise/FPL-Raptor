"""End-to-end check of the push encryption and VAPID signature.

PushSender sends a real Web Push request to a local server standing in for
Apple/Google's push service. The test then decrypts the body with the
subscriber's private key, exactly as a phone would, and verifies the VAPID
signature with the app's public key.
"""

import base64
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import http_ece
import jwt  # PyJWT (dev dependency)
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from raptor.alerts import PushSender


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def raw_public(key) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def test_push_is_encrypted_for_the_device_and_signed_by_the_app():
    received = {}

    class PushService(BaseHTTPRequestHandler):
        def do_POST(self):
            received["headers"] = dict(self.headers)
            received["body"] = self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(201)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), PushService)
    threading.Thread(target=server.handle_request, daemon=True).start()

    # The app's VAPID key pair, in the raw base64url format used by both web-push libraries.
    vapid = ec.generate_private_key(ec.SECP256R1())
    vapid_private = b64(vapid.private_numbers().private_value.to_bytes(32, "big"))
    vapid_public = b64(raw_public(vapid))

    # The phone's subscription keys.
    device = ec.generate_private_key(ec.SECP256R1())
    auth_secret = os.urandom(16)
    subscription = {
        "endpoint": f"http://127.0.0.1:{server.server_port}/push/abc",
        "p256dh": b64(raw_public(device)),
        "auth": b64(auth_secret),
    }

    payload = {"title": "GW6 deadline in 24 hours", "body": "Time to plan your transfers.", "url": "/me"}
    result = PushSender(vapid_private, "https://fpl-raptor.vercel.app").send(subscription, payload, ttl=3600, urgency="high")
    server.server_close()

    assert result == "ok"
    headers = {k.lower(): v for k, v in received["headers"].items()}
    assert headers["content-encoding"] == "aes128gcm"
    assert headers["ttl"] == "3600"
    assert headers["urgency"] == "high"

    # The phone can decrypt it.
    plaintext = http_ece.decrypt(received["body"], private_key=device, auth_secret=auth_secret, version="aes128gcm")
    assert json.loads(plaintext) == payload

    # The signature checks out against the app's public key.
    scheme, params = headers["authorization"].split(" ", 1)
    assert scheme == "vapid"
    parts = dict(p.strip().split("=", 1) for p in params.split(","))
    assert parts["k"] == vapid_public
    public_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64(parts["k"]))
    claims = jwt.decode(parts["t"], public_key, algorithms=["ES256"], audience=f"http://127.0.0.1:{server.server_port}")
    assert claims["sub"] == "https://fpl-raptor.vercel.app"
