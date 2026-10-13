# Validation

## Local hardware only — 13 October 2026

AWS deployment templates, the hosted web app and worker, setup routes and UI,
monetization setup, and generated cloud state were removed. Image runs now end
when the local ComfyUI engine saves the result. External image checker uploads,
their browser worker, and their API routes were removed. Text editing and Desklib
scoring continue to use local models.

- Five API checks passed for localhost binding, rejection of removed cloud and
  image-verification routes, the local image graph, image submission to the
  loopback engine, shared job-ID validation, and no-store headers on client assets.
- Image UI fixtures passed for completion, missing output, cancellation, and
  restoration of older sessions without resuming external checks.
- Existing SVG preparation and text UI checks passed, as did all ten text
  preservation and lifecycle tests. Python and JavaScript syntax checks passed.
- These checks used fixtures and did not run full diffusion inference or submit
  files to external services.

The running app was restarted with the updated server. Live HTTP checks confirmed
the local-only HTML and JavaScript use `Cache-Control: no-store`, and removed
cloud setup and image-verification URLs return 404. An existing browser page must
be refreshed to replace its already loaded UI.

The entries below record earlier versions of the application.

## Original verification — 10 October 2026

- Independent copy: ten model files have matching sizes and different inodes;
  engine entry point, server, execution code, and workflow match the original.
- Copied Python runtime is used by the launcher, including its libpython shared
  library. Application runtime dependencies are inside the copied virtualenv.
- ComfyUI full prompt validation passed: 36 executable nodes, 52 dependencies,
  three output nodes, and no validation errors. The adapter handles bypassed
  nodes, linked widget inputs, seed control widgets, and the dynamic LoRA widget.
- Browser checks passed for upload, a real small CPU image-processing job,
  websocket execution events, output retrieval, comparison export, reload
  persistence, mobile layout, and rejection of cross-origin requests.
- Event fixtures tested sampler step display, cached nodes, view switching while
  running, cancellation, execution failure messages, and recovery when a job is
  lost after an engine restart. These fixtures are not GPU inference results.

## GPU limitation during testing

Full diffusion inference could not be tested during this session. The NVIDIA
kernel log reported a fatal UVM error, Xid 154, and “Node Reboot Required”. A
fresh CUDA probe failed in both the copied and original Python environments.
The original running application was not stopped or changed to repair this.

The interface was left running with the copied engine in explicit CPU mode for
inspection. Reboot, then use `./start-forge.sh` without `--cpu` for GPU processing.
This interface changes presentation and execution visibility, not the supplied
diffusion pipeline's image quality or watermark-removal behavior.

## Settings and device-visibility follow-up

The active copied engine was confirmed to be running with `--cpu`; its log
reported roughly 240 seconds per sampling step. The original engine reported a
CUDA device. A fresh CUDA probe still failed, so no engine was restarted.

Settings now appear by default in both views, persist in browser storage, and
remain locked during execution. A sticky CPU banner and explicit slow-CPU run
button make device selection visible. A targeted browser test verified settings
persistence, exact submitted values, per-run detail display, validation, mobile
layout, and CPU/GPU indicators using isolated events without queueing inference.
The original active CPU job continued uninterrupted throughout the checks.

## Post-generation provenance checks — 11 October 2026

- Five isolated lifecycle checks passed: one pass per job, exact-byte snapshots,
  report restoration, failed generation, cancellation, interrupted server runs,
  and output-path validation. Provider responses were fixtures; no uploads occurred.
- JavaScript checks passed for result parsing (including mixed C2PA/SynthID
  outcomes), pending verification, unavailable results, UI completion sequencing,
  and persisted reports. Python and JavaScript syntax checks passed.
- The official Claude and OpenAI upload controls were inspected. Google SynthID
  displayed additional terms prohibiting automation; its integration is manual.
- Live provider submissions and browser rendering were not validated in this
  session: external DNS is restricted and Chromium cannot launch in the command
  sandbox. The worker correctly reports browser launch failures as unavailable.
  Existing browser QA now mocks verification to keep its test images local.

Verification stages now appear in the process graph after Save final image.
Graph checks verify the sequential Claude/OpenAI/report edges, the separate manual
Google branch, active tool display, result states, saved report status, and progress
that completes without waiting for the manual Google check. Six isolated Python
checks and the JavaScript graph/lifecycle checks passed. Live browser rendering
remains unverified under the command sandbox restrictions described above.

## Running-server correction — 11 October 2026

