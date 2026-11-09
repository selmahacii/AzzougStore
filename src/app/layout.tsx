import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { GoogleFontsLoader } from "@/components/google-fonts-loader";

// System fonts only — no Google Fonts network request
const geistSans = { variable: "--font-geist-sans" };
const geistMono = { variable: "--font-geist-mono" };
const inter = { variable: "--font-inter" };
const outfit = { variable: "--font-outfit" };

export const metadata: Metadata = {
  title: "Azzougshop",
  description: "Gérez plusieurs boutiques en ligne depuis une seule interface",
  icons: {
    icon: "/azzougshop_logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${outfit.variable} antialiased bg-background text-foreground`}
      >
        <GoogleFontsLoader />
        <Providers>
          {children}
        </Providers>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
