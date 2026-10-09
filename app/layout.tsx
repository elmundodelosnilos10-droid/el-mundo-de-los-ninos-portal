import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "El Mundo de los Niños · Portal escolar",
  description: "Plataforma escolar para familias, docentes y dirección, con acceso mediante cuentas autorizadas.",
  icons: {
    icon: "/logo-escuela.jpg",
    shortcut: "/logo-escuela.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
