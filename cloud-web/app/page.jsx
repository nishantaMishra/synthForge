export default function Home() {
  return (
    <main className="shell">
      <div className="brand"><span className="brandMark">S</span><span>Synth <strong>Studio</strong></span></div>
      <p className="eyebrow">CLOUD WORKSPACE</p>
      <h1>Create without setting up a GPU.</h1>
      <p className="intro">
        Sign in, choose a plan, and run image or text jobs on cloud hardware.
        Your files and results belong to your account.
      </p>
      <div className="status" role="status">
        The cloud demo is being connected to sign-in, billing, and on-demand processing.
      </div>
    </main>
  );
}
