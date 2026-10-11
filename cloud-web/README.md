# Synth Studio Cloud web entry point

This is the Next.js target for the AWS App Monetization private beta. It is an
unpublished scaffold. No authentication, entitlement, metering, checkout, or
processing route is active yet. Do not deploy it as a paid service in this state.

Run `npm install` and `npm run dev` from this directory to preview the landing
page. The current localhost application remains in `studio/`.

The next implementation step is to run the private beta skill against this app,
review the generated pricing and payment code, and connect its server-side
entitlement and metering hooks to cloud job submission. The cloud worker must
check user ownership of every job and file independently of the UI.
