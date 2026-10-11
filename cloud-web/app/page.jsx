import { getSession } from '../lib/auth';
import { cpuDemoAllowed } from '../lib/cloud';
import CpuDemo from './cpu-demo';

export default async function Home() {
  const session = await getSession();
  const cpuDemo = process.env.CLOUD_COMPUTE_MODE === 'cpu-text';
  return (
    <main className="shell">
      <div className="brand"><span className="brandMark">S</span><span>Synth <strong>Forge</strong></span></div>
      <p className="eyebrow">CLOUD WORKSPACE</p>
      <h1>{cpuDemo ? 'Run your text file on AWS.' : 'Create without setting up a GPU.'}</h1>
      <p className="intro">
        {cpuDemo ? 'This private demonstration uses an AWS CPU and a small text model. Sign in to access the owner’s one-job test.' :
          'Sign in to your cloud workspace. Your files and results belong to your account.'}
      </p>
      {session ? (
        <>
          {cpuDemoAllowed(session.userId) ? <CpuDemo userId={session.userId} /> :
            <div className="status" role="status">Signed in. Cloud jobs and billing are being connected.</div>}
          <form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form>
        </>
      ) : (
        <>
          <a href="/api/auth/login">Sign in or create an account</a>
          <div className="status" role="status">{cpuDemo ? 'Text demonstration only. Image processing and paid plans are not active.' : 'Cloud processing is not available yet.'}</div>
        </>
      )}
    </main>
  );
}