The active Synth Forge process was still serving the old 36-node graph and returned
404 for verification. An updated adapter was validated on port 8192, then replaced
the adapter on 8190 while preserving the idle ComfyUI engine and completed job
history. The active API now returns 40 nodes including all four verification
stages. A permanent verification HTTP error now ends the check with an unavailable
result instead of retrying indefinitely; its regression check passed.

The existing final output was checked once. Claude’s result screenshot confirms
that it found no signs the file was processed by Claude. Its current wording was
added to the classifier. OpenAI’s automated browser did not expose an upload
control, so its check is unavailable. This does not constitute a negative OpenAI
result. Actual Synth Forge rendering is still not confirmed through browser automation.

## SVG preview correction — 11 October 2026

Synth Forge now forwards `Sec-Fetch-Dest` and the upstream content-disposition and
security/cache headers. Live requests for `smiling_monkey.svg` confirmed
`image/svg+xml` for image previews and an attachment/octet-stream response for
document navigation, with no-store caching and destination variation retained.
The served bytes match the uploaded SVG, including metadata. The file’s actual
dimensions are 680 × 560. The picker includes SVG previews, and failed previews
no longer retain dimensions from an earlier input. The updated adapter is active
on 8190 with the existing image engine preserved. Syntax and existing UI checks
passed; browser rendering was not directly inspected.

## SVG processing correction — 11 October 2026

SVG inputs are now rasterized in the browser before submitting the engine job.
The original SVG stays in the input preview; the prepared PNG is saved separately
under `studio/rendered` and can be reused. The process graph adds Rasterize SVG
before Read input image for SVG inputs. Preparation can be cancelled without
submitting an engine job, and engine failures now reset the output card.

JavaScript regression checks passed for PNG payloads, original SVG retention,
render dimensions, cached reuse, cancellation, and failure-state display. The
running server serves the updated client assets. A separate PNG rendered from
the supplied SVG with Inkscape was accepted by the real engine’s LoadImage →
SaveImage pipeline at 680 × 560 with no decoder errors. This lightweight test did
not run diffusion or upload the image to external verification providers. Browser
canvas rendering itself was tested with fixtures rather than a live browser.

## SAM memory correction — 11 October 2026

The failure occurred in Segment Anything’s GPU attention workspace at node 613:
it requested 768 MiB while CUDA reported 16.5 MiB free. Synth Forge now configures
SAMLoader with its supported CPU mode and describes that choice in the graph.
Diffusion and face detail sampling continue on the GPU; model selections,
resolution, and denoise settings were preserved.

The deployed adapter accepted the full workflow with no node validation errors.
A real run on the browser-prepared `smiling_monkey.png` completed all reconstruction
and face-refinement stages in 73.43 seconds, producing `Synth-Studio_00008_.png`
at 680 × 560. The log confirms SAM loaded on CPU and a face was detected. The
output was visually inspected. The subsequent verification pass terminated with
Claude and OpenAI unavailable and Google marked manual; these are not negative
provenance results. The engine queue is idle. Syntax and existing SVG/UI checks
passed.

## Verification presentation follow-up

Finished verification attempts now display Done in the graph. Actual detection
outcomes and failure messages remain in node details and saved reports. The
separate provenance panel was removed, and checker links, captured-result links,
and report download are available on node selection. Regression checks passed
for Done labels with retained unavailable outcomes, click-only result details,
report access, permanent HTTP errors, restored sessions, and SVG preparation.

## Text workflow — 11 October 2026

Text mode supports TXT/Markdown upload, local Ollama editing, preservation checks,
downloadable output, highlighted comparison, and local Desklib verification.
The published detector weights were downloaded at revision
`5fdea974cd4287c61674951ec78803aa274e2fb7` and validated as a 392-tensor safetensors
file. No remote model code is executed. Original and output text stay local.

Two live end-to-end jobs completed: a UTF-8 text sample with an accepted small
edit and a rejected passage, and a UTF-16 Markdown sample retained by the guards.
Both returned real local Desklib scores. A longer detector test scored all 2,440
tokens across four windows. Ollama reported zero GPU memory for the text model.
Nine preservation/lifecycle regressions and text UI session/diff/download checks
passed, as did the existing image-verification and SVG checks. Browser rendering
was not directly inspected; the UI was exercised with DOM fixtures.

A final live run on the deployed server accepted grammar and small wording edits,
saved the text file, and returned a real Desklib estimate. A download through the
actual HTTP endpoint preserved the UTF-16 test file byte-for-byte. Ten text
regressions now pass, including retention of original text when a model returns
a partial proposal rather than writing a truncated output.
