import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceServerClient, workspaceErrorStatus } from '@/lib/workspaces/server';

export const runtime = 'nodejs';
const allowedRoles = new Set(['admin', 'org_admin', 'manager', 'coordinador', 'administrativo', 'user']);

export async function PATCH(request: NextRequest) {
  try {
    const client = await getWorkspaceServerClient(request);
    const payload = await request.json();
    const userId = typeof payload.userId === 'string' ? payload.userId : '';
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: 'El usuario no es válido.' }, { status: 400 });

    // This wrapper requires a workspace manager and verifies target membership
    // before permitting any Auth or profile operation.
    const { data: authData, error: authError } = await client.auth.admin.getUserById(userId);
    if (authError || !authData.user) return NextResponse.json({ error: 'El usuario no pertenece a tu espacio.' }, { status: 404 });
    const { data: profile, error: profileError } = await client.from('app_documents').select('data')
      .eq('collection_path', 'users').eq('doc_id', userId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return NextResponse.json({ error: 'No se encontró el perfil de este usuario.' }, { status: 404 });

    const role = payload.systemRole === undefined ? profile.data.role : payload.systemRole;
    if (!allowedRoles.has(role)) return NextResponse.json({ error: 'El rol no es válido.' }, { status: 400 });
    const displayName = payload.displayName === undefined ? String(profile.data.displayName || '') : String(payload.displayName).trim();
    if (!displayName || displayName.length > 100) return NextResponse.json({ error: 'Escribe un nombre de hasta 100 caracteres.' }, { status: 400 });
    const workspaceId = client.workspace.workspaceId;
    const suppliedOrgIds = payload.organizationIds === undefined ? profile.data.organizationIds : payload.organizationIds;
    if (suppliedOrgIds !== undefined && !Array.isArray(suppliedOrgIds)) return NextResponse.json({ error: 'Las organizaciones no son válidas.' }, { status: 400 });
    const organizationIds = Array.from(new Set<string>([workspaceId, ...(suppliedOrgIds || []).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length < 200)]));
    if (organizationIds.length > 30) return NextResponse.json({ error: 'Demasiadas organizaciones.' }, { status: 400 });
    const { data: organizations, error: orgError } = await client.from('app_documents').select('doc_id')
      .eq('collection_path', 'organizations').in('doc_id', organizationIds);
    if (orgError) throw orgError;
    if (organizations.length !== organizationIds.length) return NextResponse.json({ error: 'Selecciona organizaciones de tu espacio de trabajo.' }, { status: 400 });

    const photoURL = payload.photoURL === undefined ? profile.data.photoURL : payload.photoURL;
    if (photoURL && (typeof photoURL !== 'string' || photoURL.length > 4096 || !(/^(https?:\/\/|\/api\/storage\/file\?)/.test(photoURL)))) {
      return NextResponse.json({ error: 'La dirección de la foto no es válida.' }, { status: 400 });
    }
    const { error: roleError } = await client.auth.admin.setWorkspaceRole(userId, role);
    if (roleError) throw roleError;
    const now = new Date().toISOString();
    const email = String(authData.user.email || '').toLowerCase();
    const nextProfile = {
      ...profile.data, uid: userId, authUserId: userId, email, displayName, role,
      organizationId: workspaceId, organizationIds, updatedAt: now,
      ...(photoURL !== undefined ? { photoURL } : {}),
    };
    const { error: writeError } = await client.from('app_documents').upsert({ collection_path: 'users', doc_id: userId, data: nextProfile });
    if (writeError) throw writeError;
    const teamRows = new Map<string, any>();
    for (const [key, value] of [['doc_id', userId], ['data->>authUserId', userId], ['data->>email', email]]) {
      if (!value) continue;
      const { data, error } = await client.from('app_documents').select('doc_id,data').eq('collection_path', 'team_members').eq(key, value);
      if (error) throw error;
      for (const row of data || []) teamRows.set(row.doc_id, row);
    }
    for (const row of teamRows.values()) {
      const { error } = await client.from('app_documents').upsert({
        collection_path: 'team_members', doc_id: row.doc_id,
        data: { ...row.data, email, name: displayName, displayName, authUserId: userId, systemRole: role,
          organizationId: workspaceId, organizationIds, updatedAt: now, ...(photoURL !== undefined ? { photoURL } : {}) },
      });
      if (error) throw error;
    }
    return NextResponse.json({ userId, message: 'Usuario actualizado en tu espacio.' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo actualizar el usuario.' }, { status: workspaceErrorStatus(error) });
  }
}
