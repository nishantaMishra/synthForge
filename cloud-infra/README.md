# Prepared CPU demonstration

The deployment is prepared and locally checked. It has **not been launched on
AWS or tested with a real AWS job**. App Monetization payments remain separate.

## Launch from the owner GUI

Open http://127.0.0.1:8190/static/cloud-setup.html.

1. Refresh AWS checks and inspect the credits in AWS Billing.
2. **Prepare locally** builds the web/worker containers and downloads the pinned
   Ollama container. It creates no AWS resources.
3. Review **View resources and limits**. Checking the charge acknowledgment and
   selecting **Launch CPU demo on AWS** creates the resources below. The launch
   also builds the containers if preparation has not been run.
4. Wait for the workspace and CPU model installation to finish (potentially
   10–30 minutes). Its HTTPS address is connected to Synth Forge automatically.
5. Open the workspace, create a Synth Forge account, and confirm your email.
   Enter that email in the owner GUI and select **Enable my one text job**.
6. At the workspace, submit one short text file, up to 8 KB. Wait for the result
   and download it before the demo expires. A failed job also consumes the limit.
7. **Stop demo** closes the web endpoint and disables wake-up, then stops the CPU.
   **Delete demo resources**, with the deletion checkbox checked, removes this
   deployment and its saved data. Storage remains billable until cleanup.

Progress/errors are written to `runtime/cloud-deployment.log`; deployment state
is in `runtime/cloud-deployment.json`. Neither contains registry credentials.
An expired or failed deployment should be cleaned up before launching another.

## Resources

- `registry.yaml`: three private ECR repositories for the web app, worker, and
  Ollama. Images are uploaded from this machine; no GitHub remote is required.
- `core.yaml`: Cognito email sign-in, private encrypted S3 bucket, SQS queue and
  dead-letter queue, and DynamoDB job table.
- `web.yaml`: Next.js container on Lambda through AWS Lambda Web Adapter 1.1.0,
  with an API Gateway HTTP API and its AWS HTTPS address. Target throttle:
  2 requests/second, burst 10. No always-running web machine or load balancer.
- `cpu-demo.yaml`: one m7i.xlarge (4 vCPUs, 16 GiB) with a 40 GB encrypted gp3
  disk. A dedicated VPC/public subnet provides outbound access without a NAT
  gateway. Its security group has no inbound ports. SSM provides maintenance
  access. IMDSv2 credentials and scoped service roles replace stored AWS keys.
- The instance installs Docker, runs Ollama 0.34.2 with `llama3.2:3b` on CPU,
  and uses the existing Synth Forge text pipeline through a loopback API. Desklib
  verification is unavailable in this compact demo; image jobs are rejected.
- The worker stops after five idle minutes. A boot timer stops it after 45
  minutes, including startup failures. Job processing has a 15-minute timeout.
- A scheduled controller starts a stopped worker when a message arrives. Two
  hours after launch begins, it stops the worker and disables the web endpoint.
  The web application also refuses new jobs after that timestamp.

EC2 CPU pricing checked with AWS Price List on 2026-10-11 in us-east-1:
`m7i.xlarge` Linux is **$0.2016/hour**, so two hours of compute is about $0.40.
40 GB gp3 is **$3.20/month**, prorated. Public IPv4, ECR images, storage, API
requests, logs, and scheduled control calls add charges. Expiry and throttling
are operational safeguards; neither is a guaranteed dollar spending cap.
Credits offset only eligible charges.

## CLI

Python 3, Docker, AWS CLI v2, and a signed-in deployment identity are required.
Use a dedicated identity with permission for these resources and IAM service
roles. The current AWS account passed read-only quota checks: 32 standard EC2
vCPUs and 10 concurrent Lambda executions in us-east-1.

```bash
python3 cloud-infra/deployment.py plan
python3 cloud-infra/deployment.py check
python3 cloud-infra/deployment.py build
```

The following commands incur or enable AWS charges:

```bash
python3 cloud-infra/deployment.py deploy --allow-aws-charges
python3 cloud-infra/deployment.py enable-owner --owner-email you@example.com --allow-aws-charges
```

Stopping and cleanup:

```bash
python3 cloud-infra/deployment.py stop
python3 cloud-infra/deployment.py destroy --delete-demo-data
```

Every action supports `--profile NAME` and `--region REGION`. The GUI uses the
CLI's current/default identity and us-east-1. Cleanup checks the recorded
account/region and affects the stacks recorded by this deployment only.
The deletion command irreversibly deletes the demo's uploaded files, results,
job records, sign-in accounts, and container images.

## Limits of this demonstration

The container builds, templates, local HTTP routes and owner controls are
verified. First-boot installation, actual EC2 model timing, AWS sign-in, and
the complete AWS job still require the live demonstration. GPU image processing
and larger models need the GPU quota and further installation/testing.
This CPU demonstration does not publish a monetization plan, register payments,
or complete the end-user transaction required by the organizers.

AWS App Runner was considered for hosting, but AWS closed it to new customers
on March 31, 2026. This setup uses Lambda/API Gateway instead.
