# Cloud GPU worker (prepared, not deployed)

For the prepared CPU deployment, use [the deployment guide](../cloud-infra/README.md).
`Dockerfile.cpu` packages `cpu_server.py`, which runs the existing Synth Forge text
pipeline without ComfyUI. `cpu-demo.yaml` installs Ollama and the small model,
starts the worker on boot, and supplies IAM credentials through EC2 metadata.
The CPU path does not require `start-forge.sh` or a ComfyUI Python environment.

This worker is designed to run on the same stopped/startable EC2 instance as
Synth Forge. It reads owned jobs from SQS, downloads the input from private S3,
calls Synth Forge on `127.0.0.1:8190`, uploads the result, and updates DynamoDB.
After an idle period it asks EC2 to stop its own instance. The separate
`cloud-infra/gpu-control.yaml` checks the queue each minute and restarts a
stopped instance when work is waiting.

## CPU text demonstration

Set `CLOUD_COMPUTE_MODE=cpu-text` in both the web app and worker. This mode waits
for `/api/text/health` instead of ComfyUI, processes real text jobs with an
installed compact Ollama model, and rejects image jobs. Start the local Synth Forge
API with `start-forge.sh --external-backend` so ComfyUI need not run. Leave
`SYNTH_TEXT_NUM_GPU=0` (the default), install Ollama and a small text model such
as `llama3.2:3b`, and set `CLOUD_DEFAULT_TEXT_MODEL` to that installed model on
the web app. Desklib is optional for this demonstration; the text pipeline
records an unavailable verification result if its model is not installed.

A 4-vCPU, 16-GiB standard EC2 instance is a candidate for a short text demo,
subject to a memory and timing test. It can use the existing stop-on-idle worker
design and does not need the G/VT GPU quota. It still incurs EC2, storage, and
other AWS charges while running. No CPU instance or web service has been
deployed. The web app's private owner demo gate allows one text job when its
`CLOUD_CPU_DEMO_USER_ID` is set; general access remains closed.

## Instance setup still required

- AWS must approve a GPU quota. Choose and test an instance with enough GPU and
  RAM for the actual ComfyUI, Ollama, and detector models. The local model files
  have not been copied or benchmarked on AWS.
- Install the application's Python and GPU dependencies and the worker's
  `requirements.txt`. Arrange for `start-forge.sh` to run on boot, then run
  `worker.py` once the local API is ready. Keep ports 8190 and 8191 bound to
  loopback; do not expose them to the internet. Set `SYNTH_TEXT_NUM_GPU=99` for
  the Synth Forge process only after confirming the selected Ollama model fits in
  available GPU memory. The default `0` preserves local CPU behavior.
- Attach the instance profile from `gpu-control.yaml`. Set `AWS_REGION`,
  `CLOUD_QUEUE_URL`, `CLOUD_JOBS_TABLE`, `CLOUD_BUCKET`, and `CLOUD_INSTANCE_ID`
  in a root-owned environment file. Optional: `CLOUD_IDLE_SECONDS` defaults to
  300, `CLOUD_JOB_SECONDS` to 3600, and `CLOUD_START_SECONDS` to 600.
- Deploy `core.yaml` first; deploy `gpu-control.yaml` only after the instance
  exists. Its one-minute wake check and any stored data can incur AWS charges,
  even while the GPU is stopped.

The worker is not yet end-to-end tested on AWS. The image path retrieves the
first ComfyUI output; the local verification report is not yet included in the
cloud job record. The job API remains disabled until billing entitlements are
connected.
