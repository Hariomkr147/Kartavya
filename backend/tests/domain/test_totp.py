"""RFC 6238 vectors, and the rules around them. Pure — milliseconds."""

import base64

import pytest

from app.domain import totp
from app.domain.enums import MfaPolicy, UserRole
from app.domain.mfa_policy import mfa_policy

pytestmark = pytest.mark.domain

# RFC 6238 Appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
SECRET = base64.b32encode(b"12345678901234567890").decode().rstrip("=")


@pytest.mark.parametrize(
    ("unix", "expected"),
    [
        (59, "94287082"),
        (1111111109, "07081804"),
        (1111111111, "14050471"),
        (1234567890, "89005924"),
        (2000000000, "69279037"),
        (20000000000, "65353130"),
    ],
)
def test_rfc_6238_sha1_vectors(unix, expected):
    assert totp.code_for_step(SECRET, totp.step_at(unix), digits=8) == expected


def test_six_digit_code_is_the_tail_of_the_eight_digit_one():
    assert totp.code_for_step(SECRET, totp.step_at(59)) == "287082"


def test_code_is_zero_padded():
    # step 37037036 (unix 1111111080..) yields a value below 10**5 for some secret
    codes = {totp.code_for_step(SECRET, s) for s in range(200)}
    assert all(len(c) == 6 for c in codes)


def test_matches_current_step_and_one_either_side_but_not_two():
    now = 1_000_000_000
    step = totp.step_at(now)
    for delta in (-1, 0, 1):
        code = totp.code_for_step(SECRET, step + delta)
        assert totp.match_step(SECRET, code, now, last_step=0) == step + delta
    assert totp.match_step(SECRET, totp.code_for_step(SECRET, step + 2), now, 0) is None
    assert totp.match_step(SECRET, totp.code_for_step(SECRET, step - 2), now, 0) is None


def test_a_step_already_used_is_refused():
    now = 1_000_000_000
    step = totp.step_at(now)
    code = totp.code_for_step(SECRET, step)
    assert totp.match_step(SECRET, code, now, last_step=step - 1) == step
    assert totp.match_step(SECRET, code, now, last_step=step) is None
    # An older step inside the window is also refused once a newer one was used.
    older = totp.code_for_step(SECRET, step - 1)
    assert totp.match_step(SECRET, older, now, last_step=step) is None


@pytest.mark.parametrize("bad", ["", "12345", "1234567", "12345a", "١٢٣٤٥٦", " 123456"])
def test_malformed_codes_never_match(bad):
    assert totp.match_step(SECRET, bad, 1_000_000_000, 0) is None


def test_secret_is_unpadded_base32_and_round_trips():
    raw = bytes(range(totp.SECRET_BYTES))
    secret = totp.secret_from_bytes(raw)
    assert "=" not in secret
    assert base64.b32decode(secret + "=" * (-len(secret) % 8)) == raw


def test_otpauth_uri_is_escaped():
    uri = totp.otpauth_uri("ABC", "asha+x@example.com", "Kartavya")
    assert uri == "otpauth://totp/Kartavya:asha%2Bx%40example.com?secret=ABC&issuer=Kartavya"


def test_policy_recommends_for_staff_only():
    assert mfa_policy(UserRole.ADMIN) is MfaPolicy.RECOMMENDED
    assert mfa_policy(UserRole.OFFICER) is MfaPolicy.RECOMMENDED
    assert mfa_policy(UserRole.CITIZEN) is MfaPolicy.OPTIONAL
