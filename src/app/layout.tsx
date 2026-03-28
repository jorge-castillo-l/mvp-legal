import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Caussa — Tu expediente judicial, respondido por IA",
  description: "Sincroniza tus causas civiles desde PJUD y obtén respuestas inmediatas con citas verificables al expediente. Plazos, notificaciones, estado procesal — todo en segundos.",
  metadataBase: new URL("https://caussa.cl"),
  openGraph: {
    title: "Caussa — Tu expediente judicial, respondido por IA",
    description: "Sincroniza tus causas civiles desde PJUD y obtén respuestas inmediatas con citas verificables al expediente.",
    siteName: "Caussa",
    locale: "es_CL",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
