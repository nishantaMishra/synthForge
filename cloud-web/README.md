# Synth Studio Cloud entry point

This Next.js application contains Cognito sign-in and the cloud job API. It is
not deployed or ready for paid use. The upload and job routes deliberately return
503 until `lib/cloud.js` is changed to check a real per-user entitlement through
AWS App Monetization. The Python Studio and ComfyUI remain local.

## Local setup

1. Create a Cognito user pool and a public app client with authorization-code
   grant and PKCE. Configure the callback URL as
   `http://localhost:3000/api/auth/callback` for local use, or the corresponding
   HTTPS URL for a deployed app.
2. Copy `.env.example` to `.env.local` and fill in the pool ID, client ID,
   Cognito domain, and app origin. Do not commit `.env.local`.
3. Run `npm install` and `npm run dev` from this directory.

The browser visits `/api/auth/login`, is sent to Cognito, and returns with a
short-lived, HTTP-only access-token cookie. The server verifies the JWT signature,
issuer, client, token use, and expiry on each protected request. `/api/me` shows
the stable Cognito `sub` used for job ownership and future billing.

## Job contract

- `POST /api/uploads`: multipart form field `file`; accepts PNG, JPEG, or WebP
  up to 20 MB, or `.txt`, `.md`, or `.text` up to 2 MB. Returns an `inputKey` under that user's private
  prefix. Unavailable until entitlement integration is complete.
- `POST /api/jobs`: JSON with `kind` (`image` or `text`) and `inputKey`. Image
  jobs can provide `adaptiveLevel`, `denoiseMin`, and `denoiseMax`; text jobs can
  provide `editLimit` and `model`. The selected model must be installed on the
  worker. The API stores an owned job in DynamoDB and sends its ID to SQS.
  Unavailable until entitlement integration is complete.
- `GET /api/jobs/{id}`: returns status only to the owning user. A succeeded job
  can return a five-minute signed download URL for an output in that user's
  prefix.

The GPU worker, queue trigger, idle shutdown, pricing plan, checkout, and
monetization hooks still need to be connected before cloud processing is usable.
