'use client';

import { useEffect, useState } from 'react';

export default function CpuDemo({ userId }) {
  const storageKey = `synth-cpu-demo-job:${userId}`;
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [message, setMessage] = useState('Choose a .txt or .md file of 8 KB or less. This owner demo allows one cloud job.');
  const [jobId, setJobId] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);

  useEffect(() => { setJobId(localStorage.getItem(storageKey)); }, [storageKey]);

  useEffect(() => {
    if (!jobId || ['SUCCEEDED', 'FAILED'].includes(phase)) return;
    let cancelled = false;
    let timer;
    async function check() {
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not check the job');
        if (cancelled) return;
        setPhase(result.status);
        setMessage(result.status === 'SUCCEEDED' ? 'Your cloud text result is ready.' :
          result.status === 'FAILED' ? (result.failure || 'The cloud job failed.') :
          result.status === 'RUNNING' ? 'Processing on the cloud CPU…' :
          'Queued. The cloud worker will start and pick up this job.');
        setDownloadUrl(result.downloadUrl || null);
        if (!['SUCCEEDED', 'FAILED'].includes(result.status)) timer = setTimeout(check, 5000);
      } catch (error) {
        if (!cancelled) {
          setMessage(error.message);
          timer = setTimeout(check, 10000);
        }
      }
    }
    check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, phase, storageKey]);

  async function submit(event) {
    event.preventDefault();
    if (!file || jobId) return;
    setPhase('uploading');
    setMessage('Uploading your text file…');
    try {
      const form = new FormData();
      form.append('file', file);
      const uploadResponse = await fetch('/api/uploads', { method: 'POST', body: form });
      const upload = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(upload.error || 'Upload failed');
      const jobResponse = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'text', inputKey: upload.inputKey }),
      });
      const job = await jobResponse.json();
      if (!jobResponse.ok) throw new Error(job.error || 'Cloud job could not start');
      localStorage.setItem(storageKey, job.id);
      setJobId(job.id);
      setPhase(job.status);
      setMessage('Queued. The cloud worker will start and pick up this job.');
    } catch (error) {
      setPhase('idle');
      setMessage(error.message);
    }
  }

  return (
    <section className="demo" aria-labelledby="demoTitle">
      <p className="eyebrow">OWNER CPU DEMO</p>
      <h2 id="demoTitle">Process one text file in the cloud</h2>
      <p>This temporary test uses a compact CPU model. Image reconstruction and paid plans are not active.</p>
      <form onSubmit={submit}>
        <input type="file" accept=".txt,.md,.text,text/plain,text/markdown" aria-label="Text file" onChange={event => setFile(event.target.files?.[0] || null)} disabled={Boolean(jobId)} />
        <button type="submit" disabled={!file || Boolean(jobId) || phase === 'uploading'}>Run text demo</button>
      </form>
      <div className="status" role="status">{message}</div>
      {downloadUrl && <a className="result" href={downloadUrl}>Download text result ↗</a>}
    </section>
  );
}
