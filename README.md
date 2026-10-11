# Synth Forge

A separate image workspace built around the copied Synthid-Bypass V2 workflow.Works locally and in AWS cloud.

## Source checkout

This repository contains the Synth Forge interface, the image workflow under
`studio/workflows/image-reconstruction.json`, and the cloud deployment code.
Model weights, installed dependencies, uploads, outputs, logs, AWS credentials,
and the private monetization skill are excluded from Git.

For the independent CPU cloud demo, follow
[cloud-infra/README.md](cloud-infra/README.md). Docker builds its dependencies
without needing the local ComfyUI installation.

## Start

```sh
cd /home/nishant/github/synth
./start-forge.sh
```

Open **http://127.0.0.1:8190**. The launcher also starts this copy's ComfyUI engine
on port **8191**. The original installation on port 8188 is independent.
Press Ctrl+C in the launch terminal to stop Synth Forge and its engine.

The **Use cloud** button explains cloud availability. The cloud workspace has
not been deployed yet, so it currently keeps users in the local app. After the
operator deploys and tests the cloud web app, use **Use cloud → Owner: set up AWS**
to save its HTTPS address (or set `SYNTH_CLOUD_URL` when launching Synth Forge); the
button will then open that workspace. End
users sign in there. They do not enter an AWS account ID or registry token.
Cloud resources and billing remain inactive until the operator completes their
setup. See [AWS_DEMO.md](AWS_DEMO.md) for the deployment state.

For CPU testing: `./start-forge.sh --cpu`. CPU diffusion is substantially slower.
If NVIDIA reports a fatal UVM error or “Node Reboot Required”, reboot the computer
before using the normal GPU launcher. Do not run heavy inference in both installs
at once: they share the same physical GPU.

## Views

- **Process:** upload an image and click Run image. The graph initially stays
  empty; nodes and their actual dependency connections appear as tools execute.
  The right panel explains the active tool and shows timestamped activity.
  Sampling steps and intermediate previews appear when the engine provides them.
  Completed and cached nodes have separate indicators. “Show full graph” reveals
  the plan before execution; “Follow live” keeps the current node in view.
- **Minimal:** shows input, output, and an interactive before/after comparison.
  Switching views does not stop or restart processing.
- **Compare:** move the slider to inspect changes. Save comparison downloads a
  labelled side-by-side PNG. Download saves the output at its original resolution.

SVG files can be selected, previewed, and processed. A Rasterize SVG step renders
the SVG as PNG pixels before the image engine reads it, while keeping the original
SVG for preview and comparison. The prepared PNG is reused on later runs.

Settings are visible by default in both views. Adaptive level, minimum denoise,
and maximum denoise are editable before each run and persist in your browser.
They are locked while a job runs. CPU mode has a persistent warning banner and
an explicitly labelled Run image on CPU (slow) button.
No image-quality or watermark-removal changes were made to the supplied pipeline.
Segment Anything runs on the CPU to avoid exhausting GPU memory during face-boundary
refinement; reconstruction and face detail sampling still use the GPU engine.
After generation succeeds, Synth Forge checks the exact final image once with Claude
and OpenAI, shows their responses, then ends the run. The output remains available
for download during verification. Stop checks cancels verification. Google SynthID
is listed as a manual check because its portal prohibits automated submissions.
The process graph continues with Check Claude → Check OpenAI → Save verification
report after Save final image. Google SynthID appears on a separate manual branch.
Finished verification attempts display Done. Clicking a node shows the actual
outcome and provider response, including timeouts or unavailable checks. Done
means the attempt ended; it does not indicate a positive or negative detection.
Checker and captured-result links are in the selected node’s details.
The progress bar counts completed tools; it is not an estimate of remaining time.
Some nodes load models without reporting an internal percentage. Graph clicks
show a node's explanation and technical settings. Stop run cancels only that job.

The last upload, output, view, and job ID persist in the browser. A running job can
be reconnected after a page refresh. Intermediate previews are labelled separately
and are not offered as final downloads.

## Text files

Select **Text files**, upload a `.txt`, `.md`, or `.text` file (up to 2 MB), and
click **Run text**. The output is downloadable in the original text format.
Input/output previews and a highlighted comparison let you review changes. Image
and text sessions are retained separately when switching workspaces.

Text editing uses the existing local Ollama service, defaulting to `qwen2.5:7b`
when installed. The default wording-change limit is 12%. Each proposed passage
is checked for protected names, numbers, currencies, percentages, qualifications,
quotations, citations, Markdown structure, edit size, and semantic equivalence.
Edits that fail a check retain the original passage. These are safeguards rather
than a guarantee of perfect equivalence; review the comparison. Fenced code is
retained verbatim, including unclosed fences. Encoding/BOM and line endings are
retained. UTF-8, UTF-16/32 with BOM, and Windows-1252 are supported.

The graph follows Read text → Load model → Light edit → Meaning checks → Save text
→ Check Desklib → Save report. Text processing and the detector use CPU, avoiding
competition with image models for GPU memory. Desklib scores the final output
once; its score is not fed back into editing. Finished detector attempts display
Done, with the actual estimate in the node details.

The detector is Desklib’s published
[open English-text model](https://huggingface.co/desklib/ai-text-detector-v1.01),
run locally at a pinned revision. Scores may differ from Desklib’s website and
do not establish authorship. Longer outputs are scored in token windows rather
than silently truncated. Text files stay local. Original uploads and complete
outputs are under `data/text/`; model files are under `studio/models/desklib/`.
Displayed previews are limited to 50,000 characters, while downloads contain
the full output.

The detector is installed in this workspace. To install it in a fresh copy:

```sh
bash studio/install-desklib.sh
```

Ollama must be running with an installed text model. No cloud API key is needed.

## Files

Synth Forge uses Playwright’s Chromium or an existing cached Chromium. To select a
different installed executable, set `SYNTH_VERIFY_BROWSER` before launching.
No API keys are required. Checks run sequentially, with no automatic retries or
changes to the generated image based on their results. Sign-in requirements,
browser challenges, rate limits, changed interfaces, and network failures are
reported as unavailable or inconclusive, never as negative detection results.

Claude checks for its Content Credential:
[Claude file checker](https://claude.com/check-files). OpenAI checks supported
C2PA metadata and SynthID signals:
[OpenAI verifier](https://openai.com/research/verify/).
[Google SynthID](https://synthid.com/) is provided for manual verification.

Reports, exact-byte image snapshots, SHA-256 hashes, and captured provider result
screenshots are saved under `logs/verification/<job-id>/`. Save report downloads
the JSON report from the Save verification report node’s details. Refreshing the page reconnects to the same check; restarting
Synth Forge leaves interrupted checks marked unavailable without resubmitting images.

