# Changelog

## 0.2.0

### Minor Changes

- 714f08d: Upgrade to `react-email@^6.0.0`. Replaces `@react-email/components` and `@react-email/render` with the unified `react-email` package. Bumps minimum Node to `>=20` (required by react-email 6).

## 0.1.1

### Patch Changes

- 7a49c56: Add `channelIdFromThreadId()` and align the adapter's async method signatures with the current Chat SDK contract.

## 0.1.0 (2025-02-27)

Initial release.

### Features

- Bidirectional email adapter for the Vercel Chat SDK using Resend
- Inbound email handling via Resend webhooks with signature verification
- Outbound email sending via Resend API
- Email-native threading using `Message-ID` / `In-Reply-To` / `References` headers
- Card rendering via `@react-email/components` for styled HTML emails
- DM support via `openDM(emailAddress)`
- Factory function `createResendAdapter()` for quick setup
