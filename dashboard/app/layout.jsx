import "./globals.css";

export const metadata = {
  title: "GravitonKV: KV-cache quantization on Graviton4 CPU",
  description:
    "First public reproducible KV-cache quantization tradeoff study on AWS Graviton4 CPU with PMU-level mechanism analysis.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
