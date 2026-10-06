"""app/core/secretbox.py — the encryption behind users.mfa_secret_enc."""

import pytest
from cryptography.fernet import Fernet

from app.core import secretbox
from app.domain.errors import ServiceUnavailableError


def test_round_trip(app):
    state = {"secret": "JBSWY3DPEHPK3PXP", "last_step": 7, "failed": 0, "locked_until": None}
    blob = secretbox.seal(state)
    assert "JBSWY3DPEHPK3PXP" not in blob  # actually encrypted, not just encoded
    assert secretbox.unseal(blob) == state


def test_key_rotation_new_key_first_old_key_still_decrypts(app):
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    app.config["MFA_ENCRYPTION_KEY"] = old
    blob = secretbox.seal({"a": 1})

    app.config["MFA_ENCRYPTION_KEY"] = f"{new},{old}"
    assert secretbox.unseal(blob) == {"a": 1}  # old blob readable during rotation
    fresh = secretbox.seal({"a": 2})

    app.config["MFA_ENCRYPTION_KEY"] = new  # old key dropped
    assert secretbox.unseal(fresh) == {"a": 2}  # new writes used the new key
    with pytest.raises(ServiceUnavailableError) as exc:
        secretbox.unseal(blob)  # anything still on the old key is now unreadable
    assert exc.value.code == "MFA_STATE_UNREADABLE"


def test_wrong_key_fails_cleanly_without_leaking(app):
    blob = secretbox.seal({"secret": "x"})
    app.config["MFA_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
    with pytest.raises(ServiceUnavailableError) as exc:
        secretbox.unseal(blob)
    assert exc.value.http_status == 503
    assert "x" not in exc.value.message.replace("Two-step", "")


def test_garbage_blob_fails_cleanly(app):
    with pytest.raises(ServiceUnavailableError) as exc:
        secretbox.unseal("not-a-fernet-token")
    assert exc.value.code == "MFA_STATE_UNREADABLE"


def test_no_key_means_feature_off_not_a_crash(app):
    app.config["MFA_ENCRYPTION_KEY"] = ""
    assert secretbox.is_configured() is False
    for call in (lambda: secretbox.seal({}), lambda: secretbox.unseal("x")):
        with pytest.raises(ServiceUnavailableError) as exc:
            call()
        assert exc.value.code == "MFA_NOT_CONFIGURED"
