import { getSession } from '../lib/auth';

export default async function Home() {
  const session = await getSession();
  return (
    <main className="shell">
      <div className="brand"><span className="brandMark">S</span><span>Synth <strong>Studio</strong></span></div>
      <p className="eyebrow">CLOUD WORKSPACE</p>
      <h1>Create without setting up a GPU.</h1>
      <p className="intro">
        Sign in, choose a plan, and run image or text jobs on cloud hardware.
        Your files and results belong to your account.
      </p>
      {session ? (
        <>
          <div className="status" role="status">Signed in. Cloud jobs and billing are being connected.</div>
          <form action="/api/auth/logout" method="post"><button type="submit">Sign out</button></form>
        </>
      ) : (
        <>
          <a href="/api/auth/login">Sign in or create an account</a>
          <div className="status" role="status">Cloud processing is not available yet.</div>
        </>
      )}
    </main>
  );
}
