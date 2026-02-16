This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## OCR con Google Document AI (Tarea 7.04)

Para procesar PDFs escaneados (fallback cuando `pdf-parse` no extrae texto útil), configura estas variables en `.env.local`:

```bash
GOOGLE_DOCUMENT_AI_PROJECT_ID=tu-project-id
GOOGLE_DOCUMENT_AI_LOCATION=us
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=tu-processor-id

# Opcional: credenciales en base64 para entornos sin GOOGLE_APPLICATION_CREDENTIALS
# GOOGLE_DOCUMENT_AI_CREDENTIALS_BASE64=...
```

Notas:

- Crea en GCP un procesador OCR de Document AI.
- Si no configuras estas variables, el sistema seguirá usando extracción nativa y marcará documentos escaneados como `needs_ocr`.
- El fallback OCR divide automáticamente PDFs grandes en lotes de 15 páginas.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
