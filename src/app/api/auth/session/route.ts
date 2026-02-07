import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCorsHeaders, handleCorsOptions } from '@/lib/cors'

export async function GET(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request, { methods: 'GET, OPTIONS' })

  try {
    const supabase = await createClient()
    
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json(
        { user: null, session: null },
        { status: 200, headers: corsHeaders }
      )
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          created_at: user.created_at,
        },
        session: session
          ? {
              access_token: session.access_token,
              refresh_token: session.refresh_token,
              expires_at: session.expires_at,
              user: {
                id: session.user.id,
                email: session.user.email,
              },
            }
          : null,
      },
      { status: 200, headers: corsHeaders }
    )
  } catch (error) {
    console.error('Error en /api/auth/session:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500, headers: corsHeaders }
    )
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsOptions(request)
}
