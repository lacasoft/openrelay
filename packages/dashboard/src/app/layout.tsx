export const metadata = {
  title: 'OpenRelay Dashboard',
  description: 'OpenRelay merchant dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
