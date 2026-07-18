import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Label Check — TTB Label Verification",
  description:
    "Compare alcohol beverage label artwork against COLA application data.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="border-b-4 border-blue-900 bg-white">
          <div className="mx-auto flex max-w-5xl items-baseline gap-3 px-6 py-5">
            <h1 className="text-2xl font-bold tracking-tight">Label Check</h1>
            <p className="text-slate-600">Alcohol beverage label verification</p>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-6 pb-12 text-sm text-slate-500">
          Prototype. Results assist an agent&rsquo;s review; they do not replace it.
        </footer>
      </body>
    </html>
  );
}
