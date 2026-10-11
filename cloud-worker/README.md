# Cloud GPU worker (prepared, not deployed)

This worker is designed to run on the same stopped/startable EC2 instance as
Synth Studio. It reads owned jobs from SQS, downloads the input from private S3,
calls Synth Studio on `127.0.0.1:8190`, uploads the result, and updates DynamoDB.
After an idle period it asks EC2 to stop its own instance. The separate
`cloud-infra/gpu-control.yaml` checks the queue each minute and restarts a
stopped instance when work is waiting.

## Instance setup still required

- AWS must approve a GPU quota. Choose and test an instance with enough GPU and
  RAM for the actual ComfyUI, Ollama, and detector models. The local model files
  have not been copied or benchmarked on AWS.
- Install the application's Python and GPU dependencies and the worker's
  `requirements.txt`. Arrange for `start-studio.sh` to run on boot, then run
  `worker.py` once the local API is ready. Keep ports 8190 and 8191 bound to
  loopback; do not expose them to the internet. Set `SYNTH_TEXT_NUM_GPU=99` for
  the Studio process only after confirming the selected Ollama model fits in
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
