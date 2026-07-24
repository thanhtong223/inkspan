import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <Link href="/">← INKSPAN</Link>
      <p className="legal-kicker">TERMS</p>
      <h1>Use it thoughtfully.</h1>
      <p>
        INKSPAN is a local creative prototype. You are responsible for
        obtaining permission before recording another person and for how you
        use or share saved media.
      </p>
      <p>
        Browser support and hand-tracking accuracy vary by device, lighting,
        camera quality, and hand visibility.
      </p>
    </main>
  );
}
