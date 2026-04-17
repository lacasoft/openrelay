export default function Home() {
  return (
    <main style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh',
      fontFamily: 'system-ui, sans-serif', background: '#0F172A', color: '#fff'
    }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, color: '#6366F1' }}>
        OpenRelay
      </h1>
      <p style={{ color: '#64748B', marginTop: '0.5rem' }}>
        Merchant dashboard — Phase 2
      </p>
      <p style={{ color: '#64748B', fontSize: '0.875rem', marginTop: '2rem' }}>
        API: {process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'}
      </p>
    </main>
  )
}
