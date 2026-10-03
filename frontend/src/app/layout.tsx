import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saras",
  description: "Academic document and study workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-black antialiased">
        {children}
      </body>
    </html>
  );
}
