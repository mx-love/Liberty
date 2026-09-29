const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function withCors(headers = new Headers()) {
  const nextHeaders = new Headers(headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    nextHeaders.set(key, value);
  });
  return nextHeaders;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: withCors(new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })),
  });
}

function getRequestPath(params) {
  const path = params?.path;
  if (Array.isArray(path)) return path.join('/');
  return path || '';
}

function isValidRoomId(roomId) {
  return /^\d{8}$/.test(String(roomId || '')) && roomId !== '00000000';
}

function generateRoomId() {
  let roomId = '';
  do {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    roomId = String(bytes[0] % 100000000).padStart(8, '0');
  } while (roomId === '00000000');
  return roomId;
}

function generateClientId(prefix = 'client') {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (error) {
    return {};
  }
}

function getDurableObjectStub(env, roomId) {
  const id = env.WATCH_ROOM_DO.idFromName(roomId);
  return env.WATCH_ROOM_DO.get(id);
}

async function createRoom(request, env) {
  const body = await readJson(request);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomId = generateRoomId();
    const hostId = body.hostId || generateClientId('host');
    const stub = getDurableObjectStub(env, roomId);

    const response = await stub.fetch('https://watch-room.local/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        roomId,
        hostId,
        media: body.media || {},
        playback: body.playback || {},
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success) {
      return jsonResponse({
        success: true,
        roomId: data.roomId,
        status: data.status || 'waiting',
        role: data.role || 'host',
        clientId: data.hostId || hostId,
        maxMembers: data.maxMembers || 10,
      });
    }

    if (response.status !== 409) {
      return jsonResponse(data, response.status);
    }
  }

  return jsonResponse(
    { success: false, error: 'ROOM_ID_CONFLICT' },
    409
  );
}

async function getRoomState(request, env) {
  const url = new URL(request.url);
  const roomId = String(url.searchParams.get('room') || '');

  if (!isValidRoomId(roomId)) {
    return jsonResponse({ success: false, error: 'INVALID_ROOM_ID' }, 400);
  }

  const stub = getDurableObjectStub(env, roomId);
  const stateUrl = new URL('https://watch-room.local/state');
  stateUrl.searchParams.set('room', roomId);

  const response = await stub.fetch(stateUrl.toString(), {
    method: 'GET',
  });

  const data = await response.json().catch(() => ({}));
  return jsonResponse(data, response.status);
}

function buildWebSocketUrl(roomId, clientId, role) {
  const url = new URL('https://watch-room.local/ws');
  url.searchParams.set('room', roomId);
  url.searchParams.set('clientId', clientId);
  url.searchParams.set('role', role);
  return url.toString();
}

async function connectWebSocket(request, env) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get('room') || '';
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'viewer';
  const clientId = url.searchParams.get('clientId') || generateClientId(role);

  if (!isValidRoomId(roomId)) {
    return jsonResponse({ success: false, error: 'INVALID_ROOM_ID' }, 400);
  }

  if (request.headers.get('Upgrade') !== 'websocket') {
    return jsonResponse({ success: false, error: 'Expected websocket upgrade' }, 426);
  }

  const stub = getDurableObjectStub(env, roomId);
  return stub.fetch(new Request(buildWebSocketUrl(roomId, clientId, role), request));
}

async function endRoom(request, env) {
  const body = await readJson(request);
  const roomId = body.roomId || '';

  if (!isValidRoomId(roomId)) {
    return jsonResponse({ success: false, error: 'INVALID_ROOM_ID' }, 400);
  }

  const stub = getDurableObjectStub(env, roomId);
  const response = await stub.fetch('https://watch-room.local/end', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientId: body.clientId || '',
    }),
  });

  const data = await response.json().catch(() => ({}));
  return jsonResponse(data, response.status);
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: withCors(),
    });
  }

  if (!env?.WATCH_ROOM_DO) {
    return jsonResponse(
      { success: false, error: 'WATCH_ROOM_DO is not configured' },
      503
    );
  }

  const path = getRequestPath(params);

  try {
    if (method === 'POST' && path === 'create') {
      return createRoom(request, env);
    }

    if (method === 'GET' && path === 'state') {
      return getRoomState(request, env);
    }

    if (method === 'GET' && path === 'ws') {
      return connectWebSocket(request, env);
    }

    if (method === 'POST' && path === 'end') {
      return endRoom(request, env);
    }

    return jsonResponse({ success: false, error: 'Not found' }, 404);
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: 'WATCH_ROOM_INTERNAL_ERROR',
        message: error?.message || String(error),
      },
      500
    );
  }
}
