import { NextResponse } from 'next/server';

const disabled = () => NextResponse.json(
  { error: 'Los avisos de anticipos están desactivados en esta instancia.' },
  { status: 403 },
);
export const GET = disabled;
export const POST = disabled;
