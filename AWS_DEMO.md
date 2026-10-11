# AWS cloud demo

**CPU deployment is now prepared:** the owner GUI can build the containers,
launch the reviewed AWS templates, enable one confirmed owner email, and stop
or delete the demo. See [cloud-infra/README.md](cloud-infra/README.md) for the
resources, limits, costs, and remaining live verification. Nothing has been
launched on AWS. The paid monetization flow remains unfinished.

This project is currently a localhost-only Python/aiohttp application. Its image
engine is ComfyUI and its text engine is Ollama. The AWS App Monetization private
beta does not host either engine. Its automatic billing instrumentation supports
Next.js during the beta, and its Stripe Connect payments are for evaluation.

## Intended user flow

1. Choose **Use cloud** in the local Synth Forge interface and open the hosted cloud
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

## Owner setup in the local GUI

The **Use cloud → Owner: set up AWS** link opens `/static/cloud-setup.html`. It
checks AWS CLI sign-in, the `us-east-1` On-Demand G/VT quota, and any recent quota
request. The owner can submit a request for four GPU vCPUs there if needed. The
credits button opens AWS Billing, where the owner can inspect eligibility and
expiry. After deployment, the owner can save the tested HTTPS workspace address
in the GUI; it is stored locally under `runtime/` and connects **Use cloud**.
Opening this page does not deploy resources. The owner signs in through
AWS (`aws login`); an account ID or registry token alone cannot grant access.

The setup API is bound to the local Synth Forge server. Its quota POST requires a
same-origin request and a session token. It checks the existing quota and request
history before asking AWS, so the already pending request is not duplicated.
The cloud launch stage remains informational until the hosted app, worker, models,
and billing checks are complete and the owner elects to incur AWS charges.

## Implementation boundaries

- Next.js: Cognito sign-in and guarded upload/job APIs are implemented. The
  owner-only CPU text demo has upload, status, and download UI. Pricing, billing
  UI, paid entitlements, usage metering, and the full image workspace still need
  to be connected.
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
- A text-only CPU demonstration can use the standard EC2 quota while the GPU
  request is pending. The account had 32 standard On-Demand vCPUs on 2026-10-11;
  `m7i.xlarge` (4 vCPUs, 16 GiB) was offered in `us-east-1`. The worker and API
  now support `CLOUD_COMPUTE_MODE=cpu-text`, which runs the actual text pipeline
  with a compact Ollama model and rejects image jobs. A private owner-only gate
  allows one job when `CLOUD_CPU_DEMO_USER_ID` is configured, and the web app
  has an upload/status/download UI for that job. It has not been deployed or
  timed on AWS, and it still incurs charges while running.
- The AWS CLI sign-in is currently a temporary root session. Deployment should
  use a dedicated, least-privilege identity instead of root credentials.
- This folder has a local Git repository and an `aws-cloud-demo` branch. It has
  no remote, so a pull request cannot be opened yet.

No cloud resources have been deployed, and no payment flow has been activated.
The proposed beta price is in `cloud-infra/pricing-proposal.md` and requires
owner approval before any AWS App Monetization plan is created.
