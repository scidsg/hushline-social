# Release research

- Release: https://github.com/scidsg/hushline/releases/tag/v0.7.25 (published 2026-09-24 UTC).
- Merged implementation: https://github.com/scidsg/hushline/pull/2364 (merge 29255325b9d794aab86dea65e67e8d0e60cf4e88).
- Supported profiles and limitations: https://github.com/scidsg/hushline/blob/v0.7.25/docs/POST-QUANTUM-OPENPGP.md
- Browser assertions: https://github.com/scidsg/hushline/blob/v0.7.25/tests/playwright/e2ee/pqc.spec.js
- Server and cross-library tests: https://github.com/scidsg/hushline/blob/v0.7.25/tests/test_pqc.py

The shipped implementation pins the Proton OpenPGP.js fork 6.3.1 and pysequoia 0.1.35. Tested ASCII-armored RFC 9980 profiles use ML-KEM-768+X25519 encryption subkeys with v4/v6 Ed25519 and v6 ML-DSA-65+Ed25519 primary-key profiles. Browser tests require algorithm 35 and cover encryption/decryption under restrictive CSP. Server tests cover import, fallback, binary/text encryption, and interoperability in both directions. These are source/test findings, not a new independent deployment test. In-app chat remains classical. No universal key/client interoperability or automatic key migration is claimed.
