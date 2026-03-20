/**
 * Chat Layout — Minimalista, sin sidebar del dashboard.
 * Diseñado para funcionar tanto standalone como embebido en iframe del sidepanel.
 */

export const metadata = {
  title: 'Chat — MVP Legal',
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen w-full overflow-hidden">
      {children}
    </div>
  )
}
