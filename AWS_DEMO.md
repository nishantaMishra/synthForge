# AWS cloud demo

This project is currently a localhost-only Python/aiohttp application. Its image
engine is ComfyUI and its text engine is Ollama. The AWS App Monetization private
beta does not host either engine. Its automatic billing instrumentation supports
Next.js during the beta, and its Stripe Connect payments are for evaluation.

## Intended user flow

1. Choose **Use cloud** in the local Studio interface and open the hosted cloud
   workspace. The app operator configures `SYNTH_CLOUD_URL` after deployment.
2. Sign in with a verified account. The end user does not provide an AWS account
   ID, access key, or registry token.
3. See the available plan and complete the beta checkout.
4. Upload a file and request a run. The cloud service checks the user's plan and
   records the billable action before dispatching work.
5. A GPU worker starts on demand, processes the job, and stores the result for
   that user. The web app displays status and lets the user download the result.
6. The GPU worker stops after an idle period. Persistent storage and the web
   entry point may continue to incur charges.

An arbitrary user-entered ID cannot be used as authentication or as proof of a
paid plan. The identity provider must verify the user, and the server must check
ownership on every upload, job, status, output, and download route.

## Implementation boundaries

- Next.js: Cognito sign-in and guarded upload/job APIs are implemented. Pricing,
  billing UI, entitlement checks, usage metering, and the processing workspace
  still need to be connected.
- AWS control plane: job queue, private storage for input and output, a job-state
  database, and a trigger that starts a stopped GPU worker when work arrives.
  `cloud-infra/core.yaml` defines the first three resources and Cognito, but
  has not been deployed; the GPU trigger is still pending.
- GPU worker: the existing ComfyUI graph and model files, isolated from the
  public internet. A local worker and wake/idle templates are prepared in
  `cloud-worker/` and `cloud-infra/gpu-control.yaml`, but the GPU instance and
  model installation remain to be built and tested on AWS.
- Text worker: Ollama and Desklib can initially run on the same worker, with
  separate resource limits. Model choice must be based on models actually
  installed and tested on the selected instance.
- AWS App Monetization: run its private beta skill against the Next.js codebase
  after AWS resources and an identity provider exist. Review its generated code,
  then connect entitlements and metering to the server-side job submission path.

## Current prerequisites and blockers

- The beta skill is installed and linked to this repository. Its JS/TS SDK must
  be wired to the Next.js layer; it does not instrument the Python engine.
- The account has $100 of remaining AWS credits and is on the paid plan. Credits
  are not a spending cap. Confirm service eligibility before launching a GPU.
- The AWS Price List API showed `g6e.xlarge` On-Demand Linux compute at
  $1.861/hour in `us-east-1` on 2026-10-11. At that rate, $100 covers at most
  about 53 GPU hours before storage, web hosting, data transfer, and other costs.
- The account's `us-east-1` On-Demand G/VT quota was 0. A request for 4 vCPUs
  was submitted on 2026-10-11 and is pending. This permits one `g6e.xlarge` if
  approved; the workload still needs a memory and performance check.
- The AWS CLI sign-in is currently a temporary root session. Deployment should
  use a dedicated, least-privilege identity instead of root credentials.
- This folder has a local Git repository and an `aws-cloud-demo` branch. It has
  no remote, so a pull request cannot be opened yet.

No cloud resources have been deployed, and no payment flow has been activated.
The proposed beta price is in `cloud-infra/pricing-proposal.md` and requires
owner approval before any AWS App Monetization plan is created.
