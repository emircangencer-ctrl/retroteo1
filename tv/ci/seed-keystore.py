#!/usr/bin/env python3
"""The RetroPlay TV signing key, derived from one secret phrase (the TV_SIGNING_SEED secret).

Android installs a new version of an app over the old one (keeping its data) only when both are
signed with the same certificate. Keeping a keystore file safe and pasting it into a secret as
base64 is awkward without Java tools; a phrase is not. This script turns the phrase into the same
RSA-3072 key and the same self-signed certificate on every run:

- the key's primes come from a SHAKE-256 stream seeded with the phrase (the first odd numbers of
  the right size from that stream that pass 64 Miller-Rabin rounds);
- the certificate has fixed fields (serial from the phrase, validity 2026-01-01 to 2125-12-31) and
  an RSA PKCS#1 v1.5 signature, which is deterministic, so its bytes never change.

The keystore file itself (PKCS#12 with random salts) differs between runs; the key and the
certificate inside do not. Nothing is written but the keystore at the given path; the phrase is
read from the environment and never printed.

Usage: TV_SIGNING_SEED=… TV_KEYSTORE_PASSWORD=… python3 seed-keystore.py out.p12
Prints the certificate's SHA-256 fingerprint (public).
"""
import datetime
import hashlib
import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

BITS = 3072
E = 65537
ALIAS = b"retroplay-tv"
MIN_SEED = 24


class Stream:
    """Deterministic bytes: SHAKE-256 of (label, phrase, block counter)."""

    def __init__(self, seed: bytes, label: bytes):
        self.seed, self.label, self.counter, self.buffer = seed, label, 0, b""

    def take(self, n: int) -> bytes:
        while len(self.buffer) < n:
            block = hashlib.shake_256(self.label + b"\0" + self.seed + b"\0" + self.counter.to_bytes(8, "big")).digest(1024)
            self.buffer += block
            self.counter += 1
        out, self.buffer = self.buffer[:n], self.buffer[n:]
        return out

    def integer(self, bits: int) -> int:
        return int.from_bytes(self.take((bits + 7) // 8), "big") >> ((8 - bits % 8) % 8)


SMALL_PRIMES = [p for p in range(3, 2000) if all(p % q for q in range(2, int(p ** 0.5) + 1))]


def is_probable_prime(n: int, stream: Stream, rounds: int = 64) -> bool:
    if n < 2:
        return False
    for p in SMALL_PRIMES:
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(rounds):
        a = 2 + stream.integer(n.bit_length()) % (n - 3)
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def prime(stream: Stream, bits: int) -> int:
    while True:
        # Top two bits set (the product has exactly 2·bits bits), odd.
        candidate = stream.integer(bits) | (3 << (bits - 2)) | 1
        if (candidate - 1) % E != 0 and is_probable_prime(candidate, stream):
            return candidate


def derive_key(seed: bytes) -> rsa.RSAPrivateKey:
    stream = Stream(seed, b"retroplay-tv/rsa-3072/v1")
    p = prime(stream, BITS // 2)
    q = prime(stream, BITS // 2)
    while q == p:
        q = prime(stream, BITS // 2)
    if p < q:
        p, q = q, p
    n = p * q
    assert n.bit_length() == BITS
    d = pow(E, -1, (p - 1) * (q - 1))
    numbers = rsa.RSAPrivateNumbers(
        p=p, q=q, d=d,
        dmp1=rsa.rsa_crt_dmp1(d, p), dmq1=rsa.rsa_crt_dmq1(d, q), iqmp=rsa.rsa_crt_iqmp(p, q),
        public_numbers=rsa.RSAPublicNumbers(E, n),
    )
    return numbers.private_key()


def certificate(key: rsa.RSAPrivateKey, seed: bytes) -> x509.Certificate:
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "RetroPlay TV"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "RetroPlay")])
    serial = int.from_bytes(hashlib.sha256(b"retroplay-tv/serial/v1\0" + seed).digest()[:16], "big") >> 1
    utc = datetime.timezone.utc
    builder = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(serial)
        .not_valid_before(datetime.datetime(2026, 1, 1, tzinfo=utc))
        .not_valid_after(datetime.datetime(2125, 12, 31, 23, 59, 59, tzinfo=utc))
    )
    cert = builder.sign(key, hashes.SHA256(), rsa_padding=padding.PKCS1v15())
    return cert


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip().splitlines()[-2], file=sys.stderr)
        return 2
    seed_text = os.environ.get("TV_SIGNING_SEED", "")
    password = os.environ.get("TV_KEYSTORE_PASSWORD", "")
    if len(seed_text.strip()) < MIN_SEED:
        print(f"TV_SIGNING_SEED must be at least {MIN_SEED} characters", file=sys.stderr)
        return 1
    if not password:
        print("TV_KEYSTORE_PASSWORD is empty", file=sys.stderr)
        return 1
    seed = seed_text.strip().encode("utf-8")
    key = derive_key(seed)
    cert = certificate(key, seed)
    data = pkcs12.serialize_key_and_certificates(ALIAS, key, cert, None, serialization.BestAvailableEncryption(password.encode("utf-8")))
    with open(sys.argv[1], "wb") as out:
        out.write(data)
    print(hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
