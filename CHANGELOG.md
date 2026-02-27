# Changelog

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
