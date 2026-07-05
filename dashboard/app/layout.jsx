import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://gravitonkv-web.vercel.app"),
  title: "GravitonKV: KV-cache quantization on Graviton4 CPU",
  description:
    "First public reproducible KV-cache quantization tradeoff study on AWS Graviton4 CPU with PMU-level mechanism analysis.",
  openGraph: {
    title: "GravitonKV: KV-cache quantization on Graviton4 CPU",
    description:
      "Prefill up, decode down, memory down: the measured three-way trade, with methodology.",
    images: ["/og.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
