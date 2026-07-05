import { Bricolage_Grotesque, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

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
    <html lang="en" className={`${display.variable} ${mono.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
